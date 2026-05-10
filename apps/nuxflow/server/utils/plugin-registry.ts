// Build-time plugin registry — populated by the Turborepo build pipeline.
// Each installed plugin adds an entry here before deployment.
// Cloudflare Workers does not support runtime dynamic imports.

export interface PluginAdminPageEntry {
  path: string
  component: string
  label: string
  icon: string
}

export interface PluginBlockEntry {
  id: string
  name: string
  description?: string
  icon?: string
  component: string
}

export interface PluginContentEditorEntry {
  component: string
  label: string
  icon: string
  contentType: string
}

export interface PluginRegistryEntry {
  id: string
  name: string
  version: string
  entrypoint: string
  permissions: string[]
  adminPages: PluginAdminPageEntry[]
  blocks: PluginBlockEntry[]
  contentEditor?: PluginContentEditorEntry
}

// This file is updated by the CLI / CI build step when plugins are installed/removed.
export const PLUGIN_REGISTRY: PluginRegistryEntry[] = [
  {
    id: 'contact-form',
    name: 'Contact Form',
    version: '0.1.0',
    entrypoint: '@nuxflow/plugin-contact-form',
    permissions: ['read:content', 'send:email'],
    adminPages: [
      {
        path: '/admin/plugins/contact-form',
        component: 'ContactFormAdmin',
        label: 'Contact Forms',
        icon: 'i-lucide-mail',
      },
    ],
    blocks: [
      {
        id: 'contact-form/form',
        name: 'Contact Form',
        description: 'Embeds a contact form with Turnstile spam protection',
        icon: 'i-lucide-mail',
        component: 'ContactFormBlock',
      },
    ],
  },
  {
    id: 'canvas',
    name: 'Canvas Page Builder',
    version: '0.1.0',
    entrypoint: '@nuxflow/plugin-canvas',
    permissions: ['read:content', 'write:content'],
    adminPages: [
      {
        path: '/admin/plugins/canvas',
        component: 'CanvasAdmin',
        label: 'Canvas',
        icon: 'i-lucide-layout-panel-top',
      },
    ],
    blocks: [
      { id: 'canvas-hero',        name: 'Hero',        icon: 'i-lucide-layout-template', component: 'CanvasBlockHero' },
      { id: 'canvas-text',        name: 'Text',        icon: 'i-lucide-type',             component: 'CanvasBlockText' },
      { id: 'canvas-image',       name: 'Image',       icon: 'i-lucide-image',            component: 'CanvasBlockImage' },
      { id: 'canvas-video',       name: 'Video',       icon: 'i-lucide-play-circle',      component: 'CanvasBlockVideo' },
      { id: 'canvas-columns',     name: 'Columns',     icon: 'i-lucide-columns-3',        component: 'CanvasBlockColumns' },
      { id: 'canvas-features',    name: 'Features',    icon: 'i-lucide-layout-grid',      component: 'CanvasBlockFeatures' },
      { id: 'canvas-testimonial', name: 'Testimonial', icon: 'i-lucide-quote',            component: 'CanvasBlockTestimonial' },
      { id: 'canvas-cta',         name: 'CTA Banner',  icon: 'i-lucide-megaphone',        component: 'CanvasBlockCta' },
      { id: 'canvas-spacer',      name: 'Spacer',      icon: 'i-lucide-move-vertical',    component: 'CanvasBlockSpacer' },
    ],
    contentEditor: {
      component: 'CanvasContentEditor',
      label: 'Canvas editor',
      icon: 'i-lucide-layout-panel-top',
      contentType: 'canvas',
    },
  },
  {
    id: 'payments',
    name: 'Payments & Memberships',
    version: '0.1.0',
    entrypoint: '@nuxflow/plugin-payments',
    permissions: ['read:content', 'write:content', 'manage:billing'],
    adminPages: [
      {
        path: '/admin/memberships',
        component: 'MembershipsAdmin',
        label: 'Memberships',
        icon: 'i-lucide-credit-card',
      },
    ],
    blocks: [
      {
        id: 'payments/paywall',
        name: 'Paywall',
        description: 'Gate content behind a membership tier',
        icon: 'i-lucide-lock',
        component: 'PaywallBlock',
      },
    ],
  },
]

export function getRegisteredPlugin(id: string): PluginRegistryEntry | undefined {
  return PLUGIN_REGISTRY.find(p => p.id === id)
}

export function getRegisteredPluginByEntrypoint(entrypoint: string): PluginRegistryEntry | undefined {
  return PLUGIN_REGISTRY.find(p => p.entrypoint === entrypoint)
}
