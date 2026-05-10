<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

const route = useRoute()
const id = route.params.id as string
const isNew = id === 'new'


const fieldTypes = [
  { label: 'Short text', type: 'text', icon: 'i-lucide-type' },
  { label: 'Long text', type: 'textarea', icon: 'i-lucide-align-left' },
  { label: 'Email', type: 'email', icon: 'i-lucide-mail' },
  { label: 'Number', type: 'number', icon: 'i-lucide-hash' },
  { label: 'Select', type: 'select', icon: 'i-lucide-chevrons-up-down' },
  { label: 'Checkbox', type: 'checkbox', icon: 'i-lucide-check-square' },
  { label: 'Date', type: 'date', icon: 'i-lucide-calendar' },
  { label: 'File upload', type: 'file', icon: 'i-lucide-upload' },
  { label: 'Computed', type: 'computed', icon: 'i-lucide-function-square' },
]

interface FormField { id: string; type: string; label: string; name: string; required?: boolean }

const name = ref('Untitled form')
const slug = ref('untitled-form')
const fields = ref<FormField[]>([])
const selectedField = ref<FormField | null>(null)
const saving = ref(false)

watch(name, (v) => {
  if (isNew) slug.value = v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
})

function addField(type: string) {
  const label = fieldTypes.find(f => f.type === type)?.label ?? type
  const field: FormField = { id: `field_${Date.now()}`, type, label, name: type + '_' + fields.value.length, required: false }
  fields.value.push(field)
  selectedField.value = field
}

function removeField(id: string) {
  fields.value = fields.value.filter(f => f.id !== id)
  if (selectedField.value?.id === id) selectedField.value = null
}

async function save() {
  saving.value = true
  try {
    const body = { name: name.value, slug: slug.value, fields: fields.value, logic: [] }
    if (isNew) {
      const result = await $fetch<{ id: string }>('/api/v1/forms', { method: 'POST', body })
      await navigateTo(`/admin/forms/${result.id}/edit`)
    } else {
      await $fetch(`/api/v1/forms/${id}`, { method: 'PATCH', body })
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex gap-6 h-full">
    <!-- Field palette -->
    <aside class="w-52 shrink-0 space-y-1">
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Add field</p>
      <button
        v-for="ft in fieldTypes"
        :key="ft.type"
        class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        @click="addField(ft.type)"
      >
        <UIcon :name="ft.icon" class="w-4 h-4 shrink-0" />
        {{ ft.label }}
      </button>
    </aside>

    <!-- Canvas -->
    <div class="flex-1 space-y-4">
      <div class="flex items-center justify-between">
        <UInput v-model="name" class="text-lg font-bold border-0 shadow-none" />
        <div class="flex gap-2">
          <UButton :to="`/admin/forms/${id}/submissions`" variant="outline" icon="i-lucide-inbox" size="sm">Submissions</UButton>
          <UButton :loading="saving" @click="save">Save form</UButton>
        </div>
      </div>

      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 min-h-96 p-4 space-y-3">
        <div
          v-for="field in fields"
          :key="field.id"
          class="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors"
          :class="selectedField?.id === field.id
            ? 'border-primary-400 bg-primary-50 dark:bg-primary-950'
            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'"
          @click="selectedField = field"
        >
          <UIcon name="i-lucide-grip-vertical" class="w-4 h-4 text-gray-300 cursor-grab" />
          <div class="flex-1">
            <p class="text-sm font-medium text-gray-900 dark:text-white">{{ field.label }}</p>
            <p class="text-xs text-gray-400">{{ field.type }}<span v-if="field.required" class="text-red-400 ml-1">*</span></p>
          </div>
          <UButton variant="ghost" size="xs" icon="i-lucide-trash-2" color="red" @click.stop="removeField(field.id)" />
        </div>

        <div v-if="!fields.length" class="text-center py-12 text-gray-400">
          <UIcon name="i-lucide-list-plus" class="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p class="text-sm">Click a field type on the left to add it</p>
        </div>
      </div>
    </div>

    <!-- Field settings panel -->
    <aside v-if="selectedField" class="w-56 shrink-0 space-y-3">
      <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Field settings</p>
      <UFormField label="Label">
        <UInput v-model="selectedField.label" size="sm" />
      </UFormField>
      <UFormField label="Field name">
        <UInput v-model="selectedField.name" size="sm" />
      </UFormField>
      <UFormField label="Required">
        <UToggle v-model="selectedField.required" />
      </UFormField>
    </aside>
  </div>
</template>
