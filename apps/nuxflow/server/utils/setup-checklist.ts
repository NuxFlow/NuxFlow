import type { H3Event } from 'h3'
import { auditLogs, emailLog, forms, media, passkeys, sites, siteSettings } from '@nuxflow/db/schema'
import { and, count, desc, eq, inArray } from 'drizzle-orm'
import { useDb } from './db'
import { resolveSetting } from './settings'
import { getActiveProvider } from './media-providers/index'
import { getAiSdkModel } from './ai-sdk'
import { getEmailBinding } from './cf-env'
import { getSeoSettings, type SeoSettings } from './seo'
import { loadEmailConfig } from './email'
import { getAccountsOrigin } from './accounts-origin'

/**
 * The admin dashboard's "Finish setting up your site" card (GET /api/v1/site-checklist,
 * AdminSetupChecklist.vue). NuxFlow keeps working when something isn't configured —
 * images fall back to the database, email falls back to the server log — so a
 * half-configured site looks fine until a password reset never arrives. This checks the
 * things every installation should have, live, and links to where each is fixed. It
 * mirrors the "After-installation checklist" in docs/installation.md; keep the two in step.
 *
 * `buildSetupChecklist()` is pure (unit-tested); `gatherSetupChecklistInputs()` collects
 * the facts it needs from settings, bindings, and the database.
 */

export type ChecklistStatus = 'done' | 'todo' | 'problem'
export type ChecklistTier = 'essential' | 'recommended'

export interface ChecklistItem {
  id: string
  tier: ChecklistTier
  status: ChecklistStatus
  title: string
  /** Plain-language explanation of the current state and why it matters. */
  detail: string
  /** Admin page where it's fixed. */
  fixUrl?: string
  fixLabel?: string
  /** Anchor in docs/installation.md with step-by-step instructions. */
  docsAnchor?: string
}

export interface ChecklistInputs {
  storageProvider: string
  localMediaCount: number
  emailProvider: string
  hasEmailBinding: boolean
  lastEmail: { status: 'sent' | 'failed'; error: string | null; createdAt: string } | null
  siteDomain: string
  authSecret: string
  seo: Pick<SeoSettings, 'noindex' | 'description' | 'ogImage' | 'indexnowEnabled' | 'verification'>
  aiAvailable: boolean
  aiProvider: string
  turnstileSiteKey: string
  hasTurnstileSecret: boolean
  formCount: number
  userPasskeyCount: number
  lastBackupAt: string | null
  siteCount: number
  /** The central sign-in origin (NUXT_PUBLIC_ACCOUNTS_URL), or null on a same-origin install. */
  accountsOrigin: string | null
  now?: Date
}

const PLACEHOLDER_SECRET = /change-?me|placeholder|at-least-32|your[-_ ]?secret|example|e2e-test|ci-placeholder/i
const LOCAL_DOMAIN = /^(?:localhost|127\.0\.0\.1|\[?::1\]?)(?::\d+)?$/
const BACKUP_STALE_DAYS = 30

