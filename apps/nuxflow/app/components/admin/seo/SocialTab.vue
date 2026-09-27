<script setup lang="ts">
const { form, saving, save } = inject(SEO_FORM_KEY)!

const profileCount = computed(() => form.socialProfiles.split(/\r?\n/).filter(l => l.trim()).length)

const verifiers = [
  { key: 'verifyGoogle', label: 'Google Search Console', meta: 'google-site-verification', help: 'Search Console → Add property → URL prefix → HTML tag' },
  { key: 'verifyBing', label: 'Bing Webmaster Tools', meta: 'msvalidate.01', help: 'Bing Webmaster Tools → Add site → HTML Meta Tag (Bing also imports from Search Console)' },
  { key: 'verifyYandex', label: 'Yandex Webmaster', meta: 'yandex-verification', help: 'Yandex Webmaster → Add site → Meta tag' },
  { key: 'verifyPinterest', label: 'Pinterest', meta: 'p:domain_verify', help: 'Pinterest → Settings → Claimed accounts → Website → Add HTML tag' },
] as const
</script>

<template>
  <UCard>
    <template #header>
      <p class="text-sm font-semibold text-gray-900 dark:text-white">Social profiles</p>
      <p class="text-xs text-gray-400 mt-0.5">Tells search engines and AI assistants which accounts belong to this site (schema.org <code>sameAs</code>)</p>
    </template>
    <div class="space-y-4">
      <UFormField label="X (Twitter) handle" hint="Sent as twitter:site on every page">
        <UInput v-model="form.twitterHandle" placeholder="@yourbrand" class="w-full max-w-xs" />
      </UFormField>
      <UFormField label="Profile URLs" :hint="`One per line — ${profileCount} added`">
        <UTextarea
          v-model="form.socialProfiles"
          :rows="4"
          placeholder="https://www.linkedin.com/company/yourbrand&#10;https://github.com/yourbrand&#10;https://www.youtube.com/@yourbrand"
          class="w-full font-mono text-xs"
        />
      </UFormField>
    </div>
  </UCard>

  <UCard>
    <template #header>
      <p class="text-sm font-semibold text-gray-900 dark:text-white">Search engine verification</p>
      <p class="text-xs text-gray-400 mt-0.5">Paste the verification code — or the whole <code>&lt;meta&gt;</code> tag, the code is extracted automatically</p>
    </template>
    <div class="space-y-4">
      <UAlert
        icon="i-lucide-cloud"
        color="neutral"
        variant="soft"
        title="On Cloudflare DNS? A TXT record works too"
        description="If this domain's DNS is on Cloudflare, you can verify with a DNS TXT record instead (Search Console's &quot;Domain&quot; property covers every subdomain and protocol at once). Meta tags are the way to go for tenant domains whose DNS you don't control."
      />
      <UFormField v-for="v in verifiers" :key="v.key" :label="v.label" :hint="v.help">
        <UInput v-model="form[v.key]" :placeholder="`<meta name=&quot;${v.meta}&quot; content=&quot;…&quot;>`" class="w-full font-mono text-xs" />
      </UFormField>
    </div>
    <template #footer>
      <div class="flex justify-end">
        <UButton :loading="saving" @click="save">Save changes</UButton>
      </div>
    </template>
  </UCard>
</template>
