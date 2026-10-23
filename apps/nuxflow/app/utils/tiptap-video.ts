import { Node } from '@tiptap/vue-3'
import { parseVideoUrl, videoEmbedUrl } from '@nuxflow/canvas/video'

/**
 * A video in a post: YouTube, Vimeo or a Cloudflare Stream video, stored as a `video` node
 * (`url`, `caption`, `aspectRatio`) and rendered on the public page by render-tiptap.ts.
 * In the editor YouTube and Vimeo show their player; a Stream video shows a labelled box,
 * since a private one only plays through a signed link on the published page.
 */
export const VideoNode = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      url: { default: '' },
      caption: { default: '' },
      aspectRatio: { default: '16:9' },
    }
  },

  parseHTML() {
    return [{
      tag: 'figure[data-video-url]',
      getAttrs: el => ({
        url: el.getAttribute('data-video-url') ?? '',
        caption: el.getAttribute('data-caption') ?? '',
        aspectRatio: el.getAttribute('data-aspect-ratio') ?? '16:9',
      }),
    }]
  },

  renderHTML({ node }) {
    const url = String(node.attrs.url ?? '')
    const caption = String(node.attrs.caption ?? '')
    const ratio = String(node.attrs.aspectRatio ?? '16:9')
    const ref = parseVideoUrl(url)
    const box = { class: 'nux-editor-video-frame', style: `aspect-ratio:${ratio.replace(':', '/')}` }
    const player = ref && ref.provider !== 'stream'
      ? ['div', box, ['iframe', { src: videoEmbedUrl(ref), allowfullscreen: 'true', loading: 'lazy' }]]
      : ['div', { ...box, class: `${box.class} nux-editor-video-placeholder` }, ref ? 'Cloudflare Stream video — plays on the published page' : 'Not a recognised video link']
    return [
      'figure',
      { 'class': 'nux-editor-video', 'data-video-url': url, 'data-caption': caption, 'data-aspect-ratio': ratio },
      player,
      ...(caption ? [['figcaption', {}, caption]] : []),
    ]
  },
})
