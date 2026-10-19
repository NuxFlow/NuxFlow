// What a dynamic plugin may ask to do, shared by the server (install-time validation and
// runtime enforcement) and the admin UI (the approval screen). A plugin still runs in its
// own sandbox with no database, no bindings and no network of its own — each permission
// here is one narrow, host-implemented door (see server/utils/plugin-api.ts), scoped to the
// site and plugin it was granted on. Nothing here grants raw database or KV access.
//
// Permission strings:
//   storage              its own key-value store
//   content:read         published, public content of this site
//   content:write        create drafts (never publish, never change existing items)
//   ai                   text generation through the site's AI provider (plan-limited)
//   notify               in-app notifications to the site's admins
//   user:read            the signed-in visitor's user id and role on its own routes
//   network:<host>       outbound HTTPS to one host (`*.example.com` = its subdomains)
//   hook:<event>         be told when something happens on the site (PLUGIN_HOOK_EVENTS)

export const PLUGIN_HOOK_EVENTS = {
  'content.published': 'A page or post is published',
  'content.updated': 'A published page or post is changed',
  'content.unpublished': 'A page or post stops being public (unpublished, archived, deleted)',
  'form.submitted': 'Someone submits a form (includes what they typed)',
  'comment.created': 'Someone posts a comment (includes the comment text)',
} as const

export type PluginHookEvent = keyof typeof PLUGIN_HOOK_EVENTS

export const SIMPLE_PLUGIN_PERMISSIONS = ['storage', 'content:read', 'content:write', 'ai', 'notify', 'user:read'] as const
type SimplePermission = typeof SIMPLE_PLUGIN_PERMISSIONS[number]

export const MAX_NETWORK_HOSTS = 20
export const MAX_SETTINGS_FIELDS = 30

export type PluginPermissionRisk = 'low' | 'medium' | 'high'

export interface PluginPermissionInfo {
  title: string
  description: string
  risk: PluginPermissionRisk
}

const SIMPLE_INFO: Record<SimplePermission, PluginPermissionInfo> = {
  'storage': { title: 'Store its own data', description: 'Save and read data of its own (up to 10 MB). It cannot see any other data on this site.', risk: 'low' },
  'content:read': { title: 'Read published content', description: 'Read pages and posts that are published and public — what any visitor can already see.', risk: 'low' },
  'content:write': { title: 'Create drafts', description: 'Create new draft pages and posts. It cannot publish them or change existing content.', risk: 'medium' },
  'ai': { title: 'Use AI', description: 'Generate text with this site’s AI provider. This counts towards the site’s AI usage.', risk: 'medium' },
  'notify': { title: 'Notify admins', description: 'Send in-app notifications to this site’s admins.', risk: 'low' },
  'user:read': { title: 'Know who is signed in', description: 'See the user id and role of a signed-in person using this plugin’s own pages. It never receives their password, cookies or session.', risk: 'medium' },
}

export function isPluginHookEvent(name: string): name is PluginHookEvent {
  return Object.prototype.hasOwnProperty.call(PLUGIN_HOOK_EVENTS, name)
}

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * A network permission's host: a lower-case DNS name with at least two labels, optionally
 * prefixed `*.` for "any subdomain of". IP literals, `localhost` and private suffixes are
 * refused — the gateway also re-checks every request, this just fails the install early.
 */
export function validateNetworkHost(host: string): string | null {
  if (host.length > 253) return 'is too long'
  const bare = host.startsWith('*.') ? host.slice(2) : host
  const labels = bare.split('.')
  if (labels.length < 2 || labels.some(l => !HOST_LABEL.test(l))) return 'must be a domain name like api.example.com'
  if (/^\d+$/.test(labels[labels.length - 1]!)) return 'must be a domain name, not an IP address'
  if (['localhost', 'local', 'internal', 'localdomain', 'home', 'lan', 'test', 'invalid', 'example'].includes(labels[labels.length - 1]!)) {
    return 'must be a public domain'
  }
  return null
}

