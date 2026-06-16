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
  CanvasBlockGdpr,
  CanvasBlockFooter,
  CanvasBlockButton,
  CanvasBlockAccordion,
  CanvasBlockPricing,
  registerBlockDefinition,
} from '@nuxflow/plugin-canvas'
import type { CanvasBlockDefinition } from '@nuxflow/plugin-canvas'

import ContactFormBlock from '~/components/forms/ContactFormBlock.vue'
import Paywall from '~/components/memberships/Paywall.vue'
import HtmlBlock from '~/components/blocks/HtmlBlock.vue'

const contactFormBlockDefinition: CanvasBlockDefinition = {
  id: 'contact-form/form',
  name: 'Contact Form',
  description: 'Embed a contact form with customisable title, description, and button text.',
  icon: 'i-lucide-mail',
  category: 'plugin',
  component: 'ContactFormBlock',
  thumbnailColor: '#ecfdf5',
  fields: [
    { key: 'title', label: 'Form Title', type: 'text', placeholder: 'Get in touch' },
    { key: 'description', label: 'Description', type: 'textarea', placeholder: 'Send us a message and we\'ll get back to you.' },
    { key: 'submitLabel', label: 'Submit button label', type: 'text', placeholder: 'Send message' },
    { key: 'bgColor', label: 'Background colour', type: 'color' },
    { key: 'textColor', label: 'Text colour', type: 'color' },
    { key: 'padding', label: 'Padding', type: 'spacing' },
  ],
  defaultProps: {
    title: 'Get in touch',
    description: 'Send us a message and we\'ll get back to you.',
    submitLabel: 'Send message',
    padding: { top: 48, right: 24, bottom: 48, left: 24, unit: 'px' },
  },
}

const htmlBlockDefinition: CanvasBlockDefinition = {
  id: 'html-block/html',
  name: 'HTML',
  description: 'Raw HTML block — paste any HTML snippet directly onto the page',
  icon: 'i-lucide-code-xml',
  category: 'plugin',
  component: 'HtmlBlock',
  thumbnailColor: '#fef3c7',
  fields: [
    {
      key: 'html',
      label: 'HTML',
      type: 'textarea',
      rows: 10,
      placeholder: '<div class="my-widget">\n  <!-- your HTML here -->\n</div>',
    },
    { key: 'padding', label: 'Padding', type: 'spacing' },
  ],
  defaultProps: {
    html: '',
    padding: { top: 16, right: 16, bottom: 16, left: 16, unit: 'px' },
  },
}

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
  registry.register('canvas-gdpr',        { name: 'GDPR Banner', icon: 'i-lucide-cookie',           component: CanvasBlockGdpr })
  registry.register('canvas-footer',      { name: 'Footer',      icon: 'i-lucide-panel-bottom',     component: CanvasBlockFooter })
  registry.register('canvas-button',      { name: 'Button',      icon: 'i-lucide-square-play',       component: CanvasBlockButton })
  registry.register('canvas-accordion',   { name: 'Accordion',   icon: 'i-lucide-fold-vertical',     component: CanvasBlockAccordion })
  registry.register('canvas-pricing',     { name: 'Pricing Table', icon: 'i-lucide-credit-card',    component: CanvasBlockPricing })

  // ── Contact Forms ─────────────────────────────────────────────────────────
  registry.register('contact-form/form', { name: 'Contact Form', icon: 'i-lucide-mail', component: ContactFormBlock })
  registerBlockDefinition(contactFormBlockDefinition)

  // ── Memberships ───────────────────────────────────────────────────────────
  registry.register('payments/paywall', { name: 'Paywall', icon: 'i-lucide-lock', component: Paywall })

  // ── HTML Block ────────────────────────────────────────────────────────────
  registry.register('html-block/html', { name: 'HTML', icon: 'i-lucide-code-xml', component: HtmlBlock })
  registerBlockDefinition(htmlBlockDefinition)

  // Provide the block registry so canvas plugin components (BlockPicker,
  // CanvasBlock, useCanvas) can inject it without a circular import.
  nuxtApp.vueApp.provide('nuxflow:blockRegistry', registry)
})
