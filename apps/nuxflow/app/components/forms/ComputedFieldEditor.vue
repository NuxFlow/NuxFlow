<script setup lang="ts">
interface Field {
  id: string
  label: string
}

const props = defineProps<{
  modelValue: string
  fields: Field[]
}>()
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()

const expression = ref(props.modelValue)
watch(expression, (v) => emit('update:modelValue', v))

function insertField(fieldId: string) {
  expression.value = `${expression.value}{{${fieldId}}}`
}
</script>

<template>
  <div class="space-y-3">
    <UFormField
      label="Expression"
      hint="Use {{fieldId}} to reference field values. Supports + - * / and numeric operations."
    >
      <UTextarea v-model="expression" :rows="3" placeholder="{{price}} * {{quantity}}" class="font-mono text-sm" />
    </UFormField>

    <div v-if="fields.length" class="flex flex-wrap gap-2">
      <UBadge
        v-for="field in fields"
        :key="field.id"
        variant="outline"
        class="cursor-pointer hover:bg-primary-50"
        @click="insertField(field.id)"
      >
        {{ field.label }}
      </UBadge>
    </div>
    <p class="text-xs text-gray-400">Click a field name to insert it into the expression.</p>
  </div>
</template>
