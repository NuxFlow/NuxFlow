<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

const providers = [
  { value: 'openai', label: 'OpenAI', icon: 'i-simple-icons-openai', envKey: 'NUXT_OPENAI_API_KEY' },
  { value: 'anthropic', label: 'Anthropic', icon: 'i-simple-icons-anthropic', envKey: 'NUXT_ANTHROPIC_API_KEY' },
  { value: 'gemini', label: 'Google Gemini', icon: 'i-simple-icons-google', envKey: 'NUXT_GEMINI_API_KEY' },
  { value: 'ollama', label: 'Ollama (local)', icon: 'i-lucide-cpu', envKey: 'NUXT_OLLAMA_BASE_URL' },
]

const form = reactive({
  provider: 'openai',
  openaiApiKey: '',
  anthropicApiKey: '',
  geminiApiKey: '',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2',
})

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
  form.provider = (s['ai.provider'] as string) ?? 'openai'
  form.openaiApiKey = (s['ai.openai_api_key'] as string) ?? ''
  form.anthropicApiKey = (s['ai.anthropic_api_key'] as string) ?? ''
  form.geminiApiKey = (s['ai.gemini_api_key'] as string) ?? ''
  form.ollamaBaseUrl = (s['ai.ollama_base_url'] as string) ?? 'http://localhost:11434'
  form.ollamaModel = (s['ai.ollama_model'] as string) ?? 'llama3.2'
}, { immediate: true })

async function save() {
  saving.value = true
  try {
    await $fetch('/api/v1/settings', { method: 'PATCH', body: { ai: form } })
    toast.add({ title: 'AI Settings saved successfully', color: 'green' })
    await refresh()
  } catch {
    toast.add({ title: 'Failed to save AI Settings', color: 'red' })
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

    <UAlert
      icon="i-lucide-shield"
      color="blue"
      variant="soft"
      title="Security note"
      description="API keys are safely stored in your database using AES-GCM at-rest encryption and are never exposed to the client."
    />
  </div>
</template>
