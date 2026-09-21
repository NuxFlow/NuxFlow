<script setup lang="ts">
const restoreFile = ref<File | null>(null)
const restoreWhat = ref(['content', 'taxonomies', 'menus', 'forms'])
const restoreConflict = ref<'skip' | 'overwrite' | 'archive'>('skip')
const restoring = ref(false)
const restoreResult = ref<{
  result: {
    site: { updated: boolean }
    content: { created: number; updated: number; skipped: number }
    taxonomies: { created: number }
    terms: { created: number }
    menus: { created: number }
    forms: { created: number }
    settings: { updated: number }
    themes: { created: number; updated: number; skipped: number }
    plugins: { created: number; updated: number; skipped: number; rejected: number }
    users: { created: number; updated: number; skipped: number }
    membershipTiers: { created: number; updated: number; skipped: number }
  }
  media: { uploaded: number; skipped: number }
} | null>(null)
const restoreError = ref('')

const restoreWhatOptions = [
  { value: 'content', label: 'Content (pages & posts)' },
  { value: 'taxonomies', label: 'Categories & Tags' },
  { value: 'menus', label: 'Menus' },
  { value: 'forms', label: 'Forms' },
  { value: 'settings', label: 'Site settings' },
  { value: 'site', label: 'Site info (name, locale, timezone)' },
  { value: 'themes', label: 'Themes (CSS)' },
  { value: 'plugins', label: 'Dynamic plugins (code)' },
  { value: 'users', label: 'Team members & roles' },
  { value: 'membershipTiers', label: 'Membership tiers' },
]

function onRestoreFile(e: Event) {
  const input = e.target as HTMLInputElement
  restoreFile.value = input.files?.[0] ?? null
  restoreResult.value = null
  restoreError.value = ''
}

