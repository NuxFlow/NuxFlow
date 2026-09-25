<script setup lang="ts">
interface Preference {
  type: string
  label: string
  description: string
  email: boolean
  push: boolean
  emailLocked: boolean
}

const toast = useToast()
const { data, error } = await useFetch<{ preferences: Preference[] }>('/api/v1/account/notification-preferences')
const prefs = ref<Preference[]>([])
watch(data, (d) => { prefs.value = d ? d.preferences.map(p => ({ ...p })) : [] }, { immediate: true })

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await $fetch('/api/v1/account/notification-preferences', {
      method: 'PUT',
      body: { preferences: prefs.value.map(p => ({ type: p.type, email: p.email, push: p.push })) },
    })
    toast.add({ title: 'Notification preferences saved', color: 'success' })
  }
  catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'Could not save preferences'), color: 'error' })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <!-- A 403 means the account has no role on this site — nothing to configure. -->
  <UCard v-if="!error && prefs.length">
    <template #header>
      <p class="text-sm font-semibold text-gray-900 dark:text-white">Email and push notifications</p>
    </template>
    <div class="divide-y divide-gray-100 dark:divide-gray-800">
      <div class="grid grid-cols-[1fr_auto_auto] gap-x-6 pb-2 text-xs font-medium text-gray-400">
        <span />
        <span class="w-12 text-center">Email</span>
        <span class="w-12 text-center">Push</span>
      </div>
      <div v-for="p in prefs" :key="p.type" class="grid grid-cols-[1fr_auto_auto] gap-x-6 items-center py-3">
        <div class="min-w-0">
          <p class="text-sm font-medium text-gray-900 dark:text-white">{{ p.label }}</p>
          <p class="text-xs text-gray-400 mt-0.5">
            {{ p.description }}
            <template v-if="p.emailLocked"> Security alerts are always emailed.</template>
          </p>
        </div>
        <div class="w-12 flex justify-center">
          <USwitch v-model="p.email" :disabled="p.emailLocked" :aria-label="`Email: ${p.label}`" />
        </div>
        <div class="w-12 flex justify-center">
          <USwitch v-model="p.push" :aria-label="`Push: ${p.label}`" />
        </div>
      </div>
    </div>
    <template #footer>
      <div class="flex justify-end">
        <UButton :loading="saving" @click="save">Save preferences</UButton>
      </div>
    </template>
  </UCard>
</template>
