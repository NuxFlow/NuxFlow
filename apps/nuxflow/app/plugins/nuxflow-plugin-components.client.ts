/**
 * Plugin component bootstrap — client-side only.
 *
 * This file is the single place where plugin-provided Vue components are
 * statically imported and registered. It must use static imports (no dynamic
 * import()) to remain compatible with Cloudflare Workers bundling.
 *
 * HOW TO ADD A PLUGIN:
 *   1. Import the block component:
 *        import MyPluginHero from '@nuxflow/plugin-my-plugin/components/MyPluginHero.vue'
 *   2. Register it in the block registry:
 *        registry.register('my-plugin/hero', {
 *          name: 'Hero Section',
 *          description: 'Full-width hero with headline and CTA',
 *          icon: 'i-lucide-layout',
 *          component: MyPluginHero,
 *        })
 *   3. For admin pages and content editors, register the component globally so
 *      resolveComponent() finds it:
 *        app.component('MyPluginAdmin', MyPluginAdmin)
 *
 * This file is updated by the CLI / CI pipeline when plugins are installed or removed.
 */

import {
  CanvasContentEditor,
  CanvasAdmin,
  CanvasBlockHero,
  CanvasBlockText,
  CanvasBlockImage,
  CanvasBlockColumns,
  CanvasBlockCta,
  CanvasBlockSpacer,
  CanvasBlockVideo,
  CanvasBlockTestimonial,
  CanvasBlockFeatures,
} from '@nuxflow/plugin-canvas'

import { ContactFormBlock, ContactFormAdmin } from '@nuxflow/plugin-contact-form'
import { Paywall, MembershipsAdmin } from '@nuxflow/plugin-payments'

export default defineNuxtPlugin((nuxtApp) => {
  const registry = useBlockRegistry()

  // ── @nuxflow/plugin-canvas blocks ─────────────────────────────────────────
  registry.register('canvas-hero',        { name: 'Hero',        icon: 'i-lucide-layout-template', component: CanvasBlockHero })
  registry.register('canvas-text',        { name: 'Text',        icon: 'i-lucide-type',             component: CanvasBlockText })
  registry.register('canvas-image',       { name: 'Image',       icon: 'i-lucide-image',            component: CanvasBlockImage })
  registry.register('canvas-video',       { name: 'Video',       icon: 'i-lucide-play-circle',      component: CanvasBlockVideo })
  registry.register('canvas-columns',     { name: 'Columns',     icon: 'i-lucide-columns-3',        component: CanvasBlockColumns })
  registry.register('canvas-features',    { name: 'Features',    icon: 'i-lucide-layout-grid',      component: CanvasBlockFeatures })
  registry.register('canvas-testimonial', { name: 'Testimonial', icon: 'i-lucide-quote',            component: CanvasBlockTestimonial })
  registry.register('canvas-cta',         { name: 'CTA Banner',  icon: 'i-lucide-megaphone',        component: CanvasBlockCta })
  registry.register('canvas-spacer',      { name: 'Spacer',      icon: 'i-lucide-move-vertical',    component: CanvasBlockSpacer })

  // ── @nuxflow/plugin-canvas admin + content editor ─────────────────────────
  nuxtApp.vueApp.component('CanvasAdmin', CanvasAdmin)
  nuxtApp.vueApp.component('CanvasContentEditor', CanvasContentEditor)

  // ── @nuxflow/plugin-contact-form ──────────────────────────────────────────
  registry.register('contact-form/form', { name: 'Contact Form', icon: 'i-lucide-mail', component: ContactFormBlock })
  nuxtApp.vueApp.component('ContactFormAdmin', ContactFormAdmin)

  // ── @nuxflow/plugin-payments ──────────────────────────────────────────────
  registry.register('payments/paywall', { name: 'Paywall', icon: 'i-lucide-lock', component: Paywall })
  nuxtApp.vueApp.component('MembershipsAdmin', MembershipsAdmin)

  // Provide the block registry so canvas plugin components (BlockPicker,
  // CanvasBlock, useCanvas) can inject it without a circular import.
  nuxtApp.vueApp.provide('nuxflow:blockRegistry', registry)
})