async function runRestore() {
  if (!restoreFile.value) return
  restoring.value = true
  restoreError.value = ''
  restoreResult.value = null
  try {
    const formData = new FormData()
    formData.append('file', restoreFile.value)
    const params = new URLSearchParams({
      what: restoreWhat.value.join(','),
      conflictMode: restoreConflict.value,
    })
    const res = await $fetch<typeof restoreResult.value>(`/api/v1/restore?${params}`, {
      method: 'POST',
      body: formData,
    })
    restoreResult.value = res
  } catch (e: unknown) {
    restoreError.value = getErrorMessage(e, 'Restore failed. Check the file and try again.')
  } finally {
    restoring.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-lg bg-orange-50 dark:bg-orange-900/30 flex items-center justify-center">
          <UIcon name="i-lucide-history" class="w-5 h-5 text-orange-600 dark:text-orange-400" />
        </div>
        <div>
          <p class="font-semibold text-sm text-gray-900 dark:text-white">Restore from backup</p>
          <p class="text-xs text-gray-400">Import a .json backup file exported from NuxFlow</p>
        </div>
      </div>
    </template>

    <div class="space-y-5">
      <UFormField label="Backup file (.json)">
        <div
          class="relative flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl px-6 py-8 hover:border-primary-400 transition-colors cursor-pointer"
          @click="($refs.restoreFileInput as HTMLInputElement).click()"
        >
          <UIcon name="i-lucide-file-json" class="w-8 h-8 text-gray-400" />
          <p class="text-sm text-gray-500">
            <span v-if="restoreFile" class="font-medium text-gray-900 dark:text-white">{{ restoreFile.name }}</span>
            <span v-else>Click to select a NuxFlow backup file</span>
          </p>
          <p v-if="!restoreFile" class="text-xs text-gray-400">.zip (with images) or .json (content only)</p>
          <input ref="restoreFileInput" type="file" accept=".zip,.json" class="sr-only" @change="onRestoreFile">
        </div>
      </UFormField>

      <UFormField label="What to restore">
        <div class="space-y-2">
          <label
            v-for="opt in restoreWhatOptions"
            :key="opt.value"
            class="flex items-center gap-2 text-sm cursor-pointer text-gray-700 dark:text-gray-300"
          >
            <input
              v-model="restoreWhat"
              type="checkbox"
              :value="opt.value"
              class="rounded text-primary-500"
            >
            {{ opt.label }}
          </label>
        </div>
      </UFormField>

      <UAlert
        v-if="restoreWhat.includes('users')"
        icon="i-lucide-users"
        color="warning"
        variant="soft"
        description="For any team member not already on this site, restoring creates a real account and emails them a set-password link — same as a normal invite. Never restores super admin access."
      />

      <UFormField label="Conflict handling" hint="What to do when a slug already exists">
        <div class="flex flex-wrap gap-4">
          <label class="flex items-center gap-2 text-sm cursor-pointer text-gray-700 dark:text-gray-300">
            <input v-model="restoreConflict" type="radio" value="skip" class="text-primary-500">
            Skip (keep existing)
          </label>
          <label class="flex items-center gap-2 text-sm cursor-pointer text-gray-700 dark:text-gray-300">
            <input v-model="restoreConflict" type="radio" value="overwrite" class="text-primary-500">
            Overwrite
          </label>
          <label class="flex items-center gap-2 text-sm cursor-pointer text-gray-700 dark:text-gray-300">
            <input v-model="restoreConflict" type="radio" value="archive" class="text-primary-500">
            Archive existing (keep both)
          </label>
        </div>
      </UFormField>

      <UAlert v-if="restoreError" icon="i-lucide-circle-x" color="error" variant="soft" :description="restoreError" />

      <UAlert
        v-if="restoreResult"
        icon="i-lucide-circle-check"
        color="success"
        variant="soft"
        title="Restore complete"
      >
        <template #description>
          <ul class="text-sm space-y-0.5 mt-1">
            <li v-if="restoreResult.result.site.updated">Site info: updated</li>
            <li>Content: {{ restoreResult.result.content.created }} created<span v-if="restoreResult.result.content.updated">, {{ restoreResult.result.content.updated }} updated</span>, {{ restoreResult.result.content.skipped }} skipped</li>
            <li>Taxonomies: {{ restoreResult.result.taxonomies.created }} created, {{ restoreResult.result.terms.created }} terms</li>
            <li>Menus: {{ restoreResult.result.menus.created }} created</li>
            <li>Forms: {{ restoreResult.result.forms.created }} created</li>
            <li v-if="restoreResult.result.settings.updated">Settings: {{ restoreResult.result.settings.updated }} updated</li>
            <li v-if="restoreResult.result.themes.created || restoreResult.result.themes.updated || restoreResult.result.themes.skipped">
              Themes: {{ restoreResult.result.themes.created }} created<span v-if="restoreResult.result.themes.updated">, {{ restoreResult.result.themes.updated }} updated</span><span v-if="restoreResult.result.themes.skipped">, {{ restoreResult.result.themes.skipped }} skipped</span> (installed inactive — activate from Admin → Themes)
            </li>
            <li v-if="restoreResult.result.plugins.created || restoreResult.result.plugins.updated || restoreResult.result.plugins.skipped || restoreResult.result.plugins.rejected">
              Plugins: {{ restoreResult.result.plugins.created }} created<span v-if="restoreResult.result.plugins.updated">, {{ restoreResult.result.plugins.updated }} updated</span><span v-if="restoreResult.result.plugins.skipped">, {{ restoreResult.result.plugins.skipped }} skipped</span><span v-if="restoreResult.result.plugins.rejected" class="text-orange-500">, {{ restoreResult.result.plugins.rejected }} rejected (signature/checksum mismatch)</span> (installed inactive — activate from Admin → Plugins)
            </li>
            <li v-if="restoreResult.result.users.created || restoreResult.result.users.updated || restoreResult.result.users.skipped">
              Team members: {{ restoreResult.result.users.created }} created<span v-if="restoreResult.result.users.updated">, {{ restoreResult.result.users.updated }} updated</span><span v-if="restoreResult.result.users.skipped">, {{ restoreResult.result.users.skipped }} skipped</span>
            </li>
            <li v-if="restoreResult.result.membershipTiers.created || restoreResult.result.membershipTiers.updated || restoreResult.result.membershipTiers.skipped">
              Membership tiers: {{ restoreResult.result.membershipTiers.created }} created<span v-if="restoreResult.result.membershipTiers.updated">, {{ restoreResult.result.membershipTiers.updated }} updated</span><span v-if="restoreResult.result.membershipTiers.skipped">, {{ restoreResult.result.membershipTiers.skipped }} skipped</span>
            </li>
            <li v-if="restoreResult.media.uploaded">Media: {{ restoreResult.media.uploaded }} images uploaded<span v-if="restoreResult.media.skipped">, {{ restoreResult.media.skipped }} skipped</span></li>
          </ul>
        </template>
      </UAlert>
    </div>

    <template #footer>
      <div class="flex items-center justify-between">
        <p class="text-xs text-gray-400">NuxFlow .zip (full) or .json (content only) backup files</p>
        <UButton
          color="orange"
          :loading="restoring"
          :disabled="!restoreFile || restoreWhat.length === 0"
          icon="i-lucide-history"
          @click="runRestore"
        >
          Restore
        </UButton>
      </div>
    </template>
  </UCard>
</template>
