<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

const providers = [
  { value: 'workers-ai', label: 'Cloudflare Workers AI (recommended)', icon: 'i-simple-icons-cloudflare', envKey: null },
  { value: 'openai', label: 'OpenAI', icon: 'i-simple-icons-openai', envKey: 'NUXT_OPENAI_API_KEY' },
  { value: 'anthropic', label: 'Anthropic', icon: 'i-simple-icons-anthropic', envKey: 'NUXT_ANTHROPIC_API_KEY' },
  { value: 'gemini', label: 'Google Gemini', icon: 'i-simple-icons-google', envKey: 'NUXT_GEMINI_API_KEY' },
  { value: 'deepseek', label: 'DeepSeek', icon: 'i-lucide-brain-circuit', envKey: 'NUXT_DEEPSEEK_API_KEY' },
  { value: 'ollama', label: 'Ollama (local)', icon: 'i-lucide-cpu', envKey: 'NUXT_OLLAMA_BASE_URL' },
]

const form = reactive({
  provider: 'workers-ai',
  openaiApiKey: '',
  anthropicApiKey: '',
  geminiApiKey: '',
  deepseekApiKey: '',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2',
  gatewayId: '',
  gatewayToken: '',
})

// Shared with Settings → Media's Cloudflare Images/Stream fields (same `cloudflare.account_id`
// setting) — AI Gateway's universal endpoint URL needs it too, so it's surfaced here as well
// rather than sending the admin to a different page to find it.
const cloudflareAccountId = ref('')

const toast = useToast()
const saving = ref(false)
const testing = ref(false)
const testResult = ref<'ok' | 'error' | null>(null)

interface SiteData {
  site: { id: string; name: string; domain: string; locale: string; timezone: string; status: string }
  settings: Record<string, unknown>
}

const { data, refresh } = await useFetch<SiteData>('/api/v1/settings')

watch(data, (d) => {
  if (!d) return
  const s = d.settings
  form.provider = (s['ai.provider'] as string) ?? 'workers-ai'
  form.openaiApiKey = (s['ai.openai_api_key'] as string) ?? ''
  form.anthropicApiKey = (s['ai.anthropic_api_key'] as string) ?? ''
  form.geminiApiKey = (s['ai.gemini_api_key'] as string) ?? ''
  form.deepseekApiKey = (s['ai.deepseek_api_key'] as string) ?? ''
  form.ollamaBaseUrl = (s['ai.ollama_base_url'] as string) ?? 'http://localhost:11434'
  form.ollamaModel = (s['ai.ollama_model'] as string) ?? 'llama3.2'
  form.gatewayId = (s['ai.gateway_id'] as string) ?? ''
  form.gatewayToken = (s['ai.gateway_token'] as string) ?? ''
  cloudflareAccountId.value = (s['cloudflare.account_id'] as string) ?? ''
}, { immediate: true })

async function save() {
  saving.value = true
  try {
    await $fetch('/api/v1/settings', {
      method: 'PATCH',
      body: { ai: form, cloudflare: { accountId: cloudflareAccountId.value } },
    })
    toast.add({ title: 'AI Settings saved successfully', color: 'success' })
    await refresh()
  } catch {
    toast.add({ title: 'Failed to save AI Settings', color: 'error' })
  } finally {
    saving.value = false
  }
}

