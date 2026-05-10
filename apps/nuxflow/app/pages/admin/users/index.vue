<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

type UserRow = { id: string; name: string; email: string; role: string; createdAt: string }
const { data, refresh } = await useFetch<{ users: UserRow[] }>('/api/v1/users')
const users = computed(() => data.value?.users ?? [])

const showInvite = ref(false)
const inviteForm = reactive({ name: '', email: '', role: 'viewer' as string })
const inviting = ref(false)
const inviteError = ref('')

const roleOptions = [
  { label: 'Admin', value: 'admin' },
  { label: 'Editor', value: 'editor' },
  { label: 'Author', value: 'author' },
  { label: 'Viewer', value: 'viewer' },
  { label: 'Member', value: 'member' },
]

async function invite() {
  inviteError.value = ''
  inviting.value = true
  try {
    await $fetch('/api/v1/users', { method: 'POST', body: inviteForm })
    showInvite.value = false
    inviteForm.name = ''
    inviteForm.email = ''
    inviteForm.role = 'viewer'
    await refresh()
  } catch (e: unknown) {
    inviteError.value = (e as { data?: { message?: string } })?.data?.message ?? 'Failed to invite user'
  } finally {
    inviting.value = false
  }
}

async function updateRole(userId: string, role: string) {
  await $fetch(`/api/v1/users/${userId}`, { method: 'PATCH', body: { role } })
  await refresh()
}

type Color = 'red' | 'orange' | 'blue' | 'green' | 'gray' | 'primary' | 'neutral'
const roleColor: Record<string, Color> = {
  super_admin: 'red', admin: 'orange', editor: 'blue',
  author: 'green', member: 'gray', viewer: 'gray',
}

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'email', header: 'Email' },
  { accessorKey: 'role', header: 'Role' },
  { accessorKey: 'createdAt', header: 'Joined' },
]
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold text-gray-900 dark:text-white">Users</h1>
      <UButton icon="i-lucide-user-plus" @click="showInvite = true">Invite user</UButton>
    </div>

    <UCard>
      <UTable :data="users" :columns="columns">
        <template #name-cell="{ row }">
          <div class="flex items-center gap-3">
            <UAvatar :alt="row.original.name" size="sm" />
            <span class="font-medium text-gray-900 dark:text-white">{{ row.original.name }}</span>
          </div>
        </template>

        <template #email-cell="{ row }">
          <span class="text-sm text-gray-500 dark:text-gray-400">{{ row.original.email }}</span>
        </template>

        <template #role-cell="{ row }">
          <USelect
            :model-value="row.original.role"
            :items="roleOptions"
            size="xs"
            class="min-w-28"
            :disabled="row.original.role === 'super_admin'"
            @update:model-value="(val) => updateRole(row.original.id, val as string)"
          >
            <template #leading>
              <UBadge :color="roleColor[row.original.role] ?? 'neutral'" variant="soft" size="xs" class="capitalize mr-1">
                {{ row.original.role.replace('_', ' ') }}
              </UBadge>
            </template>
          </USelect>
        </template>

        <template #createdAt-cell="{ row }">
          <span class="text-sm text-gray-400">{{ new Date(row.original.createdAt).toLocaleDateString() }}</span>
        </template>
      </UTable>
    </UCard>

    <UModal v-model="showInvite">
      <UCard>
        <template #header>
          <p class="text-sm font-semibold">Invite user</p>
        </template>

        <div class="space-y-4">
          <UFormField label="Full name" required>
            <UInput v-model="inviteForm.name" placeholder="Jane Smith" autofocus />
          </UFormField>

          <UFormField label="Email address" required>
            <UInput v-model="inviteForm.email" type="email" placeholder="jane@example.com" />
          </UFormField>

          <UFormField label="Role">
            <USelect v-model="inviteForm.role" :items="roleOptions" />
          </UFormField>

          <p v-if="inviteError" class="text-sm text-red-500">{{ inviteError }}</p>
        </div>

        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton variant="ghost" @click="showInvite = false">Cancel</UButton>
            <UButton
              :loading="inviting"
              :disabled="!inviteForm.name || !inviteForm.email"
              @click="invite"
            >
              Send invite
            </UButton>
          </div>
        </template>
      </UCard>
    </UModal>
  </div>
</template>