function daysSince(iso: string, now: Date): number {
  const t = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`).getTime()
  return Number.isNaN(t) ? Infinity : (now.getTime() - t) / 86_400_000
}

export function buildSetupChecklist(i: ChecklistInputs): ChecklistItem[] {
  const now = i.now ?? new Date()
  const items: ChecklistItem[] = []

  // ── Essential ──────────────────────────────────────────────────────────────

  if (i.storageProvider === 'local') {
    items.push({
      id: 'storage', tier: 'essential', status: 'todo',
      title: 'Connect file storage',
      detail: 'Images are being stored inside the database. That limits each file to 512 KB and makes every page that shows them slower. Create an R2 bucket and redeploy; there\'s nothing to fill in afterwards.',
      fixUrl: '/admin/settings?tab=Media', fixLabel: 'Open media settings', docsAnchor: 'media-storage',
    })
  } else if (i.localMediaCount > 0) {
    items.push({
      id: 'storage', tier: 'essential', status: 'todo',
      title: 'Move old images out of the database',
      detail: `File storage is connected, but ${i.localMediaCount} file${i.localMediaCount === 1 ? ' is' : 's are'} still stored in the database from before. One click moves them and updates every page that uses them.`,
      fixUrl: '/admin/settings?tab=Media', fixLabel: 'Move files',
    })
  } else {
    items.push({ id: 'storage', tier: 'essential', status: 'done', title: 'File storage connected', detail: 'New uploads go to real file storage.' })
  }

  const provider = i.emailProvider || 'console'
  if (provider === 'console') {
    items.push({
      id: 'email', tier: 'essential', status: 'todo',
      title: 'Turn on email sending',
      detail: 'No email provider is chosen, so NuxFlow isn\'t sending any email. Password-reset links, invitations and security alerts never arrive, which could lock you out of your own site.',
      fixUrl: '/admin/settings?tab=Email', fixLabel: 'Choose a provider', docsAnchor: 'email-providers',
    })
  } else if (provider === 'cloudflare' && !i.hasEmailBinding) {
    items.push({
      id: 'email', tier: 'essential', status: 'problem',
      title: 'Email is set to Cloudflare, but the binding is missing',
      detail: 'The EMAIL binding isn\'t in this deployment\'s wrangler.toml, so every email fails. Add the [[send_email]] block back (it\'s in wrangler.toml.example) and redeploy, or choose another provider.',
      fixUrl: '/admin/settings?tab=Email', fixLabel: 'Email settings', docsAnchor: 'email-providers',
    })
  } else if (i.lastEmail?.status === 'failed') {
    items.push({
      id: 'email', tier: 'essential', status: 'problem',
      title: 'The last email failed to send',
      detail: `Error: ${(i.lastEmail.error ?? 'unknown error').slice(0, 200)}. Check your email settings and send a test email.`,
      fixUrl: '/admin/settings?tab=Email', fixLabel: 'Send a test email', docsAnchor: 'email-providers',
    })
  } else {
    items.push({
      id: 'email', tier: 'essential', status: 'done',
      title: 'Email sending is on',
      detail: provider === 'cloudflare'
        ? 'Using Cloudflare Email. If other people don\'t receive mail, run `wrangler email sending enable yourdomain.com`.'
        : `Using ${provider}.`,
    })
  }

  const domain = i.siteDomain.toLowerCase()
  if (!domain || LOCAL_DOMAIN.test(domain) || domain.endsWith('.workers.dev')) {
    items.push({
      id: 'domain', tier: 'essential', status: 'todo',
      title: 'Use your own domain',
      detail: LOCAL_DOMAIN.test(domain)
        ? 'This site is running on your computer (local development). Once it\'s deployed, add a custom domain in Cloudflare and sign in to the admin there.'
        : 'Your site is still on its workers.dev address. Add your own domain in Cloudflare, then sign in to the admin on the new domain. After that, turn the workers.dev address off in wrangler.toml.',
      docsAnchor: 'step-6-add-a-custom-domain',
    })
  } else {
    items.push({ id: 'domain', tier: 'essential', status: 'done', title: 'Custom domain in use', detail: `Your site's address is ${domain}.` })
  }

  if (i.siteCount > 1 && !i.accountsOrigin) {
    items.push({
      id: 'accounts', tier: 'essential', status: 'problem',
      title: 'Move sign-in to its own domain',
      detail: 'This installation hosts more than one site, but people still sign in on each site\'s own domain — where that site\'s admins can add their own scripts, which could read passwords as they\'re typed. Set NUXT_PUBLIC_ACCOUNTS_URL to a dedicated sign-in domain (for example accounts.yourplatform.com) and route it to this Worker.',
      docsAnchor: 'hosting-several-sites',
    })
  } else if (i.accountsOrigin) {
    items.push({ id: 'accounts', tier: 'essential', status: 'done', title: 'Sign-in has its own domain', detail: `Passwords and passkeys are only ever entered on ${new URL(i.accountsOrigin).host}.` })
  }

  if (i.authSecret.length < 32 || PLACEHOLDER_SECRET.test(i.authSecret)) {
    items.push({
      id: 'secret', tier: 'essential', status: 'problem',
      title: 'Set a real auth secret',
      detail: i.authSecret.length < 32
        ? 'NUXT_BETTER_AUTH_SECRET is missing or shorter than 32 characters.'
        : 'NUXT_BETTER_AUTH_SECRET looks like an example value. Anyone who knows it could forge logins. Set a long random secret with `wrangler secret put NUXT_BETTER_AUTH_SECRET`. Doing this signs everyone out and means re-entering the API keys saved in Settings.',
      docsAnchor: 'step-5-add-production-secrets',
    })
  } else {
    items.push({ id: 'secret', tier: 'essential', status: 'done', title: 'Auth secret set', detail: 'Keep a copy somewhere safe, and never change it: changing it makes the keys saved in Settings unreadable.' })
  }

  if (i.seo.noindex) {
    items.push({
      id: 'seo', tier: 'essential', status: 'problem',
      title: 'Your site is hidden from search engines',
      detail: '"Hide the whole site from search engines" is on. That\'s fine while you build, but turn it off before launch or nobody will find you.',
      fixUrl: '/admin/seo?tab=global', fixLabel: 'SEO settings',
    })
  } else if (!i.seo.description || !i.seo.ogImage) {
    const missing = [!i.seo.description && 'a default description', !i.seo.ogImage && 'a default share image'].filter(Boolean).join(' and ')
    items.push({
      id: 'seo', tier: 'essential', status: 'todo',
      title: 'Add your search & sharing basics',
      detail: `Add ${missing}. Without them, your homepage has no description in search results and shared links show no picture. AI suggest can write the description for you.`,
      fixUrl: '/admin/seo?tab=global', fixLabel: 'SEO settings', docsAnchor: '5-after-installation-checklist',
    })
  } else {
    items.push({
      id: 'seo', tier: 'essential', status: 'done',
      title: 'Search & sharing basics set',
      detail: i.seo.verification.google || i.seo.verification.bing
        ? 'Default description and share image are set, and search engine verification is configured.'
        : 'Default description and share image are set. Next: add your site to Google Search Console and Bing Webmaster Tools (Admin → SEO → Social & verification).',
    })
  }

  // ── Recommended ────────────────────────────────────────────────────────────

  items.push(i.aiAvailable
    ? { id: 'ai', tier: 'recommended', status: 'done', title: 'AI features on', detail: `Using ${i.aiProvider}.` }
    : {
        id: 'ai', tier: 'recommended', status: 'todo',
        title: 'Turn on AI features',
        detail: i.aiProvider === 'workers-ai'
          ? 'The AI buttons (alt text, SEO suggestions, writing help, translation) show an error, and the automatic spam filter for comments and forms is off. Uncomment the [ai] block in wrangler.toml and redeploy: no API key needed.'
          : `AI is set to ${i.aiProvider}, but no API key is saved. AI buttons and the spam filter won't work until one is added.`,
        fixUrl: '/admin/settings?tab=AI%20Settings', fixLabel: 'AI settings', docsAnchor: 'ai-providers',
      })

  const hasSiteKey = Boolean(i.turnstileSiteKey)
  if (hasSiteKey !== i.hasTurnstileSecret) {
    items.push({
      id: 'turnstile', tier: 'recommended', status: 'problem',
      title: 'Bot protection is half set up',
      detail: hasSiteKey
        ? 'The Turnstile site key is saved, but the CLOUDFLARE_TURNSTILE_SECRET_KEY secret isn\'t set, so visitors see the check but submissions aren\'t actually verified. Add the secret with `wrangler secret put CLOUDFLARE_TURNSTILE_SECRET_KEY`.'
        : 'The CLOUDFLARE_TURNSTILE_SECRET_KEY secret is set, but no site key is saved, so every form submission is rejected. Paste the site key in Settings → Integrations.',
      fixUrl: '/admin/settings?tab=Integrations', fixLabel: 'Integrations', docsAnchor: 'spam-protection-turnstile',
    })
  } else if (!hasSiteKey) {
    items.push({
      id: 'turnstile', tier: 'recommended', status: 'todo',
      title: 'Protect your forms from bots',
      detail: i.formCount > 0
        ? `You have ${i.formCount} form${i.formCount === 1 ? '' : 's'}. Without Turnstile, bots can submit them freely. It's free and invisible to real visitors.`
        : 'If you add a contact form or other forms, Turnstile stops bots from submitting them. It\'s free and invisible to real visitors.',
      fixUrl: '/admin/settings?tab=Integrations', fixLabel: 'Integrations', docsAnchor: 'spam-protection-turnstile',
    })
  } else {
    items.push({ id: 'turnstile', tier: 'recommended', status: 'done', title: 'Forms protected from bots', detail: 'Turnstile is set up.' })
  }

  items.push(i.userPasskeyCount > 0
    ? { id: 'passkey', tier: 'recommended', status: 'done', title: 'Passkey added', detail: 'Your account can sign in with a passkey.' }
    : {
        id: 'passkey', tier: 'recommended', status: 'todo',
        title: 'Add a passkey to your account',
        detail: 'Sign in with Face ID, Touch ID, Windows Hello or a security key. It\'s faster than a password and can\'t be phished.',
        fixUrl: i.accountsOrigin ? `${i.accountsOrigin}/account` : '/admin/settings?tab=Security', fixLabel: 'Add a passkey',
      })

  const backupAge = i.lastBackupAt ? daysSince(i.lastBackupAt, now) : Infinity
  items.push(backupAge <= BACKUP_STALE_DAYS
    ? { id: 'backup', tier: 'recommended', status: 'done', title: 'Backup downloaded recently', detail: 'Download another before big changes.' }
    : {
        id: 'backup', tier: 'recommended', status: 'todo',
        title: i.lastBackupAt ? 'Download a fresh backup' : 'Download a backup',
        detail: i.lastBackupAt
          ? `Your last backup was ${Math.floor(backupAge)} days ago. Cloudflare also keeps 30 days of database history automatically, but a downloaded backup includes your media and can be restored anywhere.`
          : 'Cloudflare keeps 30 days of database history automatically, but a downloaded backup includes your media and can be restored onto a fresh installation.',
        fixUrl: '/admin/import', fixLabel: 'Download backup',
      })

  items.push(i.seo.indexnowEnabled
    ? { id: 'indexnow', tier: 'recommended', status: 'done', title: 'IndexNow on', detail: 'Bing and other search engines hear about changes within minutes.' }
    : {
        id: 'indexnow', tier: 'recommended', status: 'todo',
        title: 'Turn on IndexNow',
        detail: 'Tell Bing and other search engines about new and changed pages within minutes instead of days. No account needed.',
        fixUrl: '/admin/seo?tab=indexing', fixLabel: 'Indexing settings',
      })

  return items
}

