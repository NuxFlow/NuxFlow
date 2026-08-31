# ChatReasoning

*(v4.6+)* A collapsible element that displays an AI model's reasoning/thinking process, with auto-open while streaming and auto-close on completion.

## Key Props

- `text`: `string` — reasoning content
- `streaming`: `boolean` — drives auto-open/close behavior while `true`
- `duration`: `number` — time spent reasoning (auto-calculated if omitted)
- `autoCloseDelay`: `number` — ms before auto-closing after streaming ends (default `500`; `0` disables auto-close)
- `open` / `v-model:open`: controlled open state
- `icon`, `chevron`: `'leading' | 'trailing'` (default `'trailing'`)
- `disabled`: `boolean`

## Slots

- `default` — the collapsible body content

## Usage

```vue
<UChatReasoning
  text="The user is asking about Vue components..."
  :streaming="streaming"
  icon="i-lucide-brain"
/>
```

Renders a `ChatShimmer` internally while `streaming` is true — see `chat-shimmer.md`.
