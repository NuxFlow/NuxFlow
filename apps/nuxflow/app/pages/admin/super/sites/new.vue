<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

const router = useRouter()

const form = reactive({
  name: '',
  domain: '',
  locale: 'en',
  timezone: 'UTC',
})

const saving = ref(false)
const error = ref('')
const setupUrl = ref('')
const copied = ref(false)

async function create() {
  saving.value = true
  error.value = ''
  try {
    const res = await $fetch<{ id: string; setupToken: string }>('/api/v1/admin/sites', {
      method: 'POST',
      body: {
        name: form.name,
        domain: form.domain,
        locale: form.locale,
        timezone: form.timezone,
      },
    })
    setupUrl.value = `https://${form.domain}/setup?token=${res.setupToken}`
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Failed to create site'
  } finally {
    saving.value = false
  }
}

async function copySetupUrl() {
  await navigator.clipboard.writeText(setupUrl.value)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

function done() {
  router.push('/admin/super/sites')
}
</script>

<template>
  <div class="max-w-2xl space-y-6">
    <div class="flex items-center gap-3">
      <UButton to="/admin/super/sites" variant="ghost" icon="i-lucide-arrow-left" size="sm" />
      <h1 class="text-xl font-bold text-gray-900 dark:text-white">New Site</h1>
    </div>

    <template v-if="setupUrl">
      <UCard>
        <template #header>
          <p class="text-sm font-semibold text-gray-900 dark:text-white">Site created</p>
        </template>
        <div class="space-y-3">
          <p class="text-sm text-gray-500">
            Send this one-time setup link to whoever will configure the site. It only works once, and it's shown here only this one time — it can't be retrieved again if lost.
          </p>
          <div class="flex items-center gap-2">
            <UInput :model-value="setupUrl" readonly class="flex-1 font-mono text-xs" />
            <UButton :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'" variant="soft" @click="copySetupUrl">
              {{ copied ? 'Copied' : 'Copy' }}
            </UButton>
          </div>
        </div>
      </UCard>
      <div class="flex justify-end">
        <UButton @click="done">Done</UButton>
      </div>
    </template>

    <template v-else>
      <UCard>
        <template #header>
          <p class="text-sm font-semibold text-gray-900 dark:text-white">Site details</p>
        </template>
        <div class="space-y-4">
          <UFormField label="Site name" required>
            <UInput v-model="form.name" placeholder="My Blog" />
          </UFormField>
          <UFormField label="Domain" required hint="Used to route requests to this site">
            <UInput v-model="form.domain" placeholder="myblog.com" />
          </UFormField>
          <div class="grid grid-cols-2 gap-4">
            <UFormField label="Default locale">
              <UInput v-model="form.locale" placeholder="en" />
            </UFormField>
            <UFormField label="Timezone">
              <UInput v-model="form.timezone" placeholder="UTC" />
            </UFormField>
          </div>
        </div>
      </UCard>

      <UAlert v-if="error" color="red" variant="soft" :description="error" />

      <div class="flex justify-end">
        <UButton :loading="saving" :disabled="!form.name || !form.domain" @click="create">
          Create site
        </UButton>
      </div>
    </template>
  </div>
</template>
