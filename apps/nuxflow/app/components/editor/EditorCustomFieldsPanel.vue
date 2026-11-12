<script setup lang="ts">
import type { CustomFieldDef, CustomFieldValues } from '#shared/lib/custom-fields'

// The content type's own fields (Admin → Content types) in the editor sidebar: price,
// bedrooms, dietary labels… Saved with the item. Required ones only have to be filled in to
// publish; the server checks them again (server/utils/content-type-fields.ts).

const props = defineProps<{ defs: CustomFieldDef[]; disabled?: boolean }>()
const values = defineModel<CustomFieldValues>({ required: true })

function set(key: string, value: unknown) {
  const empty = value === '' || value === null || value === undefined || (Array.isArray(value) && !value.length)
  const rest = Object.fromEntries(Object.entries(values.value).filter(([k]) => k !== key))
  values.value = empty ? rest : { ...rest, [key]: value as CustomFieldValues[string] }
}

function numberText(key: string): string {
  const v = values.value[key]
  return v === undefined ? '' : String(v)
}

function setNumber(key: string, text: string | number) {
  const t = String(text).trim()
  if (!t) return set(key, undefined)
  const n = Number(t.replace(/,/g, ''))
  set(key, Number.isFinite(n) ? n : t)
}

function toggleOption(key: string, option: string, on: boolean) {
  const current = Array.isArray(values.value[key]) ? values.value[key] as string[] : []
  set(key, on ? [...current, option] : current.filter(o => o !== option))
}

const selectItems = (def: CustomFieldDef) => (def.options ?? []).map(o => ({ label: o, value: o }))
const hasDefs = computed(() => props.defs.length > 0)
</script>

<template>
  <div v-if="hasDefs" class="space-y-3">
    <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide">Details</p>
    <template v-for="def in defs" :key="def.key">
    <!-- Several choices: a fieldset, so each checkbox is named by its own option (a form
         field's label would name every checkbox after the field). -->
    <fieldset v-if="def.type === 'multiselect'" class="space-y-1 text-xs">
      <legend class="mb-1 font-medium text-gray-700 dark:text-gray-200">
        {{ def.label }}<span v-if="def.required" class="ml-0.5 text-red-500">*</span>
      </legend>
      <UCheckbox
        v-for="option in def.options ?? []"
        :key="option"
        :label="option"
        :model-value="Array.isArray(values[def.key]) && (values[def.key] as string[]).includes(option)"
        :disabled="disabled"
        @update:model-value="toggleOption(def.key, option, $event === true)"
      />
    </fieldset>
    <UFormField
      v-else
      :label="def.label"
      :required="def.required"
      class="text-xs"
    >
      <UTextarea
        v-if="def.type === 'textarea'"
        :model-value="String(values[def.key] ?? '')"
        :disabled="disabled"
        :rows="3"
        class="w-full text-sm"
        @update:model-value="set(def.key, $event)"
      />
      <UInput
        v-else-if="def.type === 'number'"
        :model-value="numberText(def.key)"
        :disabled="disabled"
        inputmode="decimal"
        class="w-full text-sm"
        @update:model-value="setNumber(def.key, $event)"
      >
        <template v-if="def.prefix" #leading><span class="text-xs text-gray-400">{{ def.prefix }}</span></template>
        <template v-if="def.suffix" #trailing><span class="text-xs text-gray-400">{{ def.suffix }}</span></template>
      </UInput>
      <USwitch
        v-else-if="def.type === 'boolean'"
        :model-value="values[def.key] === true"
        :disabled="disabled"
        :aria-label="def.label"
        @update:model-value="set(def.key, $event ? true : undefined)"
      />
      <USelect
        v-else-if="def.type === 'select'"
        :model-value="(values[def.key] as string | undefined)"
        :items="selectItems(def)"
        :disabled="disabled"
        placeholder="Choose…"
        class="w-full text-sm"
        @update:model-value="set(def.key, $event)"
      />
      <UInput
        v-else-if="def.type === 'date'"
        type="date"
        :model-value="String(values[def.key] ?? '')"
        :disabled="disabled"
        class="w-full text-sm"
        @update:model-value="set(def.key, $event)"
      />
      <UInput
        v-else
        :type="def.type === 'url' ? 'url' : 'text'"
        :placeholder="def.type === 'url' ? 'https://' : undefined"
        :model-value="String(values[def.key] ?? '')"
        :disabled="disabled"
        class="w-full text-sm"
        @update:model-value="set(def.key, $event)"
      />
    </UFormField>
    </template>
    <p class="text-xs text-gray-400">Fields marked * must be filled in to publish.</p>
  </div>
</template>
