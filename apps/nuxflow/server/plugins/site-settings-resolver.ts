import { useDb } from '../utils/db'
import { siteSettings } from '@nuxflow/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { type AppearanceCache, getCachedAppearance, setCachedAppearance } from '../utils/appearance-cache'
import { errorMessage } from '../utils/errors'
// Deliberately '@nuxflow/canvas/consent', NOT the package root ('@nuxflow/canvas') —
// the root barrel (src/index.ts) re-exports every Canvas block as a .vue SFC, and this
// file is part of the Nitro *server* bundle, which has no Vue SFC plugin. Importing even
// one named export from the root forces Rollup to parse the whole barrel (including
// every .vue file) to resolve it, which fails the server build outright — this doesn't
// surface in `nuxt typecheck` or vitest, only in a real `wrangler deploy`/`pnpm build`
// (see CLAUDE.md's recurring point about local/typecheck not catching everything a real
// build does). The dedicated './consent' subpath in packages/canvas/package.json's
// `exports` map points straight at the plain-TS consent utility, never touching a .vue
// file, so it's safe to import from both server and client code.
import { hasOptionalConsent, isGdprCountry, parseConsentFromHeader } from '@nuxflow/canvas/consent'

// A visitor's browser runs this once the document is available: if the shared
// nuxflow_consent cookie (see @nuxflow/canvas's consent utility) already grants
// analytics/marketing, or is granted later via the CONSENT_EVENT the two consent UIs
// dispatch on save, it promotes the inert <template data-nuxflow-consent-html> the
// server wrote instead of the real tags (see the injection logic below) into live
// <head>/<body> content. Cloning a <script> node does not execute it, so scripts are
// specifically re-created via createElement rather than cloneNode. This only ever runs
// when the server decided NOT to inject the code directly — see hasOptionalConsent's
// call site below — so a consented visitor's very next request skips this path
// entirely and gets the code injected directly again, same as before this change.
const CONSENT_ACTIVATION_SCRIPT = `<script>(function(){
function activateScope(scope,target){
document.querySelectorAll('template[data-nuxflow-consent-html="'+scope+'"]').forEach(function(tpl){
var nodes=Array.prototype.slice.call(tpl.content.childNodes);
nodes.forEach(function(node){
if(node.nodeType===1&&node.tagName==='SCRIPT'){
var s=document.createElement('script');
for(var i=0;i<node.attributes.length;i++){s.setAttribute(node.attributes[i].name,node.attributes[i].value)}
s.text=node.textContent||'';
target.appendChild(s);
}else{
target.appendChild(node.cloneNode(true));
}
});
tpl.remove();
});
}
function activate(){activateScope('head',document.head);activateScope('body',document.body);}
function hasConsent(){
var m=document.cookie.match(/(?:^|; )nuxflow_consent=([^;]*)/);
if(!m)return false;
try{var c=JSON.parse(decodeURIComponent(m[1]));return !!(c&&(c.analytics||c.marketing));}catch(e){return false;}
}
if(hasConsent()){activate();}
window.addEventListener('nuxflow:consent-updated',function(){if(hasConsent()){activate();}});
})()</script>`

// ── Sanitization ─────────────────────────────────────────────────────────────

