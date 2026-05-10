<script setup lang="ts">
const props = defineProps<{
  modelValue: { tursoUrl: string; tursoAuthToken: string }
}>()
const emit = defineEmits<{ 'update:modelValue': [v: typeof props.modelValue] }>()

const local = reactive({ ...props.modelValue })
watch(local, (v) => emit('update:modelValue', { ...v }))

const testing = ref(false)
const testResult = ref<'ok' | 'error' | null>(null)
const testError = ref('')

async function testConnection() {
  testing.value = true
  testResult.value = null
  testError.value = ''
  try {
    await $fetch('/api/v1/setup/test-db', {
      method: 'POST',
      body: { tursoUrl: local.tursoUrl, tursoAuthToken: local.tursoAuthToken },
    })
    testResult.value = 'ok'
  } catch (e: unknown) {
    testResult.value = 'error'
    testError.value = e instanceof Error ? e.message : 'Connection failed'
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div>
      <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Database connection</h3>
      <p class="text-sm text-gray-500 mt-1">
        NuxFlow uses <a href="https://turso.tech" target="_blank" class="text-primary-500 hover:underline">Turso</a> (libSQL) as its database.
        Create a free database at turso.tech and paste your credentials below.
      </p>
    </div>

    <UFormField label="Database URL" hint="libsql://your-db.turso.io">
      <UInput v-model="local.tursoUrl" placeholder="libsql://your-db-name.turso.io" />
    </UFormField>

    <UFormField label="Auth token">
      <UInput v-model="local.tursoAuthToken" type="password" placeholder="eyJ..." />
    </UFormField>

    <div class="flex items-center gap-3">
      <UButton
        variant="outline"
        size="sm"
        icon="i-lucide-plug"
        :loading="testing"
        :disabled="!local.tursoUrl"
        @click="testConnection"
      >
        Test connection
      </UButton>
      <span v-if="testResult === 'ok'" class="text-sm text-green-600 flex items-center gap-1">
        <UIcon name="i-lucide-check-circle" class="w-4 h-4" /> Connected
      </span>
      <span v-else-if="testResult === 'error'" class="text-sm text-red-500 flex items-center gap-1">
        <UIcon name="i-lucide-x-circle" class="w-4 h-4" /> {{ testError }}
      </span>
    </div>

    <UAlert
      icon="i-lucide-info"
      color="blue"
      variant="soft"
      description="You can also set NUXT_TURSO_URL and NUXT_TURSO_AUTH_TOKEN in your environment and skip this step."
    />
  </div>
</template>
