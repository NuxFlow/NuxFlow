/**
 * Block component bootstrap — universal (runs on server AND client).
 *
 * Registers all block render components into the block registry so that
 * canvas pages are fully server-side rendered. Only add components here that
 * are SSR-safe (pure render components with no browser-only APIs).
 *
 * Admin/editor-only components (CanvasAdmin, CanvasContentEditor, etc.) are
 * registered separately in nuxflow-plugin-components.client.ts — they are
 * never needed during public-page SSR.
 */

import { CANVAS_BLOCKS, BUILTIN_BLOCK_COMPONENTS } from '@nuxflow/canvas'

import ContactFormBlock from '~/components/forms/ContactFormBlock.vue'
import DynamicFormBlock from '~/components/forms/DynamicFormBlock.vue'
import MembershipsBlock from '~/components/memberships/MembershipsBlock.vue'
import Paywall from '~/components/memberships/Paywall.vue'

// This plugin runs once per SSR *request* (Nuxt's normal per-request plugin
// lifecycle), but useBlockRegistry.ts's registry is a module-level singleton that
// persists for the whole Worker *isolate's* lifetime, not one request — Cloudflare
// Workers reuse isolates across many requests, unlike a traditional per-request
// server process. Without this guard, every request after the isolate's first would
// re-run every registration below and hit registry.register()'s own "already
// registered" guard for each one, logging a console.error 23 times on every single
// request forever (harmless functionally — the existing registration from the
// isolate's first request is untouched — but permanent, request-scaling log noise
// that also masks real errors). The registry itself can't tell "the built-in
// registering itself again, harmlessly" apart from "a genuine id collision from a
// dynamic plugin" (see the comment in useBlockRegistry.ts), so the guard belongs
// here, at the one call site that's actually expected to run more than once per
// module lifetime. Safe on the client too: each browser tab gets its own fresh
// module instantiation on page load, so `_registered` naturally starts `false` there
// regardless of any other tab or previous session.
let _registered = false

export default defineNuxtPlugin((nuxtApp) => {
  const registry = useBlockRegistry()

  if (!_registered) {
    _registered = true

    // ── Built-in blocks (packages/canvas) ────────────────────────────────────
    // BUILTIN_BLOCK_COMPONENTS (packages/canvas/src/blocks/components.ts) is the
    // single source of truth for id -> component; name/icon come straight off
    // each block's own CANVAS_BLOCKS entry rather than being re-typed here by
    // hand. Blocks with no entry in BUILTIN_BLOCK_COMPONENTS (contact-form/form,
    // dynamic-form/form, payments/memberships) are app-owned and registered
    // individually below, alongside payments/paywall (not a CANVAS_BLOCKS entry
    // at all — it's never offered in the block picker, only rendered directly).
    for (const block of CANVAS_BLOCKS) {
      const component = BUILTIN_BLOCK_COMPONENTS[block.id]
      if (!component) continue
      registry.register(block.id, { name: block.name, icon: block.icon, component })
    }

    // ── Forms blocks ──────────────────────────────────────────────────────────
    registry.register('contact-form/form', { name: 'Contact Form', icon: 'i-lucide-mail', component: ContactFormBlock })
    registry.register('dynamic-form/form', { name: 'Form', icon: 'i-lucide-list-checks', component: DynamicFormBlock })

    // ── Commerce blocks ───────────────────────────────────────────────────────
    registry.register('payments/memberships', { name: 'Membership Pricing', icon: 'i-lucide-badge-dollar-sign', component: MembershipsBlock })
    registry.register('payments/paywall',     { name: 'Paywall',            icon: 'i-lucide-lock',              component: Paywall })
  }

  // Provide the block registry so canvas block components (BlockPicker,
  // CanvasBlock, useCanvas) can inject it without a circular import. Runs every
  // request regardless of the guard above — nuxtApp.vueApp is a fresh instance
  // per request and needs this every time, even once the registry itself is warm.
  nuxtApp.vueApp.provide('nuxflow:blockRegistry', registry)
})
