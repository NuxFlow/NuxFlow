/**
 * Plugin component bootstrap — client-side only.
 *
 * Registers admin/editor Vue components globally. These are kept client-only
 * because they use browser APIs (drag-and-drop, contenteditable, etc.) and are
 * never needed during public-page SSR.
 *
 * Block render components are registered in nuxflow-plugin-components.ts
 * (universal) so they are available for SSR.
 *
 * HOW TO ADD A PLUGIN:
 *   1. Import the render component and register it universally in
 *      nuxflow-plugin-components.ts (so it SSRs on public pages).
 *   2. Import the admin component here and register it globally (client-only).
 */

import {
  CanvasContentEditor,
  CanvasAdmin,
} from '@nuxflow/plugin-canvas'

import { ContactFormAdmin } from '@nuxflow/plugin-contact-form'
import { MembershipsAdmin } from '@nuxflow/plugin-payments'

export default defineNuxtPlugin((nuxtApp) => {
  // ── @nuxflow/plugin-canvas editor ────────────────────────────────────────
  nuxtApp.vueApp.component('CanvasAdmin', CanvasAdmin)
  nuxtApp.vueApp.component('CanvasContentEditor', CanvasContentEditor)

  // ── @nuxflow/plugin-contact-form ─────────────────────────────────────────
  nuxtApp.vueApp.component('ContactFormAdmin', ContactFormAdmin)

  // ── @nuxflow/plugin-payments ─────────────────────────────────────────────
  nuxtApp.vueApp.component('MembershipsAdmin', MembershipsAdmin)
})
