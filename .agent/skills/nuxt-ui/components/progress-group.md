# ProgressGroup

*(v4.11+)* A progress bar split into multiple segments that add up to a total — for showing several proportional values (e.g. disk usage by category) in one indicator.

## Key Props

- `items`: `ProgressGroupItem[]` — each has `label?`, `value?`, `icon?`, `color?`, `slot?`
- `max`: `number` (default `100`)
- `status`: `boolean` — show a status line
- `size`: `'2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'` (default `'md'`)
- `color`: theme color (default `'primary'`) — per-item `color` overrides this
- `orientation`: `'horizontal' | 'vertical'`

## Slots

- `status` — custom status content
- `item`, `item-label`, `item-leading`, `item-trailing` — per-segment templates

## Usage

```vue
<script setup lang="ts">
import type { ProgressGroupItem } from '@nuxt/ui'

const items = ref<ProgressGroupItem[]>([
  { label: 'System', value: 24, color: 'neutral' },
  { label: 'Apps', value: 8, color: 'error' },
])
</script>

<template>
  <UProgressGroup :max="128" :items="items" class="w-96" />
</template>
```

**vs. `Progress`**: `Progress` shows one value; `ProgressGroup` shows several values as segments of one bar.
