/**
 * Registers the Canvas editor globally, client-only. The admin content page mounts it with
 * `resolveComponent('CanvasContentEditor')` — `@nuxflow/canvas` is a separate package, so
 * Nuxt doesn't auto-register its components. Block render components are registered for
 * SSR in nuxflow-blocks.ts.
 */

import { defineAsyncComponent } from 'vue'

export default defineNuxtPlugin((nuxtApp) => {
  // Lazy, so the editor's chunk (vuedraggable, BlockPicker, SettingsPanel, AiGenerateModal)
  // is fetched only when an admin opens a Canvas page, not shipped to every visitor.
  nuxtApp.vueApp.component(
    'CanvasContentEditor',
    defineAsyncComponent(() => import('@nuxflow/canvas').then(m => m.CanvasContentEditor)),
  )
})