async function test() {
  testing.value = true
  testResult.value = null
  try {
    await $fetch('/api/v1/ai/improve', {
      method: 'POST',
      body: { text: 'Hello world' },
    })
    testResult.value = 'ok'
  } catch {
    testResult.value = 'error'
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl space-y-6">
    <div>
      <h1 class="text-xl font-bold text-gray-900 dark:text-white">AI Settings</h1>
      <p class="text-sm text-gray-500 mt-1">Configure your AI writing assistant provider and credentials.</p>
    </div>

    <UCard>
      <template #header>
        <p class="text-sm font-semibold">AI Provider</p>
      </template>

      <div class="space-y-4">
        <UFormField label="Active provider">
          <USelect
            v-model="form.provider"
            :items="providers.map(p => ({ label: p.label, value: p.value }))"
          />
        </UFormField>

        <template v-if="form.provider === 'workers-ai'">
          <UAlert
            icon="i-simple-icons-cloudflare"
            color="info"
            variant="soft"
            title="No API key needed"
            description="Runs on your own Cloudflare account via the Workers AI binding. Includes a free daily usage allowance; usage beyond that bills to your Cloudflare account at a fraction of a cent. Requires the [ai] binding in wrangler.toml (included by default) and the Workers Paid plan this project already requires."
          />
        </template>

        <template v-if="form.provider === 'openai'">
          <UFormField label="OpenAI API key" hint="sk-...">
            <UInput v-model="form.openaiApiKey" type="password" placeholder="sk-..." />
          </UFormField>
        </template>

        <template v-if="form.provider === 'anthropic'">
          <UFormField label="Anthropic API key" hint="sk-ant-...">
            <UInput v-model="form.anthropicApiKey" type="password" placeholder="sk-ant-..." />
          </UFormField>
        </template>

        <template v-if="form.provider === 'gemini'">
          <UFormField label="Google Gemini API key">
            <UInput v-model="form.geminiApiKey" type="password" placeholder="AIza..." />
          </UFormField>
        </template>

        <template v-if="form.provider === 'deepseek'">
          <UFormField label="DeepSeek API key" hint="sk-...">
            <UInput v-model="form.deepseekApiKey" type="password" placeholder="sk-..." />
          </UFormField>
        </template>

        <template v-if="form.provider === 'ollama'">
          <UFormField label="Ollama base URL">
            <UInput v-model="form.ollamaBaseUrl" placeholder="http://localhost:11434" />
          </UFormField>
          <UFormField label="Model">
            <UInput v-model="form.ollamaModel" placeholder="llama3.2" />
          </UFormField>
        </template>
      </div>

      <template #footer>
        <div class="flex items-center gap-3">
          <UButton :loading="saving" @click="save">Save</UButton>
          <UButton variant="outline" :loading="testing" @click="test">Test connection</UButton>
          <span v-if="testResult === 'ok'" class="text-sm text-green-600 flex items-center gap-1">
            <UIcon name="i-lucide-check-circle" /> Working
          </span>
          <span v-else-if="testResult === 'error'" class="text-sm text-red-500 flex items-center gap-1">
            <UIcon name="i-lucide-x-circle" /> Failed
          </span>
        </div>
      </template>
    </UCard>

    <UCard>
      <template #header>
        <p class="text-sm font-semibold">AI Gateway (optional)</p>
      </template>

      <div class="space-y-4">
        <p class="text-sm text-gray-500">
          Route every AI call above — Workers AI and any BYOK provider — through a
          <a href="https://developers.cloudflare.com/ai-gateway/" target="_blank" rel="noopener" class="underline">Cloudflare AI Gateway</a>
          for free response caching, request logging, and per-user spend visibility in the Cloudflare dashboard. Leave the gateway ID blank to skip it — every provider above works fine without one.
        </p>

        <UFormField label="Cloudflare account ID" hint="Also used by Cloudflare Images / Stream, if configured">
          <UInput v-model="cloudflareAccountId" placeholder="a1b2c3d4e5f6..." />
        </UFormField>

        <UFormField label="Gateway ID" hint="From Cloudflare dashboard → AI → AI Gateway">
          <UInput v-model="form.gatewayId" placeholder="my-gateway" />
        </UFormField>

        <UFormField label="Gateway auth token" hint="Only needed for an authenticated gateway — leave blank for an unauthenticated one">
          <UInput v-model="form.gatewayToken" type="password" placeholder="Cloudflare API token" />
        </UFormField>
      </div>
    </UCard>

    <UAlert
      icon="i-lucide-shield"
      color="info"
      variant="soft"
      title="Security note"
      description="API keys are safely stored in your database using AES-GCM at-rest encryption and are never exposed to the client."
    />
  </div>
</template>
