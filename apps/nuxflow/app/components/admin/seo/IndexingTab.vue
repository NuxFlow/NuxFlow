<script setup lang="ts">
const { form, saving, save, siteDomain } = inject(SEO_FORM_KEY)!
const toast = useToast()

const { data: typesData } = await useFetch<{ types: { slug: string; name: string }[] }>('/api/v1/seo/content-types', {
  default: () => ({ types: [] }),
})
const typeItems = computed(() => (typesData.value?.types ?? []).map(t => ({ label: t.name, value: t.slug })))

const submitting = ref(false)
async function submitAll() {
  submitting.value = true
  try {
    const res = await $fetch<{ submitted: number; status: number | null; skipped: string | null }>('/api/v1/seo/indexnow', { method: 'POST' })
    if (res.skipped) {
      toast.add({ title: `Nothing submitted (${res.skipped})`, color: 'warning' })
    } else if (res.status && res.status >= 400) {
      toast.add({ title: `IndexNow rejected the submission (HTTP ${res.status})`, description: 'Search engines must be able to fetch /indexnow-key.txt on the canonical domain.', color: 'error' })
    } else {
      toast.add({ title: `Submitted ${res.submitted} URL${res.submitted === 1 ? '' : 's'} to IndexNow`, color: 'success' })
    }
  } catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'IndexNow submission failed'), color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <p class="text-sm font-semibold text-gray-900 dark:text-white">What gets indexed</p>
      <p class="text-xs text-gray-400 mt-0.5">Hidden pages get <code>noindex</code> and are left out of the sitemaps and llms.txt. A page's own Robots setting always wins.</p>
    </template>
    <div class="space-y-4">
      <UFormField label="Hide these content types by default">
        <USelectMenu
          v-model="form.noindexContentTypes"
          :items="typeItems"
          value-key="value"
          multiple
          placeholder="None — every content type is indexed"
          class="w-full"
        />
      </UFormField>
      <USwitch
        v-model="form.noindexTaxonomies"
        label="Hide category & tag archive pages"
        description="Common for small sites, where archive pages mostly repeat post excerpts. Links on them are still followed."
      />
    </div>
  </UCard>

  <UCard>
    <template #header>
      <p class="text-sm font-semibold text-gray-900 dark:text-white">IndexNow</p>
      <p class="text-xs text-gray-400 mt-0.5">Notify Bing, Yandex, Seznam, Naver and other IndexNow engines the moment a page is published, updated, or removed (Google doesn't take part — it uses the sitemap)</p>
    </template>
    <div class="space-y-4">
      <USwitch v-model="form.indexnowEnabled" label="Send IndexNow notifications" />
      <div v-if="form.indexnowEnabled && form.indexnowKey" class="text-xs text-gray-500 space-y-2">
        <p>Key: <code class="font-mono">{{ form.indexnowKey }}</code> — served at <a href="/indexnow-key.txt" target="_blank" class="underline">/indexnow-key.txt</a>.</p>
        <UButton size="xs" variant="outline" icon="i-lucide-send" :loading="submitting" @click="submitAll">Submit all URLs now</UButton>
      </div>
      <p v-else-if="form.indexnowEnabled" class="text-xs text-gray-500">A key is generated when you save.</p>
      <p class="text-xs text-gray-400">NuxFlow sends these itself, per site. Cloudflare's own "Crawler Hints" zone setting relies on CDN cache misses that a Worker-rendered site doesn't produce, so it isn't a substitute.</p>
    </div>
  </UCard>

  <UCard>
    <template #header>
      <p class="text-sm font-semibold text-gray-900 dark:text-white">Duplicate hostnames</p>
      <p class="text-xs text-gray-400 mt-0.5">The site also answers on other hostnames — its <code>*.workers.dev</code> address, a www/apex twin, or an old domain. Those responses always carry <code>noindex</code>.</p>
    </template>
    <div class="space-y-3">
      <USwitch
        v-model="form.redirectToPrimary"
        label="301-redirect other hostnames to the primary domain"
        :description="`Public pages on any other hostname redirect to ${form.canonicalUrl || (siteDomain ? `https://${siteDomain}` : 'the canonical domain')}. The admin stays reachable everywhere.`"
      />
      <UAlert
        v-if="form.redirectToPrimary"
        color="warning"
        variant="soft"
        icon="i-lucide-triangle-alert"
        description="Check your Cloudflare zone doesn't already redirect in the opposite direction (e.g. a Redirect Rule sending the apex to www) — the two would loop."
      />
      <p class="text-xs text-gray-400">To stop serving the <code>workers.dev</code> address entirely, set <code>workers_dev = false</code> and <code>preview_urls = false</code> in <code>wrangler.toml</code> once a custom domain is attached.</p>
    </div>
  </UCard>

  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-semibold text-gray-900 dark:text-white">Custom robots.txt rules</p>
          <p class="text-xs text-gray-400 mt-0.5">Appended after the generated rules</p>
        </div>
        <UButton size="xs" variant="soft" to="/robots.txt" target="_blank" external icon="i-lucide-external-link">View robots.txt</UButton>
      </div>
    </template>
    <UTextarea
      v-model="form.robotsCustom"
      :rows="6"
      class="w-full font-mono text-xs"
      placeholder="User-agent: SomeBot&#10;Disallow: /private-area/"
    />
    <p class="mt-2 text-xs text-gray-400">Only directives are accepted (User-agent, Allow, Disallow, Crawl-delay, Sitemap, Content-Signal) plus # comments.</p>
    <template #footer>
      <div class="flex items-center justify-between gap-3">
        <div class="flex flex-wrap gap-2">
          <UButton size="xs" variant="ghost" to="/sitemap.xml" target="_blank" external icon="i-lucide-external-link">sitemap.xml</UButton>
          <UButton size="xs" variant="ghost" to="/sitemap-images.xml" target="_blank" external icon="i-lucide-external-link">sitemap-images.xml</UButton>
        </div>
        <UButton :loading="saving" @click="save">Save changes</UButton>
      </div>
    </template>
  </UCard>
</template>