/** True when `hostname` (a request's) is covered by the allowlist entry `pattern`. */
export function hostMatches(pattern: string, hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (pattern.startsWith('*.')) {
    const base = pattern.slice(2)
    return host.endsWith(`.${base}`)
  }
  return host === pattern
}

/** Returns an error message for an unknown or malformed permission, else null. */
export function validatePermission(permission: string): string | null {
  if ((SIMPLE_PLUGIN_PERMISSIONS as readonly string[]).includes(permission)) return null
  if (permission.startsWith('network:')) {
    const err = validateNetworkHost(permission.slice('network:'.length))
    return err ? `"${permission}": host ${err}` : null
  }
  if (permission.startsWith('hook:')) {
    return isPluginHookEvent(permission.slice('hook:'.length)) ? null : `"${permission}": unknown event (known: ${Object.keys(PLUGIN_HOOK_EVENTS).join(', ')})`
  }
  return `Unknown permission "${permission}"`
}

export function describePermission(permission: string): PluginPermissionInfo {
  if (permission in SIMPLE_INFO) return SIMPLE_INFO[permission as SimplePermission]
  if (permission.startsWith('network:')) {
    const host = permission.slice('network:'.length)
    return {
      title: `Connect to ${host}`,
      description: host.startsWith('*.')
        ? `Send and receive data over HTTPS with any address under ${host.slice(2)}. Anything the plugin can read could be sent there.`
        : `Send and receive data over HTTPS with ${host}. Anything the plugin can read could be sent there.`,
      risk: 'high',
    }
  }
  if (permission.startsWith('hook:')) {
    const name = permission.slice('hook:'.length)
    const label = isPluginHookEvent(name) ? PLUGIN_HOOK_EVENTS[name] : name
    const personal = name === 'form.submitted' || name === 'comment.created'
    return { title: `Be told: ${label.charAt(0).toLowerCase()}${label.slice(1)}`, description: `The plugin is sent the details when this happens${personal ? ', which can include visitors’ personal details' : ''}.`, risk: personal ? 'high' : 'low' }
  }
  return { title: permission, description: 'Unknown permission.', risk: 'high' }
}

// ── Settings form schema ──────────────────────────────────────────────────────

export const PLUGIN_SETTING_TYPES = ['text', 'textarea', 'secret', 'toggle', 'number', 'select', 'url'] as const
export type PluginSettingType = typeof PLUGIN_SETTING_TYPES[number]

export interface PluginSettingField {
  key: string
  label: string
  type: PluginSettingType
  description?: string
  required?: boolean
  default?: string | number | boolean
  options?: { label: string, value: string }[]
}

export interface PluginCapabilities {
  permissions: string[]
  settings: PluginSettingField[]
}

const SETTING_KEY = /^[a-z][a-z0-9_]{0,63}$/

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseSettingField(raw: unknown, index: number): PluginSettingField {
  const where = `settings[${index}]`
  if (!isPlainObject(raw)) throw new Error(`${where} must be an object`)
  const { key, label, type, description, required, options } = raw
  if (typeof key !== 'string' || !SETTING_KEY.test(key)) throw new Error(`${where}.key must be lower-case letters, digits and _ (starting with a letter)`)
  if (typeof label !== 'string' || !label.trim() || label.length > 120) throw new Error(`${where}.label is required (max 120 characters)`)
  if (typeof type !== 'string' || !(PLUGIN_SETTING_TYPES as readonly string[]).includes(type)) throw new Error(`${where}.type must be one of ${PLUGIN_SETTING_TYPES.join(', ')}`)
  if (description !== undefined && (typeof description !== 'string' || description.length > 500)) throw new Error(`${where}.description must be a string (max 500 characters)`)
  if (required !== undefined && typeof required !== 'boolean') throw new Error(`${where}.required must be true or false`)

  const field: PluginSettingField = { key, label: label.trim(), type: type as PluginSettingType }
  if (description) field.description = description
  if (required) field.required = true

  if (type === 'select') {
    if (!Array.isArray(options) || options.length === 0 || options.length > 100) throw new Error(`${where}.options must list 1–100 choices`)
    field.options = options.map((o, i) => {
      if (!isPlainObject(o) || typeof o.value !== 'string' || typeof o.label !== 'string') throw new Error(`${where}.options[${i}] needs a string label and value`)
      return { label: o.label, value: o.value }
    })
  }

  if (raw.default !== undefined) {
    if (type === 'secret') throw new Error(`${where}: a secret field can't have a default`)
    const err = validateSettingValue(field, raw.default)
    if (err) throw new Error(`${where}.default ${err}`)
    field.default = raw.default as string | number | boolean
  }
  return field
}