export const CHECKLIST_SKIPPED_KEY = 'dashboard.checklist_skipped'
export const CHECKLIST_HIDDEN_KEY = 'dashboard.checklist_hidden'

export async function gatherSetupChecklistInputs(event: H3Event, userId: string): Promise<ChecklistInputs> {
  const db = useDb(event)
  const siteId = event.context.siteId as string

  const [provider, emailProvider, aiProviderSetting, turnstileSiteKey, seo, aiModel, site, localMedia, formRows, lastEmail, passkeyRows, lastBackup, siteCountRow] = await Promise.all([
    getActiveProvider(event),
    loadEmailConfig(event).then(c => c.emailProvider),
    resolveSetting(event, 'ai.provider', 'aiProvider'),
    resolveSetting(event, 'integrations.turnstile_site_key'),
    getSeoSettings(db, siteId),
    getAiSdkModel(event, 'fast').catch(() => null),
    db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { domain: true } }),
    db.select({ n: count() }).from(media).where(and(eq(media.siteId, siteId), eq(media.storageProvider, 'local'))),
    db.select({ n: count() }).from(forms).where(eq(forms.siteId, siteId)),
    db.query.emailLog.findFirst({ where: eq(emailLog.siteId, siteId), orderBy: [desc(emailLog.createdAt)], columns: { status: true, error: true, createdAt: true } }),
    db.select({ n: count() }).from(passkeys).where(eq(passkeys.userId, userId)),
    db.query.auditLogs.findFirst({
      where: and(eq(auditLogs.siteId, siteId), eq(auditLogs.action, 'export'), eq(auditLogs.resource, 'site')),
      orderBy: [desc(auditLogs.createdAt)],
      columns: { createdAt: true },
    }),
    db.select({ n: count() }).from(sites),
  ])

  return {
    storageProvider: provider.name,
    localMediaCount: localMedia[0]?.n ?? 0,
    emailProvider: (emailProvider as string) || 'console',
    hasEmailBinding: Boolean(getEmailBinding(event)),
    lastEmail: lastEmail ?? null,
    siteDomain: site?.domain ?? '',
    authSecret: String(useRuntimeConfig().betterAuthSecret ?? ''),
    seo,
    aiAvailable: Boolean(aiModel),
    aiProvider: (aiProviderSetting as string) || 'workers-ai',
    turnstileSiteKey: (turnstileSiteKey as string) || '',
    hasTurnstileSecret: Boolean(process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY),
    formCount: formRows[0]?.n ?? 0,
    userPasskeyCount: passkeyRows[0]?.n ?? 0,
    lastBackupAt: lastBackup?.createdAt ?? null,
    siteCount: siteCountRow[0]?.n ?? 1,
    accountsOrigin: getAccountsOrigin(),
  }
}

/** The per-site "skip" list and "hide the card" flag (dashboard.* settings). */
export async function getChecklistPreferences(event: H3Event): Promise<{ skipped: string[]; hidden: boolean }> {
  const db = useDb(event)
  const siteId = event.context.siteId as string
  const rows = await db.query.siteSettings.findMany({
    where: and(eq(siteSettings.siteId, siteId), inArray(siteSettings.key, [CHECKLIST_SKIPPED_KEY, CHECKLIST_HIDDEN_KEY])),
    columns: { key: true, value: true },
  })
  const kv = Object.fromEntries(rows.map(r => [r.key, r.value]))
  const skipped = Array.isArray(kv[CHECKLIST_SKIPPED_KEY]) ? (kv[CHECKLIST_SKIPPED_KEY] as unknown[]).filter((x): x is string => typeof x === 'string') : []
  const hidden = kv[CHECKLIST_HIDDEN_KEY] === true || kv[CHECKLIST_HIDDEN_KEY] === 'true'
  return { skipped, hidden }
}
