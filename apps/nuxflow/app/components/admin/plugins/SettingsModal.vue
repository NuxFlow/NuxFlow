<script setup lang="ts">
import type { PluginSettingField } from '#shared/lib/plugin-permissions'

// Settings form for one plugin, generated from the fields its manifest declares. Secret
// fields come back masked and are only replaced when the admin types a new value.
const props = defineProps<{ pluginId: string, pluginName: string }>()
const open = defineModel<boolean>('open', { default: false })

const { run, isRunning } = useAdminAction()
const fields = ref<PluginSettingField[]>([])
const values = ref<Record<string, unknown>>({})
const loading = computed(() => isRunning('load'))
const saving = computed(() => isRunning('save'))

async function load() {
  const url: string = `/api/v1/dynamic-plugins/${props.pluginId}/settings`
  const res = await run(() => $fetch<{ fields: PluginSettingField[], values: Record<string, unknown> }>(url), { errorTitle: "Couldn't load settings", key: 'load' })
  if (!res) {
    open.value = false
    return
  }
  fields.value = res.fields
  values.value = { ...res.values }
}

watch(open, (isOpen) => {
  if (isOpen) load()
}, { immediate: true })

async function save() {
  const url: string = `/api/v1/dynamic-plugins/${props.pluginId}/settings`
  const payload: Record<string, unknown> = {}
  for (const field of fields.value) {
    const v = values.value[field.key]
    payload[field.key] = field.type === 'number' && v !== '' && v !== null && v !== undefined ? Number(v) : v
  }
  await run(async () => {
    const res = await $fetch<{ values: Record<string, unknown> }>(url, { method: 'PATCH', body: { values: payload } })
    values.value = { ...res.values }
    open.value = false
  }, { successTitle: 'Plugin settings saved', errorTitle: "Couldn't save settings", key: 'save' })
}
</script>

<template>
  <UModal v-model:open="open" :title="`${pluginName} settings`">
    <template #body>
      <div v-if="loading" class="py-8 flex justify-center">
        <UIcon name="i-lucide-loader-circle" class="w-5 h-5 animate-spin text-gray-400" />
      </div>
      <form v-else class="space-y-4" @submit.prevent="save">
        <UFormField
          v-for="field in fields"
          :key="field.key"
          :label="field.label"
          :description="field.description"
          :required="field.required"
        >
          <USwitch v-if="field.type === 'toggle'" :model-value="Boolean(values[field.key])" @update:model-value="values[field.key] = $event" />
          <USelect
            v-else-if="field.type === 'select'"
            :model-value="(values[field.key] as string) ?? ''"
            :items="field.options ?? []"
            value-key="value"
            label-key="label"
            class="w-full"
            @update:model-value="values[field.key] = $event"
          />
          <UTextarea
            v-else-if="field.type === 'textarea'"
            :model-value="(values[field.key] as string) ?? ''"
            :rows="4"
            class="w-full"
            @update:model-value="values[field.key] = $event"
          />
          <UInput
            v-else
            :model-value="values[field.key] === null || values[field.key] === undefined ? '' : String(values[field.key])"
            :type="field.type === 'secret' ? 'password' : field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text'"
            :autocomplete="field.type === 'secret' ? 'off' : undefined"
            class="w-full"
            @update:model-value="values[field.key] = $event"
          />
        </UFormField>

        <p v-if="fields.some(f => f.type === 'secret')" class="text-xs text-gray-500 dark:text-gray-400">
          Secret values are stored encrypted and only the plugin can read them. Leave a secret as it is to keep it; clear it to remove it.
        </p>

        <div class="flex justify-end gap-2 border-t border-gray-100 dark:border-gray-800 pt-3">
          <UButton color="neutral" variant="ghost" @click="open = false">Cancel</UButton>
          <UButton type="submit" :loading="saving" icon="i-lucide-save">Save settings</UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
