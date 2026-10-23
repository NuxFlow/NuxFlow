import { requireRole } from '../../../utils/permissions'
import { loadEmailConfig } from '../../../utils/email'
import { resolveStringSetting } from '../../../utils/settings'
import { canSendListEmail, getSignupSettings } from '../../../utils/mailing-list'

// Admin → Mailing list → Signup popup. Also reports whether the site can send list mail,
// so the form can explain why double opt-in or Brevo sync isn't available yet.
export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  const [settings, emailConfig, brevoKey] = await Promise.all([
    getSignupSettings(event),
    loadEmailConfig(event),
    resolveStringSetting(event, 'email.brevo_api_key', 'brevoApiKey'),
  ])
  return {
    settings,
    email: {
      provider: emailConfig.emailProvider,
      canSendListEmail: canSendListEmail(emailConfig),
      brevoKeyConfigured: Boolean(brevoKey),
    },
  }
})
