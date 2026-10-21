import { requireRole } from '../../../utils/permissions'
import { loadEmailConfig } from '../../../utils/email'
import { resolveSetting, saveSetting } from '../../../utils/settings'
import { writeAuditLog } from '../../../utils/audit'
import { purgeEdgeCache } from '../../../utils/edge-cache'
import { canSendListEmail, SIGNUP_SETTING_KEY } from '../../../utils/mailing-list'
import { signupSettingsSchema } from '../../../../shared/lib/signup-prompt'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const settings = await parseBody(event, signupSettingsSchema)

  // List mail only goes through a third-party provider (mailing-list.ts) — without one,
  // every double opt-in signup would sit at "pending" forever.
  if (settings.doubleOptIn && !canSendListEmail(await loadEmailConfig(event))) {
    validationError('Double opt-in sends a confirmation email, which needs a third-party email provider (Resend, Brevo or ZeptoMail) in Settings → Email. Set one up first, or turn double opt-in off.')
  }
  if (settings.brevoListId && !(await resolveSetting(event, 'email.brevo_api_key', 'brevoApiKey'))) {
    validationError('Copying subscribers to a Brevo list needs a Brevo API key in Settings → Email.')
  }

  await saveSetting(event, SIGNUP_SETTING_KEY, settings)
  await writeAuditLog(event, userId, { action: 'update', resource: 'mailing_list_settings', after: settings })
  // The popup's settings travel in /api/public/site.
  await purgeEdgeCache(event, ['/api/public/site'])
  return { settings }
})
