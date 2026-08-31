# ChatShimmer

*(v4.6+)* A text shimmer animation, used to indicate streaming/loading state in chat interfaces. Automatically used internally by `ChatTool` and `ChatReasoning` while streaming.

## Key Props

- `text`: `string` — required, the text to shimmer
- `as`: element/component to render (default `'span'`)
- `duration`: `number` — animation speed in seconds (default `2`)
- `spread`: `number` — shimmer width multiplier, computed as `text.length * spread` px (default `2`)

## Usage

```vue
<template>
  <UChatShimmer text="Thinking..." />
</template>
```

Respects `prefers-reduced-motion` — renders as static muted text instead of animating.
