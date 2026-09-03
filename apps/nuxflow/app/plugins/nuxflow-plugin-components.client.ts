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

import { defineAsyncComponent } from 'vue'

import ContactFormAdmin from '~/components/forms/ContactFormAdmin.vue'
import MembershipsAdmin from '~/components/memberships/MembershipsAdmin.vue'

export default defineNuxtPlugin((nuxtApp) => {
  // ── @nuxflow/canvas editor ────────────────────────────────────────
  // Registered as a lazy async component rather than an eager static import:
  // this plugin is universal (bundled for every route), but the editor
  // (vuedraggable, BlockPicker, SettingsPanel, AiGenerateModal) is only ever
  // rendered on the admin content-edit page via `resolveComponent('CanvasContentEditor')`.
  // Deferring the import means its chunk is fetched only when an admin
  // actually renders it, not shipped to every anonymous public-page visitor.
  nuxtApp.vueApp.component(
    'CanvasContentEditor',
    defineAsyncComponent(() => import('@nuxflow/canvas').then(m => m.CanvasContentEditor)),
  )

  // ── Contact Forms ────────────────────────────────────────────────────────
  nuxtApp.vueApp.component('ContactFormAdmin', ContactFormAdmin)

  // ── Memberships ──────────────────────────────────────────────────────────
  nuxtApp.vueApp.component('MembershipsAdmin', MembershipsAdmin)
})
