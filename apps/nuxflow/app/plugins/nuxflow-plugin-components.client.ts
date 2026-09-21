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
  // Same reasoning as CanvasContentEditor above: only rendered on
  // admin/contact-forms/index.vue, so it must not be a static import here —
  // that would ship it in the bundle every anonymous public-page visitor downloads.
  nuxtApp.vueApp.component(
    'ContactFormAdmin',
    defineAsyncComponent(() => import('~/components/forms/ContactFormAdmin.vue')),
  )

  // ── Memberships ──────────────────────────────────────────────────────────
  // Only rendered on admin/memberships/index.vue — same reasoning as above.
  nuxtApp.vueApp.component(
    'MembershipsAdmin',
    defineAsyncComponent(() => import('~/components/memberships/MembershipsAdmin.vue')),
  )
})
