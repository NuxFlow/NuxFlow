<script setup lang="ts">
import { parseWxr, replaceKnownUrls } from '#shared/lib/wxr-parser'
import { batchItems, buildTermSlugMap, categoryParentLinks, collectImageUrls } from '#shared/lib/wordpress-import'
import { chunk } from '#shared/lib/array'
import { slugify } from '#shared/lib/slug'

// The export is parsed here in the browser and sent to the server in small batches — terms,
// then media, then posts (server/api/v1/import/wordpress/*). One request per batch keeps
// every request well inside Cloudflare's limits however big the site is; the import used
// to be a single request, and a large export ran out of memory or database queries.

type Phase = 'reading' | 'terms' | 'media' | 'content' | 'finishing'

const wpFile = ref<File | null>(null)
const wpImporting = ref(false)
const wpResult = ref<{ imported: number; skipped: number; categories: number; tags: number; mediaUploaded: number; mediaFailed: number } | null>(null)
const wpError = ref('')
const wpProgress = ref<{
  phase: Phase
  mediaDone: number
  mediaTotal: number
  mediaFailed: number
  contentDone: number
  contentTotal: number
} | null>(null)

function onWpFile(e: Event) {
  const input = e.target as HTMLInputElement
  wpFile.value = input.files?.[0] ?? null
  wpResult.value = null
  wpError.value = ''
  wpProgress.value = null
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// POSTs one step. A network error or a 5xx is retried (every step is safe to repeat); a
// 4xx is a real answer and stops the import with its message.
async function step<T>(url: string, body: Record<string, unknown>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await $fetch<T>(url, { method: 'POST', body }) as T
    }
    catch (err: unknown) {
      const e = err as { statusCode?: number; data?: { message?: string }; message?: string }
      const status = e.statusCode ?? 0
      if ((status >= 400 && status < 500) || attempt >= 3) {
        throw new Error(e.data?.message || e.message || 'Import failed', { cause: err })
      }
      await sleep(attempt * 2000)
    }
  }
}

