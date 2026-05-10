import { PLUGIN_REGISTRY } from '../utils/plugin-registry'

export default defineNitroPlugin(async () => {
  // Plugin loading happens at startup — we can't do per-site dynamic loading on Workers.
  // All registered plugins are bundled; activation state is checked per-request.
  for (const entry of PLUGIN_REGISTRY) {
    try {
      // In a Node environment this would dynamically require the entrypoint.
      // On Cloudflare Workers, entrypoints are statically bundled.
      console.warn(`[plugin-loader] Registered: ${entry.name} @ ${entry.version}`)
    } catch (err) {
      console.error(`[plugin-loader] Failed to load plugin ${entry.id}:`, err)
    }
  }
})
