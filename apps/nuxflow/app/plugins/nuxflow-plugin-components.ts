/**
 * Plugin component bootstrap — universal (runs on server AND client).
 *
 * Registers all block render components into the block registry so that
 * canvas pages are fully server-side rendered. Only add components here that
 * are SSR-safe (pure render components with no browser-only APIs).
 *
 * Admin/editor-only components (CanvasAdmin, CanvasContentEditor, etc.) are
 * registered separately in nuxflow-plugin-components.client.ts — they are
 * never needed during public-page SSR.
 */

import {
  CanvasBlockHero,
  CanvasBlockText,
  CanvasBlockImage,
  CanvasBlockColumns,
  CanvasBlockCta,
  CanvasBlockSpacer,
  CanvasBlockVideo,
  CanvasBlockTestimonial,
  CanvasBlockFeatures,
  registerBlockDefinition,
} from '@nuxflow/plugin-canvas'

import { ContactFormBlock } from '@nuxflow/plugin-contact-form'
import { Paywall } from '@nuxflow/plugin-payments'
import { HtmlBlock, htmlBlockDefinition } from '@nuxflow/plugin-html-block'

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

  // ── @nuxflow/plugin-contact-form ──────────────────────────────────────────
  registry.register('contact-form/form', { name: 'Contact Form', icon: 'i-lucide-mail', component: ContactFormBlock })

  // ── @nuxflow/plugin-payments ──────────────────────────────────────────────
  registry.register('payments/paywall', { name: 'Paywall', icon: 'i-lucide-lock', component: Paywall })

  // ── @nuxflow/plugin-html-block ────────────────────────────────────────────
  registry.register('html-block/html', { name: 'HTML', icon: 'i-lucide-code-xml', component: HtmlBlock })
  registerBlockDefinition(htmlBlockDefinition)

  // Provide the block registry so canvas plugin components (BlockPicker,
  // CanvasBlock, useCanvas) can inject it without a circular import.
  nuxtApp.vueApp.provide('nuxflow:blockRegistry', registry)
})