async function importTerms(importId: string, taxonomy: 'category' | 'tag', terms: { slug: string; name: string }[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>()
  // Called even with no terms, so both taxonomies exist afterwards.
  for (const part of terms.length ? chunk(terms, 200) : [[]]) {
    const res = await step<{ ids: Record<string, string> }>('/api/v1/import/wordpress/terms', { importId, taxonomy, terms: part })
    for (const [slug, id] of Object.entries(res.ids)) ids.set(slug, id)
  }
  return ids
}

async function runWpImport() {
  if (!wpFile.value) return
  wpImporting.value = true
  wpError.value = ''
  wpResult.value = null
  wpProgress.value = { phase: 'reading', mediaDone: 0, mediaTotal: 0, mediaFailed: 0, contentDone: 0, contentTotal: 0 }
  const progress = wpProgress.value

  try {
    const parsed = parseWxr(await wpFile.value.text())
    if (parsed.items.length === 0 && parsed.categories.size === 0 && parsed.tags.size === 0) {
      throw new Error('No posts, pages, categories or tags were found. Check this is a WordPress export file (Tools → Export).')
    }
    const importId = crypto.randomUUID()
    const imageUrls = collectImageUrls(parsed)
    progress.mediaTotal = imageUrls.length
    progress.contentTotal = parsed.items.length

    // 1. Categories and tags, then category parents (a parent can be in a later batch).
    progress.phase = 'terms'
    const catSlugs = buildTermSlugMap([...parsed.categories].map(([nicename, cat]) => [nicename, cat.name]))
    const tagSlugs = buildTermSlugMap([...parsed.tags])
    const catIds = await importTerms(importId, 'category', [...parsed.categories].map(([nicename, cat]) => ({ slug: catSlugs.get(nicename)!, name: cat.name.slice(0, 200) })))
    const tagIds = await importTerms(importId, 'tag', [...parsed.tags].map(([nicename, name]) => ({ slug: tagSlugs.get(nicename)!, name: name.slice(0, 200) })))
    for (const links of chunk(categoryParentLinks(parsed.categories, catSlugs), 200)) {
      await step('/api/v1/import/wordpress/term-parents', { importId, links })
    }

    // 2. Media, a few files per request.
    progress.phase = 'media'
    const urlMap = new Map<string, string>()
    for (const urls of chunk(imageUrls, 5)) {
      const res = await step<{ results: ({ url: string; localUrl: string } | { url: string; error: string })[] }>('/api/v1/import/wordpress/media', { importId, urls })
      for (const r of res.results) {
        if ('localUrl' in r) urlMap.set(r.url, r.localUrl)
        else progress.mediaFailed++
      }
      progress.mediaDone += urls.length
    }

    // 3. Posts and pages, with links rewritten to the imported media.
    progress.phase = 'content'
    const attachmentUrlByPostId = new Map<string, string>()
    for (const att of parsed.attachments) {
      if (att.postId) attachmentUrlByPostId.set(att.postId, urlMap.get(att.url) ?? att.url)
    }
    const items = parsed.items.map((item, i) => ({
      // A draft that was never given a URL has an empty wp:post_name.
      slug: (item.slug || slugify(item.title) || `wp-item-${i + 1}`).slice(0, 500),
      title: item.title.slice(0, 500),
      status: item.status === 'published' ? 'published' as const : 'draft' as const,
      postType: item.postType === 'page' ? 'page' as const : 'post' as const,
      content: replaceKnownUrls(item.content, urlMap),
      excerpt: item.excerpt.slice(0, 20_000),
      publishedAt: item.publishedAt,
      ogImage: item.featuredImageId ? (attachmentUrlByPostId.get(item.featuredImageId) ?? null) : null,
      termIds: [...new Set([
        ...item.categories.map(n => catIds.get(catSlugs.get(n) ?? '')),
        ...item.tags.map(n => tagIds.get(tagSlugs.get(n) ?? '')),
      ].filter((id): id is string => Boolean(id)))],
    }))
    let imported = 0
    let skipped = 0
    for (const batch of batchItems(items, 20, 1_500_000)) {
      const res = await step<{ imported: number; skipped: number }>('/api/v1/import/wordpress/items', { importId, items: batch })
      imported += res.imported
      skipped += res.skipped
      progress.contentDone += batch.length
    }

    progress.phase = 'finishing'
    await step('/api/v1/import/wordpress/finish', { importId })

    wpResult.value = {
      imported,
      skipped,
      categories: parsed.categories.size,
      tags: parsed.tags.size,
      mediaUploaded: imageUrls.length - progress.mediaFailed,
      mediaFailed: progress.mediaFailed,
    }
    wpProgress.value = null
  }
  catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Import failed. Check the file format and try again.'
    // Everything imported so far stays — running the import again carries on, skipping
    // what's already there.
    wpError.value = `${message} Anything already imported has been kept; running the import again will skip it and carry on.`
    wpProgress.value = null
  }
  finally {
    wpImporting.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
          <UIcon name="i-lucide-arrow-right-left" class="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <p class="font-semibold text-sm text-gray-900 dark:text-white">WordPress</p>
          <p class="text-xs text-gray-400">Import posts, pages, categories, and tags from a WordPress WXR export</p>
        </div>
      </div>
    </template>

    <div class="space-y-4">
      <UAlert
        icon="i-lucide-info"
        color="primary"
        variant="soft"
      >
        <template #title>
          <span class="text-primary-900 dark:text-primary-200 font-semibold">What gets imported</span>
        </template>
        <template #description>
          <span class="text-gray-800 dark:text-gray-200">
            Posts and pages (with content), categories, tags, and publish status. Images are automatically downloaded from your WordPress site and uploaded to your NuxFlow media library — all links are rewritten in the imported content.
          </span>
        </template>
      </UAlert>

      <UFormField label="WordPress export file (.xml)">
        <div
          class="relative flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl px-6 py-8 hover:border-primary-400 transition-colors cursor-pointer"
          @click="($refs.wpFileInput as HTMLInputElement).click()"
        >
          <UIcon name="i-lucide-upload-cloud" class="w-8 h-8 text-gray-400" />
          <p class="text-sm text-gray-500">
            <span v-if="wpFile" class="font-medium text-gray-900 dark:text-white">{{ wpFile.name }}</span>
            <span v-else>Click to select your WordPress export file</span>
          </p>
          <p v-if="!wpFile" class="text-xs text-gray-400">Export from WordPress: Tools → Export → All content</p>
          <input ref="wpFileInput" type="file" accept=".xml" class="sr-only" @change="onWpFile">
        </div>
      </UFormField>

      <!-- Live progress -->
      <div v-if="wpProgress" class="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <p v-if="wpProgress.phase === 'reading' || wpProgress.phase === 'terms' || wpProgress.phase === 'finishing'" class="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
          <UIcon name="i-lucide-loader-circle" class="w-3.5 h-3.5 animate-spin" />
          {{ wpProgress.phase === 'reading' ? 'Reading the export file…' : wpProgress.phase === 'terms' ? 'Creating categories and tags…' : 'Finishing up…' }}
        </p>
        <!-- Media phase -->
        <div v-if="wpProgress.mediaTotal > 0">
          <div class="flex items-center justify-between text-sm mb-1.5">
            <span class="font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
              <UIcon name="i-lucide-image" class="w-3.5 h-3.5" />
              Uploading images
            </span>
            <span class="text-gray-500 tabular-nums">{{ wpProgress.mediaDone }} / {{ wpProgress.mediaTotal }}</span>
          </div>
          <div class="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
            <div
              class="bg-primary-500 h-1.5 rounded-full transition-all duration-300"
              :style="{ width: `${Math.round((wpProgress.mediaDone / wpProgress.mediaTotal) * 100)}%` }"
            />
          </div>
          <p v-if="wpProgress.mediaFailed > 0" class="text-xs text-orange-500 mt-1">
            {{ wpProgress.mediaFailed }} image{{ wpProgress.mediaFailed === 1 ? '' : 's' }} could not be fetched and were skipped
          </p>
        </div>

        <!-- Content phase -->
        <div>
          <div class="flex items-center justify-between text-sm mb-1.5">
            <span class="font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
              <UIcon name="i-lucide-file-text" class="w-3.5 h-3.5" />
              Importing content
            </span>
            <span v-if="wpProgress.phase === 'content' || wpProgress.phase === 'finishing'" class="text-gray-500 tabular-nums">
              {{ wpProgress.contentDone }} / {{ wpProgress.contentTotal }}
            </span>
            <span v-else class="text-gray-400 text-xs">waiting…</span>
          </div>
          <div class="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
            <div
              class="bg-primary-500 h-1.5 rounded-full transition-all duration-300"
              :style="{ width: (wpProgress.phase === 'content' || wpProgress.phase === 'finishing') && wpProgress.contentTotal > 0 ? `${Math.round((wpProgress.contentDone / wpProgress.contentTotal) * 100)}%` : '0%' }"
            />
          </div>
        </div>
      </div>

      <UAlert v-if="wpError" icon="i-lucide-circle-x" color="error" variant="soft" :description="wpError" />

      <UAlert
        v-if="wpResult"
        icon="i-lucide-circle-check"
        color="success"
        variant="soft"
        title="Import complete"
      >
        <template #description>
          <ul class="text-sm space-y-0.5 mt-1">
            <li>Content: {{ wpResult.imported }} imported<span v-if="wpResult.skipped">, {{ wpResult.skipped }} skipped (duplicate slugs)</span></li>
            <li v-if="wpResult.categories || wpResult.tags">Taxonomy: {{ wpResult.categories }} categories, {{ wpResult.tags }} tags</li>
            <li v-if="wpResult.mediaUploaded || wpResult.mediaFailed">
              Media: {{ wpResult.mediaUploaded }} image{{ wpResult.mediaUploaded === 1 ? '' : 's' }} uploaded to your library
              <span v-if="wpResult.mediaFailed" class="text-orange-500">, {{ wpResult.mediaFailed }} skipped (unavailable)</span>
            </li>
          </ul>
        </template>
      </UAlert>
    </div>

    <template #footer>
      <div class="flex items-center justify-between">
        <p class="text-xs text-gray-400">Duplicate slugs are skipped automatically</p>
        <UButton
          :loading="wpImporting"
          :disabled="!wpFile"
          icon="i-lucide-upload"
          @click="runWpImport"
        >
          Import
        </UButton>
      </div>
    </template>
  </UCard>
</template>
