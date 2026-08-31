# Sidebar

*(v4.6+)* A collapsible application sidebar with multiple visual variants. Renders inline on desktop with collapse options; opens as a Modal, Slideover, or Drawer on mobile.

## Key Props

- `variant`: `'floating' | 'sidebar' | 'inset'` — visual style (default `'sidebar'`)
- `collapsible`: `'offcanvas' | 'icon' | 'none'` — desktop collapse behavior (default `'offcanvas'`)
- `side`: `'left' | 'right'` (default `'left'`)
- `mode`: which overlay type to use on mobile (default `'slideover'`)
- `rail`: `boolean` — show a thin interactive edge to toggle collapse
- `open` / `v-model:open`: responsive — manages expanded/collapsed state on desktop, visibility on mobile
- `title`, `description`, `close`: header content, `close` accepts `boolean | ButtonProps`

## Slots

- `header`, `default` (main nav/content), `footer`
- `title`, `description`, `actions`, `close` (header sub-sections)
- `rail` (interactive edge toggle)

## Usage

```vue
<script setup lang="ts">
const isOpen = ref(true)
</script>

<template>
  <USidebar v-model:open="isOpen" title="Navigation">
    <UNavigationMenu :items="menuItems" orientation="vertical" />
  </USidebar>
</template>
```

**Distinct from `DashboardSidebar`**: `DashboardSidebar` is purpose-built for the `DashboardGroup` layout system; `Sidebar` is a general-purpose standalone component for any app shell.
