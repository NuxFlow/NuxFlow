import { appearanceValues, loadSiteAppearance, safeSiteColor } from '../utils/site-styles'
import { accentReadabilityCss, appearanceCss, parseColorMode, siteFontsHref } from '../../shared/lib/theme-customizer'
import { escapeHtml } from '../../shared/lib/html-text'
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
import { pageCacheVariant } from '../utils/page-cache'

// A visitor's browser runs this once the document is available: if the shared
// nuxflow_consent cookie (see @nuxflow/canvas's consent utility) already grants
// analytics/marketing, or is granted later via the CONSENT_EVENT the two consent UIs
// dispatch on save, it promotes the inert <template data-nuxflow-consent-html> the
// server wrote instead of the real tags (see the injection logic below) into live
// <head>/<body> content. Cloning a <script> node does not execute it, so scripts are
// specifically re-created via createElement rather than cloneNode. This is the only way
// the code ever runs for a visitor in the GDPR/UK/CH zone, consented or not — see the
// injection logic below for why the server never decides that from the cookie itself.
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

const AUTH_PATHS = ['/login', '/register', '/forgot-password', '/reset-password', '/account', '/setup', '/authorize']

function isAuthPath(path: string): boolean {
  return AUTH_PATHS.some(p => path === p || path.startsWith(`${p}/`))
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export default defineNitroPlugin((nitro) => {
  // Inject appearance settings into every SSR page response:
  //   • dark_mode → `data-color-mode-forced` on <html>, which @nuxtjs/color-mode's own
  //     inline script reads before paint (a script of ours used to set the class, but
  //     color-mode's script ran after it and re-applied the visitor's preference, and
  //     its router hook did the same on every navigation). The client side is
  //     app/plugins/site-color-mode.client.ts, which keeps it forced on navigation.
  //   • primary_color, font_sans, font_heading → appearanceCss() (shared/lib/
  //     theme-customizer.ts — the Visual Customizer's preview uses the same function)
  //     plus one Google Fonts <link>.
  //
  // Admin pages (/admin/*) only get --nuxflow-primary (the sidebar's .nav-active and
  // custom admin CSS reference it): the admin has its own colour mode, font and palette.
  nitro.hooks.hook('render:html', async (html, { event }) => {
    const siteId = event.context.siteId
    if (!siteId) return

    try {
      const appearance = await loadSiteAppearance(event, siteId)
      const { customHeadHtml, customBodyHtml } = appearance

      const path = getRequestURL(event).pathname
      const isAdmin = path.startsWith('/admin')

      if (isAdmin) {
        const color = safeSiteColor(appearance.primaryColor)
        if (color) html.head.push(`<style data-nuxflow-appearance>:root{--nuxflow-primary:${color}}</style>`)
      }
      else {
        const colorMode = parseColorMode(appearance.darkMode)
        if (colorMode !== 'auto') html.htmlAttrs.push(`data-color-mode-forced="${colorMode}"`)

        const values = appearanceValues(appearance)
        const fontHref = siteFontsHref([values.bodyFont, values.headingFont])
        if (fontHref) {
          html.head.push(`<link rel="preconnect" href="https://fonts.googleapis.com">`)
          html.head.push(`<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="">`)
          // media="print" + onload swap: the browser fetches the stylesheet at normal
          // priority but doesn't block first paint on it (a print-media stylesheet isn't
          // render-blocking for the screen); onload flips it to the real media and applies
          // it as soon as it arrives. font-display=swap (already in the query string)
          // still covers the interval between first paint and this stylesheet loading.
          // <noscript> covers the no-JS case, where onload never fires.
          const href = escapeHtml(fontHref)
          html.head.push(`<link rel="stylesheet" href="${href}" media="print" onload="this.media='all'">`)
          html.head.push(`<noscript><link rel="stylesheet" href="${href}"></noscript>`)
        }
        html.head.push(`<style data-nuxflow-on-primary>${accentReadabilityCss(values.primaryColor)}</style>`)
        const css = appearanceCss(values)
        if (css) html.head.push(`<style data-nuxflow-appearance>${css}</style>`)
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
      // not requiring prior consent and get the code directly. Inside that zone the
      // code is always held back here and CONSENT_ACTIVATION_SCRIPT promotes it in the
      // browser once the cookie grants analytics/marketing consent (immediately on load
      // for a visitor who already consented). The cookie is deliberately not read here:
      // the HTML then depends only on the region, which the full-page cache keys on
      // (pageCacheVariant() in utils/page-cache.ts) — reading the cookie would let one
      // consented visitor's render be served to a visitor who never consented.
      // Never on the sign-in and account pages, even on a single-site install that signs in
      // on its own domain: script there could read a password as it's typed or a reset
      // token from the URL. (Under central sign-in those pages don't exist on a site's
      // domain at all — see utils/accounts-origin.ts.)
      if (!isAdmin && !isAuthPath(path) && (customHeadHtml || customBodyHtml)) {
        const regulatedVisitor = pageCacheVariant(event) === 'r'

        if (!regulatedVisitor) {
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
