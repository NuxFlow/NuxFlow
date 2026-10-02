# Hello Theme

A test NuxFlow CSS theme — warm sunset palette (amber, orange, coral).

## Quick start

```bash
# Create an API key first: Admin → Settings → API keys, with "Upload and update themes"
export NUXFLOW_SITE=https://your-site.com
export NUXFLOW_API_KEY=nf_...

# Deploy for the first time (activates automatically if no theme is active)
nuxflow theme deploy

# Update CSS after making changes
nuxflow theme update
```

The `deployedId` field in `nuxflow.theme.json` is written automatically on first deploy
so the update command knows which theme to patch.

## How it works

The CSS in `theme.css` is stored in Cloudflare KV and injected as an inline
`<style data-nuxflow-theme>` block into the `<head>` of every SSR page — no
redeploy of the main app required, and no flash of the default theme on first paint.

## What this theme overrides

| Token / selector | Default | Hello Theme |
|---|---|---|
| `--glass-bg` / `--glass-border` | white tint | peach tint |
| `.mesh-bg` gradient | green / sky / purple | amber / orange / rose |
| `.nav-active` | green highlight | orange highlight |
| `.nux-content a` links | green | orange |
| `.nux-content blockquote` border | green | orange |
