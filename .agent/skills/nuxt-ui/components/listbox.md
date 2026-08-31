# Listbox

*(v4.7+)* A selectable list with built-in search and virtualization support, for choosing from a visible (non-popover) collection of items.

## Key Props

- `v-model` / `modelValue`, `items`
- `multiple`: `boolean` — allow multiple selections
- `valueKey`: `string` — key to use as the item's value when `items` is an array of objects
- `filter`: `boolean | object` — enable built-in search filtering
- `virtualize`: `boolean | object` — enable virtualization for large lists
- `selectedIcon`: `string` (default `'i-lucide-check'`)
- `size`: `'xs' | 'sm' | 'md' | 'lg' | 'xl'` (default `'md'`)
- `loading`, `disabled`: `boolean`

## Slots

- `loading` — custom loading state
- `empty` — empty list message
- `item`, `item-label`, `item-description`, `item-trailing` — per-item templates

## Usage

```vue
<script setup lang="ts">
import type { ListboxItem } from '@nuxt/ui'

const items = ref<ListboxItem[]>([
  { label: 'France', value: 'FR' },
  { label: 'Germany', value: 'DE' },
])
const selected = ref(items.value[0])
</script>

<template>
  <UListbox v-model="selected" :items="items" />
</template>
```

**vs. `Select`/`SelectMenu`**: those render the option list inside a popover; `Listbox` renders it inline/always-visible — use it when the list itself is the primary UI, not a dropdown.
