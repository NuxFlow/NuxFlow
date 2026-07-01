export * from './types'
export * from './blocks/definitions'
export { useCanvas } from './editor/useCanvas'

// Vue components
export { default as CanvasContentEditor } from './editor/CanvasContentEditor.vue'
export { default as CanvasBlockHero } from './blocks/CanvasBlockHero.vue'
export { default as CanvasBlockText } from './blocks/CanvasBlockText.vue'
export { default as CanvasBlockImage } from './blocks/CanvasBlockImage.vue'
export { default as CanvasBlockColumns } from './blocks/CanvasBlockColumns.vue'
export { default as CanvasBlockCta } from './blocks/CanvasBlockCta.vue'
export { default as CanvasBlockSpacer } from './blocks/CanvasBlockSpacer.vue'
export { default as CanvasBlockVideo } from './blocks/CanvasBlockVideo.vue'
export { default as CanvasBlockTestimonial } from './blocks/CanvasBlockTestimonial.vue'
export { default as CanvasBlockFeatures } from './blocks/CanvasBlockFeatures.vue'
export { default as CanvasBlockGdpr } from './blocks/CanvasBlockGdpr.vue'
export { default as CanvasBlockFooter } from './blocks/CanvasBlockFooter.vue'
export { default as CanvasBlockButton } from './blocks/CanvasBlockButton.vue'
export { default as CanvasBlockAccordion } from './blocks/CanvasBlockAccordion.vue'
export { default as CanvasBlockPricing } from './blocks/CanvasBlockPricing.vue'
export { default as CanvasBlockGallery } from './blocks/CanvasBlockGallery.vue'
export { default as CanvasBlockCarousel } from './blocks/CanvasBlockCarousel.vue'
export { default as CanvasBlockCalendar } from './blocks/CanvasBlockCalendar.vue'
export { default as CanvasAdmin } from './admin/CanvasAdmin.vue'

export const canvasManifest = {
  id: 'canvas',
  name: 'Canvas Page Builder',
  description: 'Visual drag-and-drop page builder — Hero, Text, Image, Gallery, Carousel, Video, Columns, Features, Testimonial, CTA, Spacer, Button, Accordion, Pricing, Events Calendar',
  version: '0.2.0',
  author: 'NuxFlow',
  icon: 'i-lucide-layout-panel-top',
  adminPages: [
    {
      path: 'canvas',
      component: 'CanvasAdmin',
      label: 'Canvas',
      icon: 'i-lucide-layout-panel-top',
    },
  ],
  blocks: [
    { id: 'canvas-hero',        name: 'Hero',        component: 'CanvasBlockHero' },
    { id: 'canvas-text',        name: 'Text',        component: 'CanvasBlockText' },
    { id: 'canvas-image',       name: 'Image',       component: 'CanvasBlockImage' },
    { id: 'canvas-video',       name: 'Video',       component: 'CanvasBlockVideo' },
    { id: 'canvas-columns',     name: 'Columns',     component: 'CanvasBlockColumns' },
    { id: 'canvas-features',    name: 'Features',    component: 'CanvasBlockFeatures' },
    { id: 'canvas-testimonial', name: 'Testimonial', component: 'CanvasBlockTestimonial' },
    { id: 'canvas-cta',         name: 'CTA Banner',  component: 'CanvasBlockCta' },
    { id: 'canvas-spacer',      name: 'Spacer',      component: 'CanvasBlockSpacer' },
    { id: 'canvas-gdpr',        name: 'GDPR Banner', component: 'CanvasBlockGdpr' },
    { id: 'canvas-footer',      name: 'Footer',      component: 'CanvasBlockFooter' },
    { id: 'canvas-button',      name: 'Button',      component: 'CanvasBlockButton' },
    { id: 'canvas-accordion',   name: 'Accordion',   component: 'CanvasBlockAccordion' },
    { id: 'canvas-pricing',     name: 'Pricing Table', component: 'CanvasBlockPricing' },
    { id: 'canvas-gallery',     name: 'Gallery',     component: 'CanvasBlockGallery' },
    { id: 'canvas-carousel',    name: 'Carousel',    component: 'CanvasBlockCarousel' },
    { id: 'canvas-calendar',    name: 'Events Calendar', component: 'CanvasBlockCalendar' },
  ],
}
