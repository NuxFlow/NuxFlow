# ChatTool

*(v4.6+)* A collapsible element that displays AI tool-call status, with streaming/loading indicators and optional user-approval actions.

## Key Props

- `text`: `string` — main status text; `suffix`: `string` — secondary text after the label
- `streaming`: `boolean` — active tool execution; `loading`: `boolean` — shows a loading indicator
- `variant`: `'inline' | 'card'` (default `'inline'`)
- `actions`: `ButtonProps[]` *(v4.10+)* — e.g. approve/deny buttons for tool calls awaiting user confirmation
- `open` / `v-model:open`: controlled open state
- `icon`, `chevron`: `'leading' | 'trailing'` (default `'trailing'`)

## Slots

- `default` — tool output content
- `actions` — action button area

## Usage

```vue
<template>
  <UChatTool
    text="Running lint checks"
    icon="i-lucide-terminal"
    variant="card"
    :streaming="isRunning"
  >
    <pre>{{ output }}</pre>
  </UChatTool>
</template>
```
