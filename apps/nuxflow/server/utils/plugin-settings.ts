// Values for a plugin's declared settings form (manifest `settings`). Stored on the
// plugin's own row; secret fields are AES-GCM encrypted with the same key derivation as
// sensitive site settings (encryption.ts) and only ever decrypted for the plugin itself
// (plugin-api.ts getSettings) — the admin API returns whether a secret is set, never its value.
import { decryptText, encryptText } from './encryption'
import { SECRET_MASK } from './settings'
import { validateSettingValue, type PluginSettingField } from '../../shared/lib/plugin-permissions'

export type StoredPluginSettings = Record<string, unknown>

function encryptionSecret(): string {
  return useRuntimeConfig().betterAuthSecret as string
}

/** Settings as the plugin sees them: defaults filled in, secrets decrypted. */
export async function resolvePluginSettings(fields: PluginSettingField[], stored: StoredPluginSettings | null): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    const value = stored?.[field.key]
    if (value === undefined || value === null || value === '') {
      out[field.key] = field.default ?? null
      continue
    }
    if (field.type === 'secret') {
      try {
        out[field.key] = await decryptText(String(value), encryptionSecret())
      } catch {
        // Encrypted under a different secret (e.g. restored from another deployment) —
        // unusable, so it reads as unset rather than handing the plugin ciphertext.
        out[field.key] = null
      }
      continue
    }
    out[field.key] = value
  }
  return out
}

/** Settings as the admin form sees them: secrets replaced by the mask when set. */
export function maskPluginSettings(fields: PluginSettingField[], stored: StoredPluginSettings | null): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    const value = stored?.[field.key]
    if (field.type === 'secret') out[field.key] = value ? SECRET_MASK : ''
    else out[field.key] = value ?? field.default ?? (field.type === 'toggle' ? false : '')
  }
  return out
}

/**
 * Validates submitted values against the declared fields and returns the new stored
 * object. Unknown keys are rejected. A secret submitted as the mask keeps its stored
 * value; an empty secret clears it.
 */
export async function buildStoredPluginSettings(
  fields: PluginSettingField[],
  stored: StoredPluginSettings | null,
  incoming: Record<string, unknown>,
): Promise<StoredPluginSettings> {
  const known = new Set(fields.map(f => f.key))
  for (const key of Object.keys(incoming)) {
    if (!known.has(key)) throw validationError(`Unknown setting: ${key}`)
  }
  const next: StoredPluginSettings = {}
  for (const field of fields) {
    const provided = Object.prototype.hasOwnProperty.call(incoming, field.key)
    if (field.type === 'secret') {
      const submitted = incoming[field.key]
      // Not sent, or sent back as the mask the form was given: keep what's stored.
      if (!provided || submitted === SECRET_MASK) {
        if (stored?.[field.key]) next[field.key] = stored[field.key]
        else if (field.required) throw validationError(`${field.label} is required`)
        continue
      }
      if (submitted !== null && typeof submitted !== 'string') throw validationError(`${field.label} must be text`)
      const err = validateSettingValue(field, submitted)
      if (err) throw validationError(`${field.label} ${err}`)
      if (submitted) next[field.key] = await encryptText(submitted, encryptionSecret())
      continue
    }
    const submitted = provided ? incoming[field.key] : stored?.[field.key]
    const value = submitted === '' ? null : submitted
    const err = validateSettingValue(field, value)
    if (err) throw validationError(`${field.label} ${err}`)
    if (value !== null && value !== undefined) next[field.key] = value
  }
  return next
}

/** Keeps only stored values whose field still exists with the same type (after an update). */
export function carryOverPluginSettings(fields: PluginSettingField[], previousFields: PluginSettingField[], stored: StoredPluginSettings | null): StoredPluginSettings | null {
  if (!stored) return null
  const previousTypes = new Map(previousFields.map(f => [f.key, f.type]))
  const out: StoredPluginSettings = {}
  for (const field of fields) {
    if (stored[field.key] === undefined || previousTypes.get(field.key) !== field.type) continue
    if (field.type !== 'secret' && validateSettingValue({ ...field, required: false }, stored[field.key])) continue
    out[field.key] = stored[field.key]
  }
  return Object.keys(out).length > 0 ? out : null
}
