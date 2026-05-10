<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

const router = useRouter()

const form = reactive({
  name: '',
  domain: '',
  locale: 'en',
  timezone: 'UTC',
  adminName: '',
  adminEmail: '',
  adminPassword: '',
})

const saving = ref(false)
const error = ref('')

async function create() {
  saving.value = true
  error.value = ''
  try {
    await $fetch<{ siteId: string }>('/api/v1/admin/sites', {
      method: 'POST',
      body: {
        name: form.name,
        domain: form.domain,
        locale: form.locale,
        timezone: form.timezone,
        admin: { name: form.adminName, email: form.adminEmail, password: form.adminPassword },
      },
    })
    await router.push('/admin/super/sites')
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Failed to create site'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl space-y-6">
    <div class="flex items-center gap-3">
      <UButton to="/admin/super/sites" variant="ghost" icon="i-lucide-arrow-left" size="sm" />
      <h1 class="text-xl font-bold text-gray-900 dark:text-white">New Site</h1>
    </div>

    <UCard>
      <template #header>
        <p class="text-sm font-semibold">Site details</p>
      </template>
      <div class="space-y-4">
        <UFormField label="Site name" required>
          <UInput v-model="form.name" placeholder="My Blog" />
        </UFormField>
        <UFormField label="Domain" hint="Used to route requests to this site">
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

    <UCard>
      <template #header>
        <p class="text-sm font-semibold">Initial admin user</p>
      </template>
      <div class="space-y-4">
        <UFormField label="Name" required>
          <UInput v-model="form.adminName" placeholder="Jane Smith" />
        </UFormField>
        <UFormField label="Email" required>
          <UInput v-model="form.adminEmail" type="email" placeholder="jane@example.com" />
        </UFormField>
        <UFormField label="Password" required>
          <UInput v-model="form.adminPassword" type="password" placeholder="••••••••" />
        </UFormField>
      </div>
    </UCard>

    <UAlert v-if="error" color="red" variant="soft" :description="error" />

    <div class="flex justify-end">
      <UButton :loading="saving" :disabled="!form.name || !form.adminEmail" @click="create">
        Create site
      </UButton>
    </div>
  </div>
</template>
