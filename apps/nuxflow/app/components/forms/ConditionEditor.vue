<script setup lang="ts">
interface Condition {
  fieldId: string
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'empty' | 'not_empty'
  value: string
}

interface Field {
  id: string
  label: string
  type: string
}

const props = defineProps<{
  modelValue: Condition[]
  fields: Field[]
}>()
const emit = defineEmits<{ 'update:modelValue': [v: Condition[]] }>()

const conditions = ref<Condition[]>(props.modelValue ?? [])
watch(conditions, (v) => emit('update:modelValue', v), { deep: true })

const operators = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'gt', label: 'greater than' },
  { value: 'lt', label: 'less than' },
  { value: 'contains', label: 'contains' },
  { value: 'empty', label: 'is empty' },
  { value: 'not_empty', label: 'is not empty' },
]

function addCondition() {
  conditions.value.push({ fieldId: props.fields[0]?.id ?? '', operator: 'eq', value: '' })
}

function removeCondition(i: number) {
  conditions.value.splice(i, 1)
}
</script>

<template>
  <div class="space-y-2">
    <div v-for="(cond, i) in conditions" :key="i" class="flex items-center gap-2">
      <span class="text-xs text-gray-400 w-8 text-right">{{ i === 0 ? 'IF' : 'AND' }}</span>

      <USelect
        v-model="cond.fieldId"
        :items="fields.map(f => ({ label: f.label, value: f.id }))"
        class="flex-1"
        size="sm"
      />
      <USelect
        v-model="cond.operator"
        :items="operators"
        class="w-36"
        size="sm"
      />
      <UInput
        v-if="!['empty', 'not_empty'].includes(cond.operator)"
        v-model="cond.value"
        class="flex-1"
        size="sm"
        placeholder="value"
      />
      <UButton icon="i-lucide-x" variant="ghost" size="xs" @click="removeCondition(i)" />
    </div>

    <UButton icon="i-lucide-plus" variant="ghost" size="xs" @click="addCondition">
      Add condition
    </UButton>
  </div>
</template>
