<script setup lang="ts">
import { FORM_FILE_ACCEPT, FORM_FILE_RULES_TEXT, FORM_FILES_PER_FIELD, formatFileSize, formFileProblem } from '#shared/lib/form-files'

// A form's file field: up to FORM_FILES_PER_FIELD files, checked here against the same rules
// the server applies (shared/lib/form-files.ts), so a visitor hears about a wrong file
// before they press Submit.
const props = defineProps<{ field: { label: string; required?: boolean; helpText?: string }; modelValue?: File[] | null }>()
const emit = defineEmits<{ 'update:modelValue': [v: File[]] }>()

const files = computed(() => props.modelValue ?? [])
const problem = ref('')
const input = ref<HTMLInputElement | null>(null)

function onFiles(e: Event) {
  const el = e.target as HTMLInputElement
  const picked = Array.from(el.files ?? [])
  el.value = ''
  problem.value = ''
  const next = [...files.value]
  for (const file of picked) {
    const issue = formFileProblem(file)
    if (issue) {
      problem.value = issue
      continue
    }
    if (next.length >= FORM_FILES_PER_FIELD) {
      problem.value = `You can send up to ${FORM_FILES_PER_FIELD} files here.`
      break
    }
    next.push(file)
  }
  emit('update:modelValue', next)
}

function remove(index: number) {
  problem.value = ''
  emit('update:modelValue', files.value.filter((_, i) => i !== index))
}
</script>

<template>
  <UFormField :label="field.label" :required="field.required" :hint="field.helpText" :help="FORM_FILE_RULES_TEXT" :error="problem || undefined">
    <div class="space-y-2">
      <ul v-if="files.length" class="space-y-1">
        <li v-for="(file, i) in files" :key="`${file.name}-${i}`" class="flex items-center justify-between gap-2 rounded-md border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm">
          <span class="truncate">{{ file.name }} <span class="opacity-60">({{ formatFileSize(file.size) }})</span></span>
          <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-x" :aria-label="`Remove ${file.name}`" @click="remove(i)" />
        </li>
      </ul>
      <input
        v-if="files.length < FORM_FILES_PER_FIELD"
        ref="input"
        type="file"
        multiple
        :accept="FORM_FILE_ACCEPT"
        :aria-label="field.label"
        class="block w-full text-sm text-gray-500 file:mr-4 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
        @change="onFiles"
      >
    </div>
  </UFormField>
</template>
