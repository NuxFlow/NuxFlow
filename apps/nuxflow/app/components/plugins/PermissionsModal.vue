<script setup lang="ts">
const props = defineProps<{
  plugin: { id: string; name: string; settings?: Record<string, unknown> }
  permissions: string[]
}>()
const emit = defineEmits<{ approved: []; close: [] }>()

const loading = ref(false)

async function approve() {
  loading.value = true
  try {
    await $fetch(`/api/v1/plugins/${props.plugin.id}/approve-permissions`, { method: 'POST' })
    emit('approved')
  } finally {
    loading.value = false
  }
}

const permissionDescriptions: Record<string, string> = {
  'read:content': 'Read all content items and revisions',
  'write:content': 'Create and update content items',
  'delete:content': 'Delete content items',
  'read:users': 'Read user profiles and roles',
  'write:users': 'Update user roles and profiles',
  'send:email': 'Send emails on behalf of the site',
  'read:media': 'Access media library files',
  'write:media': 'Upload and delete media files',
}
</script>

<template>
  <div class="space-y-4">
    <div>
      <h3 class="font-semibold text-gray-900 dark:text-white">{{ plugin.name }} — Permission request</h3>
      <p class="text-sm text-gray-500 mt-1">This plugin is requesting the following permissions. Review carefully before approving.</p>
    </div>

    <ul class="space-y-2">
      <li
        v-for="perm in permissions"
        :key="perm"
        class="flex items-start gap-2 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800"
      >
        <UIcon name="i-lucide-shield" class="w-4 h-4 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
        <div>
          <p class="text-sm font-mono font-medium text-yellow-800 dark:text-yellow-300">{{ perm }}</p>
          <p class="text-xs text-yellow-600 dark:text-yellow-500">{{ permissionDescriptions[perm] ?? perm }}</p>
        </div>
      </li>
    </ul>

    <div class="flex justify-end gap-2 pt-2">
      <UButton variant="ghost" @click="emit('close')">Decline</UButton>
      <UButton color="yellow" :loading="loading" @click="approve">Approve & enable</UButton>
    </div>
  </div>
</template>