/**
 * Parses and validates a plugin's declared capabilities (the `permissions` and `settings`
 * of its manifest). Throws an Error with a readable message on anything malformed.
 * Permissions are de-duplicated and sorted so two equal sets always compare equal.
 */
export function parsePluginCapabilities(raw: unknown): PluginCapabilities {
  if (!isPlainObject(raw)) throw new Error('capabilities must be an object')
  const permissionsRaw = raw.permissions ?? []
  const settingsRaw = raw.settings ?? []
  if (!Array.isArray(permissionsRaw) || permissionsRaw.some(p => typeof p !== 'string')) throw new Error('permissions must be an array of strings')
  if (!Array.isArray(settingsRaw)) throw new Error('settings must be an array')
  if (settingsRaw.length > MAX_SETTINGS_FIELDS) throw new Error(`a plugin can declare at most ${MAX_SETTINGS_FIELDS} settings`)

  const permissions = [...new Set(permissionsRaw as string[])].sort()
  for (const p of permissions) {
    const err = validatePermission(p)
    if (err) throw new Error(err)
  }
  if (permissions.filter(p => p.startsWith('network:')).length > MAX_NETWORK_HOSTS) {
    throw new Error(`a plugin can ask for at most ${MAX_NETWORK_HOSTS} network hosts`)
  }

  const settings = settingsRaw.map(parseSettingField)
  const keys = new Set<string>()
  for (const s of settings) {
    if (keys.has(s.key)) throw new Error(`settings: duplicate key "${s.key}"`)
    keys.add(s.key)
  }
  return { permissions, settings }
}

/** Returns an error message when `value` doesn't fit `field`, else null. Empty = unset. */
export function validateSettingValue(field: PluginSettingField, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return field.required ? 'is required' : null
  switch (field.type) {
    case 'toggle':
      return typeof value === 'boolean' ? null : 'must be true or false'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'must be a number'
    case 'select':
      return typeof value === 'string' && field.options?.some(o => o.value === value) ? null : 'must be one of the listed options'
    case 'url':
      if (typeof value !== 'string' || value.length > 2048) return 'must be a URL'
      try {
        const u = new URL(value)
        return u.protocol === 'https:' || u.protocol === 'http:' ? null : 'must be an http(s) URL'
      } catch {
        return 'must be a URL'
      }
    case 'textarea':
      return typeof value === 'string' && value.length <= 20_000 ? null : 'must be text (max 20,000 characters)'
    default:
      return typeof value === 'string' && value.length <= 2000 ? null : 'must be text (max 2,000 characters)'
  }
}

/** Every permission in `requested` is in `granted`. */
export function permissionsCovered(requested: readonly string[], granted: readonly string[] | null | undefined): boolean {
  const set = new Set(granted ?? [])
  return requested.every(p => set.has(p))
}

export function samePermissions(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && permissionsCovered(a, b) && permissionsCovered(b, a)
}

export function networkHostsOf(permissions: readonly string[]): string[] {
  return permissions.filter(p => p.startsWith('network:')).map(p => p.slice('network:'.length))
}
