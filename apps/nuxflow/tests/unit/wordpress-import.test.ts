import { describe, it, expect } from 'vitest'
import { parseWxr, wpDateToIso } from '../../server/utils/wxr-parser'

const SAMPLE_WXR = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/">
<channel>
  <wp:category>
    <wp:term_id>2</wp:term_id>
    <wp:category_nicename><![CDATA[news]]></wp:category_nicename>
    <wp:category_parent><![CDATA[]]></wp:category_parent>
    <wp:cat_name><![CDATA[News]]></wp:cat_name>
  </wp:category>
  <wp:category>
    <wp:term_id>3</wp:term_id>
    <wp:category_nicename><![CDATA[world]]></wp:category_nicename>
    <wp:category_parent><![CDATA[news]]></wp:category_parent>
    <wp:cat_name><![CDATA[World]]></wp:cat_name>
  </wp:category>
  <wp:tag>
    <wp:tag_slug><![CDATA[featured]]></wp:tag_slug>
    <wp:tag_name><![CDATA[Featured]]></wp:tag_name>
  </wp:tag>
  <item>
    <title>A photo</title>
    <wp:post_id>456</wp:post_id>
    <wp:post_type>attachment</wp:post_type>
    <wp:post_name>a-photo</wp:post_name>
    <wp:attachment_url>https://old-site.example.com/wp-content/uploads/2021/06/photo.jpg</wp:attachment_url>
  </item>
  <item>
    <title>Hello &amp; Welcome</title>
    <wp:post_id>123</wp:post_id>
    <wp:post_type>post</wp:post_type>
    <wp:post_name>hello-welcome</wp:post_name>
    <wp:status>publish</wp:status>
    <wp:post_date_gmt>2021-06-15 10:23:45</wp:post_date_gmt>
    <content:encoded><![CDATA[<p>It&#8217;s a <strong>great</strong> day.</p>]]></content:encoded>
    <excerpt:encoded><![CDATA[<p>A short teaser.</p>]]></excerpt:encoded>
    <category domain="category" nicename="world"><![CDATA[World]]></category>
    <category domain="post_tag" nicename="featured"><![CDATA[Featured]]></category>
    <wp:postmeta>
      <wp:meta_key>_thumbnail_id</wp:meta_key>
      <wp:meta_value><![CDATA[456]]></wp:meta_value>
    </wp:postmeta>
  </item>
  <item>
    <title>A Draft Page</title>
    <wp:post_id>124</wp:post_id>
    <wp:post_type>page</wp:post_type>
    <wp:post_name>a-draft-page</wp:post_name>
    <wp:status>draft</wp:status>
    <content:encoded><![CDATA[<p>Draft content.</p>]]></content:encoded>
  </item>
  <item>
    <title>Skip Me</title>
    <wp:post_type>nav_menu_item</wp:post_type>
  </item>
</channel>
</rss>`

describe('parseWxr', () => {
  const { items, attachments, categories, tags } = parseWxr(SAMPLE_WXR)

  it('parses posts and pages but skips unrelated post types (e.g. nav_menu_item)', () => {
    expect(items.map(i => i.slug).sort()).toEqual(['a-draft-page', 'hello-welcome'])
  })

  it('parses attachments separately, keeping their wp:post_id', () => {
    expect(attachments).toEqual([
      { title: 'A photo', slug: 'a-photo', url: 'https://old-site.example.com/wp-content/uploads/2021/06/photo.jpg', postId: '456' },
    ])
  })

  it('decodes HTML entities in the title', () => {
    const item = items.find(i => i.slug === 'hello-welcome')!
    expect(item.title).toBe('Hello & Welcome')
  })

  it('converts publish status to "published" and draft to "draft"', () => {
    expect(items.find(i => i.slug === 'hello-welcome')!.status).toBe('published')
    expect(items.find(i => i.slug === 'a-draft-page')!.status).toBe('draft')
  })

  it('converts wp:post_date_gmt into a real ISO 8601 string', () => {
    expect(items.find(i => i.slug === 'hello-welcome')!.publishedAt).toBe('2021-06-15T10:23:45.000Z')
  })

  it('leaves publishedAt null when the item has no post_date_gmt', () => {
    expect(items.find(i => i.slug === 'a-draft-page')!.publishedAt).toBeNull()
  })

  it('strips tags and decodes entities in the excerpt (plain-text column)', () => {
    expect(items.find(i => i.slug === 'hello-welcome')!.excerpt).toBe('A short teaser.')
  })

  it('captures category and tag term assignments per item', () => {
    const item = items.find(i => i.slug === 'hello-welcome')!
    expect(item.categories).toEqual(['world'])
    expect(item.tags).toEqual(['featured'])
  })

  it('resolves the featured image id from wp:postmeta _thumbnail_id', () => {
    expect(items.find(i => i.slug === 'hello-welcome')!.featuredImageId).toBe('456')
    expect(items.find(i => i.slug === 'a-draft-page')!.featuredImageId).toBeNull()
  })

  it('parses categories with their parent slug for hierarchy reconstruction', () => {
    expect(categories.get('news')).toEqual({ name: 'News', parentSlug: null })
    expect(categories.get('world')).toEqual({ name: 'World', parentSlug: 'news' })
  })

  it('parses tags', () => {
    expect(tags.get('featured')).toBe('Featured')
  })
})

describe('wpDateToIso', () => {
  it('converts a WordPress GMT date string to ISO 8601', () => {
    expect(wpDateToIso('2021-06-15 10:23:45')).toBe('2021-06-15T10:23:45.000Z')
  })

  it('returns null for null input', () => {
    expect(wpDateToIso(null)).toBeNull()
  })

  it('returns null for an unparseable date rather than throwing', () => {
    expect(wpDateToIso('not-a-date')).toBeNull()
  })

  it('returns null for the WordPress zero-date sentinel', () => {
    expect(wpDateToIso('0000-00-00 00:00:00')).toBeNull()
  })
})

describe('parseWxr — terms referenced only on items', () => {
  // A filtered WordPress export (e.g. "Posts from one author") can reference terms on its
  // items without listing them in the channel-level <wp:category>/<wp:tag> blocks.
  const PARTIAL_WXR = `<rss><channel>
  <item>
    <title>Partial</title>
    <wp:post_type>post</wp:post_type>
    <wp:post_name>partial</wp:post_name>
    <category domain="category" nicename="recipes"><![CDATA[Recipes &amp; Food]]></category>
    <category domain="post_tag" nicename="%e6%97%a5%e6%9c%ac"><![CDATA[日本]]></category>
  </item>
</channel></rss>`

  it('registers them from the item element, with decoded names', () => {
    const { categories, tags, items } = parseWxr(PARTIAL_WXR)
    expect(categories.get('recipes')).toEqual({ name: 'Recipes & Food', parentSlug: null })
    expect(tags.get('%e6%97%a5%e6%9c%ac')).toBe('日本')
    expect(items[0]!.categories).toEqual(['recipes'])
    expect(items[0]!.tags).toEqual(['%e6%97%a5%e6%9c%ac'])
  })
})