// Allowlist for CSS color values written into inline <style> blocks.
// Rejects anything that could break out of the CSS context.
const CSS_COLOR_RE = /^(?:#[0-9a-fA-F]{3,8}|rgba?\([\d\s,.]+\)|hsla?\([\d\s,.%]+\)|[a-zA-Z]{2,30})$/

function safeCssColor(value: string): string | null {
  return CSS_COLOR_RE.test(value.trim()) ? value.trim() : null
}

// ── Google Fonts query strings ────────────────────────────────────────────────

const FONT_QUERY: Record<string, string> = {
  'Inter': 'family=Inter:wght@400;500;600;700;800',
  'Geist': 'family=Geist:wght@400;500;600;700;800',
  'Poppins': 'family=Poppins:ital,wght@0,400;0,500;0,600;0,700;0,800',
  'Plus Jakarta Sans': 'family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800',
}

async function resolveAppearance(event: H3Event, siteId: string): Promise<AppearanceCache> {
  const cached = getCachedAppearance(siteId)
  if (cached) return cached

  const db = useDb(event)
  const rows = await db
    .select({ key: siteSettings.key, value: siteSettings.value })
    .from(siteSettings)
    .where(
      and(
        eq(siteSettings.siteId, siteId),
        inArray(siteSettings.key, ['theme.dark_mode', 'theme.primary_color', 'theme.font_sans', 'appearance.custom_head_html', 'appearance.custom_body_html']),
      ),
    )

  const map = Object.fromEntries(rows.map(r => [r.key, String(r.value ?? '')]))
  const entry: AppearanceCache = {
    darkMode: map['theme.dark_mode'] ?? 'auto',
    primaryColor: map['theme.primary_color'] ?? '',
    fontSans: map['theme.font_sans'] ?? 'system',
    customHeadHtml: map['appearance.custom_head_html'] ?? '',
    customBodyHtml: map['appearance.custom_body_html'] ?? '',
  }
  setCachedAppearance(siteId, entry)
  return entry
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export default defineNitroPlugin((nitro) => {
  // Inject appearance settings into every SSR page response:
  //   • dark_mode  → blocking <script> that adds/removes the "dark" class before
  //                  paint, preventing a flash of wrong colour scheme
  //   • primary_color → --nuxflow-primary CSS custom property
  //   • font_sans  → --nuxflow-font custom property + Google Fonts <link>
  //
  // Admin pages (/admin/*) skip the dark-mode and font injections because the
  // admin has its own colour-mode toggle and Nuxt UI handles its font.
  // The --nuxflow-primary variable IS injected everywhere so .nav-active and
  // custom CSS in the admin can reference it.
  nitro.hooks.hook('render:html', async (html, { event }) => {
    const siteId = event.context.siteId as string | null
    if (!siteId) return

    try {
      const { darkMode, primaryColor, fontSans, customHeadHtml, customBodyHtml } = await resolveAppearance(event, siteId)

      const path = getRequestURL(event).pathname
      const isAdmin = path.startsWith('/admin')

      const cssParts: string[] = []

      // Primary colour custom property — validate before injecting into <style>
      const safeColor = primaryColor ? safeCssColor(primaryColor) : null
      if (safeColor) {
        cssParts.push(`--nuxflow-primary:${safeColor}`)
      }

      if (!isAdmin) {
        // ── Dark mode ──────────────────────────────────────────────────────────
        // Use a blocking inline script so the class is set before any CSS or
        // Vue hydration runs, avoiding a flash of the wrong mode.
        if (darkMode === 'dark') {
          html.head.unshift(`<script>document.documentElement.classList.add('dark')</script>`)
        }
        else if (darkMode === 'light') {
          html.head.unshift(`<script>document.documentElement.classList.remove('dark')</script>`)
        }
        // 'auto' → do nothing; @nuxtjs/color-mode / system preference handles it

        // ── Font — only inject from the known allowlist ────────────────────────
        const knownFont = (fontSans && fontSans !== 'system' && fontSans in FONT_QUERY) ? fontSans : null
        if (knownFont) {
          cssParts.push(`--nuxflow-font:'${knownFont}',system-ui,-apple-system,sans-serif`)

          const query = FONT_QUERY[knownFont]
          if (query) {
            html.head.push(`<link rel="preconnect" href="https://fonts.googleapis.com">`)
            html.head.push(`<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="">`)
            html.head.push(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${query}&display=swap">`)
          }
        }
      }

      if (cssParts.length) {
        // Apply --nuxflow-font to body on public pages so all text picks it up
        const knownFontForBody = (fontSans && fontSans !== 'system' && fontSans in FONT_QUERY) ? fontSans : null
        const bodyRule = (!isAdmin && knownFontForBody)
          ? `body{font-family:var(--nuxflow-font,system-ui,-apple-system,sans-serif)}`
          : ''
        html.head.push(
          `<style data-nuxflow-appearance>:root{${cssParts.join(';')}}${bodyRule}</style>`,
        )
      }

      // Custom code injection — admin-only setting; only injected on public pages.
      // The docs for this field (Settings → Appearance) recommend it specifically for
      // analytics tags and marketing pixels, which is exactly the class of
      // non-essential tracker GDPR/ePrivacy require prior consent for — so unlike
      // every other injection above, this one is gated on the visitor's actual choice
      // (recorded via the nuxflow_consent cookie both consent UIs write, see
      // @nuxflow/canvas's consent utility) instead of always running. Requests from
      // outside the GDPR/UK/CH zone (or where Cloudflare's cf-ipcountry header is
      // absent, e.g. local dev without a real Cloudflare edge in front) are treated as
      // not requiring prior consent and get the code directly, matching this
      // deployment's pre-existing behaviour for that traffic; a request with the
      // header present and inside that zone must have an explicit analytics/marketing
      // consent before either field ever reaches the page.
      if (!isAdmin && (customHeadHtml || customBodyHtml)) {
        const consent = parseConsentFromHeader(getRequestHeader(event, 'cookie'))
        const regulatedVisitor = isGdprCountry(getRequestHeader(event, 'cf-ipcountry'))
        const allowed = hasOptionalConsent(consent) || !regulatedVisitor

        if (allowed) {
          if (customHeadHtml) html.head.push(customHeadHtml)
          if (customBodyHtml) html.bodyAppend.push(customBodyHtml)
        }
        else {
          // Wrapped inert (never auto-executed, including any <script> tags inside —
          // a <template>'s content is inert DOM, not part of the live document) until
          // CONSENT_ACTIVATION_SCRIPT promotes it client-side after consent is granted.
          if (customHeadHtml) html.head.push(`<template data-nuxflow-consent-html="head">${customHeadHtml}</template>`)
          if (customBodyHtml) html.bodyAppend.push(`<template data-nuxflow-consent-html="body">${customBodyHtml}</template>`)
          html.bodyAppend.push(CONSENT_ACTIVATION_SCRIPT)
        }
      }
    }
    catch (err) {
      console.error('[nuxflow:site-settings-resolver] Failed:', errorMessage(err, String(err)))
    }
  })
})
