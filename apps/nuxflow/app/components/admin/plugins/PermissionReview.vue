<script setup lang="ts">
import { describePermission, type PluginPermissionRisk } from '#shared/lib/plugin-permissions'

// The approval step before a plugin with permissions is enabled: every permission it asks
// for, in plain words, with how much it could affect the site. Approving sends exactly
// this list back (enable.post.ts refuses one that doesn't match the plugin).
const props = defineProps<{
  pluginName: string
  permissions: string[]
  loading?: boolean
}>()
const emit = defineEmits<{ approve: [permissions: string[]] }>()
const open = defineModel<boolean>('open', { default: false })

const RISK: Record<PluginPermissionRisk, { label: string, color: 'success' | 'warning' | 'error', icon: string }> = {
  low: { label: 'Low impact', color: 'success', icon: 'i-lucide-shield-check' },
  medium: { label: 'Medium impact', color: 'warning', icon: 'i-lucide-shield' },
  high: { label: 'Can share data', color: 'error', icon: 'i-lucide-shield-alert' },
}

const rows = computed(() => props.permissions.map(p => ({ permission: p, ...describePermission(p) })))
const hasHighRisk = computed(() => rows.value.some(r => r.risk === 'high'))
</script>

<template>
  <UModal v-model:open="open" :title="`Enable ${pluginName}?`" description="Review what this plugin is asking to do on your site.">
    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-gray-600 dark:text-gray-300">
          {{ pluginName }} runs in its own sandbox. It can't reach your database, accounts or settings directly — only the things below, and only on this site.
        </p>

        <ul class="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-200 dark:border-gray-800 rounded-lg">
          <li v-for="row in rows" :key="row.permission" class="flex gap-3 p-3">
            <UIcon :name="RISK[row.risk].icon" class="w-5 h-5 shrink-0 mt-0.5" :class="{ 'text-green-500': row.risk === 'low', 'text-amber-500': row.risk === 'medium', 'text-red-500': row.risk === 'high' }" />
            <div class="min-w-0 flex-1 space-y-0.5">
              <div class="flex flex-wrap items-center gap-2">
                <p class="text-sm font-medium text-gray-900 dark:text-white">{{ row.title }}</p>
                <UBadge :color="RISK[row.risk].color" variant="soft" size="xs">{{ RISK[row.risk].label }}</UBadge>
              </div>
              <p class="text-xs text-gray-500 dark:text-gray-400">{{ row.description }}</p>
              <p class="text-[11px] font-mono text-gray-400 dark:text-gray-500 break-all">{{ row.permission }}</p>
            </div>
          </li>
        </ul>

        <UAlert
          v-if="hasHighRisk"
          icon="i-lucide-triangle-alert"
          color="warning"
          variant="soft"
          title="Only approve plugins you trust"
          description="This plugin can send information to outside services or receive visitors' personal details. Make sure you know who publishes it and why it needs this."
        />

        <p class="text-xs text-gray-500 dark:text-gray-400">
          If an update asks for anything new, the plugin is switched off until you approve it again.
        </p>

        <div class="flex justify-end gap-2 border-t border-gray-100 dark:border-gray-800 pt-3">
          <UButton color="neutral" variant="ghost" @click="open = false">Cancel</UButton>
          <UButton :loading="loading" icon="i-lucide-check" @click="emit('approve', [...permissions])">Approve and enable</UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
