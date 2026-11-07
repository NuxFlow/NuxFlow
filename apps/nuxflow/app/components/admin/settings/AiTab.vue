<script setup lang="ts">
import type { AiState, CloudflareMediaState } from '~/types/admin-settings'

const ai = defineModel<AiState>('ai', { required: true })
// Shared with the Media tab (same `cloudflare.account_id` setting): AI Gateway's URL needs it
// too, so it's here as well rather than sending the admin to another tab to find it.
const cloudflare = defineModel<CloudflareMediaState>('cloudflare', { required: true })
const props = withDefaults(defineProps<{
  /** False for a customer site on a hosting platform, which isn't offered Ollama. */
  ollamaAvailable?: boolean
}>(), { ollamaAvailable: true })

const allProviderOptions = [
  { label: 'Cloudflare Workers AI (recommended)', value: 'workers-ai' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'Google Gemini', value: 'gemini' },
  { label: 'DeepSeek', value: 'deepseek' },
  { label: 'Ollama (self-hosted)', value: 'ollama' },
]
const aiProviderOptions = computed(() => props.ollamaAvailable ? allProviderOptions : allProviderOptions.filter(o => o.value !== 'ollama'))

// Saved on its own, never by the page's shared Save. That one sends every tab, so it used to
// write a provider on sites that had never chosen one, moving them off Workers AI.
const { run, isRunning } = useAdminAction()
async function save() {
  await run(() => $fetch<unknown>('/api/v1/settings', {
    method: 'PATCH',
    body: { ai: ai.value, cloudflare: { accountId: cloudflare.value.accountId } },
  }), { successTitle: 'AI settings saved', errorTitle: "Couldn't save AI settings", key: 'save' })
}

// Not useAdminAction(): the result is shown inline next to the button.
const testing = ref(false)
const testResult = ref<'ok' | 'error' | null>(null)
async function test() {
  testing.value = true
  testResult.value = null
  try {
    await $fetch<unknown>('/api/v1/ai/improve', { method: 'POST', body: { text: 'Hello world' } })
    testResult.value = 'ok'
  }
  catch {
    testResult.value = 'error'
  }
  finally {
    testing.value = false
  }
}

// Flags an address the Worker can never reach (see the template note).
const isLocalOllamaUrl = computed(() => {
  try {
    const host = new URL(ai.value.ollamaBaseUrl || 'http://localhost').hostname
    return host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost')
      || /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.)/.test(host) || host === '[::1]'
  }
  catch {
    return false
  }
})
</script>

<template>
  <div class="space-y-4">
    <UCard>
      <template #header><p class="text-sm font-semibold text-gray-900 dark:text-white">AI Configuration</p></template>
      <div class="space-y-4">
        <UFormField label="Provider">
          <USelect v-model="ai.provider" :items="aiProviderOptions" class="w-full" />
        </UFormField>

        <UAlert
          v-if="ai.provider === 'workers-ai'"
          icon="i-simple-icons-cloudflare"
          color="info"
          variant="soft"
          title="No API key needed"
          description="Runs on your own Cloudflare account via the Workers AI binding. Includes a free daily usage allowance; usage beyond that bills to your Cloudflare account at a fraction of a cent. Needs the [ai] block in wrangler.toml uncommented, and the Workers Paid plan this project already requires."
        />

        <template v-if="ai.provider === 'openai'">
          <UFormField label="OpenAI API Key">
            <UInput v-model="ai.openaiApiKey" type="password" placeholder="sk-..." />
          </UFormField>
        </template>

        <template v-if="ai.provider === 'anthropic'">
          <UFormField label="Anthropic API Key">
            <UInput v-model="ai.anthropicApiKey" type="password" placeholder="sk-ant-..." />
          </UFormField>
        </template>

        <template v-if="ai.provider === 'gemini'">
          <UFormField label="Google Gemini API Key">
            <UInput v-model="ai.geminiApiKey" type="password" placeholder="AIza..." />
          </UFormField>
        </template>

        <template v-if="ai.provider === 'deepseek'">
          <UFormField label="DeepSeek API Key">
            <UInput v-model="ai.deepseekApiKey" type="password" placeholder="sk-..." />
          </UFormField>
        </template>

        <template v-if="ai.provider === 'ollama'">
          <UAlert
            v-if="isLocalOllamaUrl"
            color="warning"
            variant="soft"
            icon="i-lucide-triangle-alert"
            title="This address can't be reached from Cloudflare"
            description="NuxFlow runs on Cloudflare's network, so localhost and private addresses never reach your machine. Expose Ollama at a public HTTPS address (for example with a Cloudflare Tunnel) and enter that here."
          />
          <UFormField label="Ollama Base URL" help="A public HTTPS address — Cloudflare's servers make the request, not your browser.">
            <UInput v-model="ai.ollamaBaseUrl" class="w-full" placeholder="https://ollama.example.com" />
          </UFormField>
          <UFormField label="Ollama Model">
            <UInput v-model="ai.ollamaModel" placeholder="llama3.2" />
          </UFormField>
        </template>
      </div>
    </UCard>

    <UCard>
      <template #header><p class="text-sm font-semibold text-gray-900 dark:text-white">AI Gateway (optional)</p></template>
      <div class="space-y-4">
        <p class="text-sm text-gray-500">
          Route every AI call above — Workers AI and any provider with its own key — through a
          <a href="https://developers.cloudflare.com/ai-gateway/" target="_blank" rel="noopener" class="underline">Cloudflare AI Gateway</a>
          for free response caching, request logging, and per-user spend visibility in the Cloudflare dashboard. Leave the gateway ID blank to skip it — every provider above works fine without one.
        </p>

        <UFormField label="Cloudflare account ID" hint="Also used by Cloudflare Images / Stream, if configured">
          <UInput v-model="cloudflare.accountId" placeholder="a1b2c3d4e5f6..." />
        </UFormField>

        <UFormField label="Gateway ID" hint="From Cloudflare dashboard → AI → AI Gateway">
          <UInput v-model="ai.gatewayId" placeholder="my-gateway" />
        </UFormField>

        <UFormField label="Gateway auth token" hint="Only needed for an authenticated gateway — leave blank for an unauthenticated one">
          <UInput v-model="ai.gatewayToken" type="password" placeholder="Cloudflare API token" />
        </UFormField>
      </div>
      <template #footer>
        <div class="flex items-center justify-end gap-3">
          <span v-if="testResult === 'ok'" class="text-sm text-green-600 flex items-center gap-1">
            <UIcon name="i-lucide-check-circle" /> Working
          </span>
          <span v-else-if="testResult === 'error'" class="text-sm text-red-500 flex items-center gap-1">
            <UIcon name="i-lucide-x-circle" /> Failed
          </span>
          <UButton variant="outline" :loading="testing" @click="test">Test saved settings</UButton>
          <UButton :loading="isRunning('save')" @click="save">Save AI settings</UButton>
        </div>
      </template>
    </UCard>

    <UAlert
      icon="i-lucide-shield"
      color="info"
      variant="soft"
      title="Security note"
      description="API keys are stored in your database with AES-GCM encryption at rest and are never exposed to the client."
    />
  </div>
</template>
