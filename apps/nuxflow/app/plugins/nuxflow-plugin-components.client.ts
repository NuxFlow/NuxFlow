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
} from '@nuxflow/canvas'

import ContactFormAdmin from '~/components/forms/ContactFormAdmin.vue'
import MembershipsAdmin from '~/components/memberships/MembershipsAdmin.vue'

export default defineNuxtPlugin((nuxtApp) => {
  // ── @nuxflow/canvas editor ────────────────────────────────────────
  nuxtApp.vueApp.component('CanvasAdmin', CanvasAdmin)
  nuxtApp.vueApp.component('CanvasContentEditor', CanvasContentEditor)

  // ── Contact Forms ────────────────────────────────────────────────────────
  nuxtApp.vueApp.component('ContactFormAdmin', ContactFormAdmin)

  // ── Memberships ──────────────────────────────────────────────────────────
  nuxtApp.vueApp.component('MembershipsAdmin', MembershipsAdmin)
})
