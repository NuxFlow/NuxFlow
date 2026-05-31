import type { Db } from '@nuxflow/db/client'

export interface PluginContext {
  db: Db
  siteId: string
}

export type PluginHook<T = void> = (ctx: PluginContext) => T | Promise<T>

/**
 * A block type that this plugin contributes to the page builder.
 * The `component` name must be registered via the nuxflow-plugin-components
 * client plugin so the block renderer can resolve it at runtime.
 */
export interface PluginBlock {
  /** Unique identifier, scoped to the plugin — e.g. 'hero', 'cta-banner' */
  id: string
  /** Human-readable label shown in the block picker */
  name: string
  description?: string
  /** Lucide icon name, e.g. 'i-lucide-layout' */
  icon?: string
  /** Component name to resolve via useBlockRegistry, e.g. 'PageBuilderHero' */
  component: string
}

/**
 * An admin page this plugin contributes to the NuxFlow admin panel.
 * The `component` name must be globally registered so the dynamic
 * admin catch-all route can resolve and render it.
 */
export interface PluginAdminPage {
  /** Full admin path, e.g. '/admin/plugins/contact-form' */
  path: string
  /** Globally registered component name, e.g. 'ContactFormAdmin' */
  component: string
  /** Sidebar label */
  label: string
  /** Lucide icon name for the sidebar, e.g. 'i-lucide-mail' */
  icon: string
}

export interface NuxFlowPlugin {
  id: string
  name: string
  version: string
  description?: string
  hooks?: {
    onInstall?: PluginHook
    onUninstall?: PluginHook
    onRequest?: PluginHook<void>
  }
  routes?: Array<{
    path: string
    handler: (ctx: PluginContext, event: unknown) => unknown
  }>
  /** Admin pages this plugin contributes to the NuxFlow dashboard */
  adminPages?: PluginAdminPage[]
  /** Block types this plugin contributes to the page builder */
  blocks?: PluginBlock[]
  /**
   * Custom content editor component name. When set, the admin content editor
   * will offer a toggle to switch pages to this editor mode. The component
   * must be globally registered in nuxflow-plugin-components.client.ts.
   * The component must accept/emit `modelValue` as an object with `{ type: string }`.
   */
  contentEditor?: {
    component: string
    label: string
    icon: string
    contentType: string
  }
}
