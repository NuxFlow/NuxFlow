# InputRating

*(v4.10+)* A component to display and collect ratings from users (star rating by default).

## Key Props

- `v-model` / `modelValue`, `defaultValue`: `number`
- `length`: `number` — number of items (default `5`)
- `step`: `0.1 | 0.25 | 0.5 | 1` — granularity, e.g. half-star ratings (default `1`)
- `icon`: `string` (default `'i-lucide-star'`), `emptyIcon`: `string` (defaults to `icon`) — separate icon for the unfilled state
- `color`: theme color (default `'primary'`)
- `size`: `'xs' | 'sm' | 'md' | 'lg' | 'xl'` (default `'md'`)
- `orientation`: `'horizontal' | 'vertical'`
- `clearable`: `boolean` — allow clicking the current value to reset to 0
- `hoverable`: `boolean` — preview value on hover
- `disabled`, `readonly`: `boolean`

## Slots

- `item` — rendered per item; receives `filled` (`false` for the empty background layer, `true` for the highlighted overlay)

## Usage

```vue
<script setup lang="ts">
const rating = ref(3)
</script>

<template>
  <UInputRating v-model="rating" />
</template>
```
