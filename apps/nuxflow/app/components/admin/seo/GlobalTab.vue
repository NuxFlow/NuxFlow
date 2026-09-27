<script setup lang="ts">
const { form, saving, save, siteName, siteDomain } = inject(SEO_FORM_KEY)!
const toast = useToast()

const aiLoading = ref(false)
async function aiSuggest() {
  aiLoading.value = true
  try {
    // scope 'site' → the server builds context from the site's own published content.
    const res = await $fetch<{ seoTitle: string; seoDescription: string }>('/api/v1/ai/seo-suggest', {
      method: 'POST',
      body: { scope: 'site', title: form.title || siteName.value, body: form.description || undefined },
    })
    if (res.seoTitle) form.title = res.seoTitle
    if (res.seoDescription) form.description = res.seoDescription
  } catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'AI suggestion failed — check Settings → AI'), color: 'error' })
  } finally {
    aiLoading.value = false
  }
}

const showImagePicker = ref(false)
const previewBase = computed(() => form.canonicalUrl.replace(/\/+$/, '') || (siteDomain.value ? `https://${siteDomain.value}` : ''))
const canonicalWarning = computed(() => {
  const v = form.canonicalUrl.trim()
  if (!v) return ''
  try {
    const u = new URL(v)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Must start with https://'
    if (siteDomain.value && u.hostname !== siteDomain.value && u.hostname !== `www.${siteDomain.value}` && `www.${u.hostname}` !== siteDomain.value) {
      return `This points canonicals at ${u.hostname}, not this site's domain (${siteDomain.value}) — only do this if that's where the site really lives.`
    }
    return ''
  } catch {
    return 'Enter a full URL, e.g. https://example.com'
  }
})
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-sm font-semibold text-gray-900 dark:text-white">Global SEO defaults</p>
          <p class="text-xs text-gray-400 mt-0.5">Used for the homepage and archive pages, and as the fallback for any page without its own SEO fields</p>
        </div>
        <UButton
          icon="i-lucide-sparkles"
          size="sm"
          variant="outline"
          :loading="aiLoading"
          title="Write a title and description from this site's content with AI"
          @click="aiSuggest"
        >
          AI suggest
        </UButton>
      </div>
    </template>

    <div class="space-y-5">
      <!-- Search result preview -->
      <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-950 space-y-0.5">
        <p class="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Homepage search preview</p>
        <p class="text-[#1a0dab] dark:text-[#8ab4f8] text-sm font-medium truncate">{{ form.title || siteName || 'Site title' }}</p>
        <p class="text-[#006621] dark:text-[#4db274] text-xs truncate">{{ previewBase || 'https://example.com' }}</p>
        <p class="text-[#545454] dark:text-gray-400 text-xs line-clamp-2">{{ form.description || 'Your default meta description will appear here…' }}</p>
      </div>

      <UFormField label="Homepage & default title" hint="The homepage <title>; also used when a page has no title of its own">
        <UInput v-model="form.title" :placeholder="siteName || 'My Site — what it does'" class="w-full" />
        <p class="mt-1 text-xs" :class="form.title.length > 60 ? 'text-amber-500' : 'text-gray-400'">
          {{ form.title.length }} / 60 characters
        </p>
      </UFormField>

      <UFormField label="Default meta description" hint="Homepage, blog, archives — and any page without its own description or excerpt">
        <UTextarea v-model="form.description" :rows="3" placeholder="A short description of your site shown in search results…" class="w-full" />
        <p class="mt-1 text-xs" :class="form.description.length > 160 ? 'text-amber-500' : 'text-gray-400'">
          {{ form.description.length }} / 160 characters
        </p>
      </UFormField>

      <UFormField label="Canonical URL prefix" hint="The one address search engines should treat as this site's. Leave blank to use the site's domain.">
        <UInput v-model="form.canonicalUrl" :placeholder="siteDomain ? `https://${siteDomain}` : 'https://example.com'" class="w-full" />
        <p v-if="canonicalWarning" class="mt-1 text-xs text-amber-500">{{ canonicalWarning }}</p>
      </UFormField>

      <UFormField label="Default share image" hint="Shown on social networks for pages without a featured image — 1200×630 works best">
        <div class="flex gap-2">
          <UInput v-model="form.ogImage" placeholder="https://… or pick from the media library" class="flex-1" />
          <UButton variant="outline" icon="i-lucide-image" aria-label="Choose from media library" @click="showImagePicker = true" />
          <UButton v-if="form.ogImage" variant="ghost" color="neutral" icon="i-lucide-x" aria-label="Remove image" @click="form.ogImage = ''" />
        </div>
        <img
          v-if="form.ogImage"
          :src="form.ogImage"
          alt="Default share image preview"
          class="mt-2 w-full max-w-sm aspect-[1200/630] object-cover rounded-lg border border-gray-200 dark:border-gray-700"
        >
      </UFormField>

      <UFormField label="Search engine indexing">
        <USelect
          v-model="form.robots"
          :items="[
            { label: 'Allow indexing (index, follow)', value: 'index' },
            { label: 'Hide the whole site from search engines (noindex)', value: 'noindex' },
          ]"
          class="w-full"
        />
        <p v-if="form.robots === 'noindex'" class="mt-1.5 text-xs text-amber-500 flex items-start gap-1">
          <UIcon name="i-lucide-triangle-alert" class="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Every response gets an <code>X-Robots-Tag: noindex</code> header and robots.txt signals <code>search=no</code>. Crawling stays allowed on purpose — a crawler that can't fetch a page never sees its noindex, so pages already in results would linger.
        </p>
      </UFormField>
    </div>

    <template #footer>
      <div class="flex justify-end">
        <UButton :loading="saving" @click="save">Save changes</UButton>
      </div>
    </template>
  </UCard>

  <UModal v-model:open="showImagePicker" title="Select default share image">
    <template #body>
      <EditorMediaPicker @select="(f: { url: string }) => { form.ogImage = f.url; showImagePicker = false }" />
    </template>
  </UModal>
</template>
