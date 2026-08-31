# Splitter

*(v4.11+)* A set of resizable panels separated by draggable handles.

## Key Props

- `items`: `SplitterItem[]` — each has `slot`, `defaultSize`, `minSize`, `maxSize`, `collapsible`, `collapsedSize`, `sizeUnit`, `order`, `id`, `class`, `ui`
- `orientation`: `'horizontal' | 'vertical'` (default `'horizontal'`)
- `disabled`: `boolean`
- `autoSaveId`: `string | null` — persists panel sizes (e.g. to `localStorage`) under this key
- `id`: `string` — auto-generated if omitted

## Slots

- `resize-handle` — custom content inside the draggable divider
- Dynamic panel slots — named by each item's `slot` property, or `panel-{index}` by default

## Usage

```vue
<script setup lang="ts">
import type { SplitterItem } from '@nuxt/ui'

const items: SplitterItem[] = [
  { slot: 'left', defaultSize: 25, minSize: 15 },
  { slot: 'main', defaultSize: 50, minSize: 30 },
  { slot: 'right', defaultSize: 25, minSize: 15 },
]
</script>

<template>
  <div class="w-full h-96">
    <USplitter id="splitter" :items="items">
      <template #left>Left</template>
      <template #main>Main</template>
      <template #right>Right</template>
    </USplitter>
  </div>
</template>
```

**Note:** the component fills its container's height — the parent must define an explicit height (as in the example above), or the splitter collapses to zero height.
