import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { users } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { sendEmailWithConfig, loadEmailConfig } from '../../../utils/email'
import { renderEmailTemplate } from '../../../utils/email-template'
import { resolveSetting, SECRET_MASK } from '../../../utils/settings'
import { errorMessage } from '../../../utils/errors'

const bodySchema = z.object({
  sendTo: z.email().optional(),
  provider: z.enum(['console', 'cloudflare', 'resend', 'brevo', 'zepto']),
  fromAddress: z.string().optional(),
  fromName: z.string().max(100).optional(),
  resendApiKey: z.string().optional(),
  brevoApiKey: z.string().optional(),
  zeptoApiKey: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const body = await parseBody(event, bodySchema)

  const db = useDb(event)
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { email: true, name: true },
  })

  const sendTo = body.sendTo || user?.email
  if (!sendTo) throw badRequest('No recipient email address')

  if (body.provider === 'console') {
    return { success: true, message: 'Console provider — check your server logs' }
  }

  let resendApiKey = body.resendApiKey
  if (resendApiKey === SECRET_MASK || !resendApiKey) {
    resendApiKey = await resolveSetting(event, 'email.resend_api_key', 'resendApiKey')
  }

  let brevoApiKey = body.brevoApiKey
  if (brevoApiKey === SECRET_MASK || !brevoApiKey) {
    brevoApiKey = await resolveSetting(event, 'email.brevo_api_key', 'brevoApiKey')
  }

  let zeptoApiKey = body.zeptoApiKey
  if (zeptoApiKey === SECRET_MASK || !zeptoApiKey) {
    zeptoApiKey = await resolveSetting(event, 'email.zepto_api_key', 'zeptoApiKey')
  }

  let fromAddress = body.fromAddress
  if (!fromAddress) {
    fromAddress = await resolveSetting(event, 'email.from_address', 'emailFromAddress')
  }

  // Start from the saved config (site id for email_log, site name, domain) and overlay
  // whatever the admin is testing but hasn't saved yet.
  const saved = await loadEmailConfig(event)
  const { html, text } = renderEmailTemplate({
    siteName: saved.siteName || saved.domain,
    heading: 'Email delivery works',
    paragraphs: ['This is a test email from your NuxFlow site. If you received it, email delivery is configured correctly.'],
  })

  try {
    await sendEmailWithConfig(
      {
        ...saved,
        emailProvider: body.provider,
        fromAddress,
        fromName: body.fromName || saved.fromName,
        resendApiKey,
        brevoApiKey,
        zeptoApiKey,
      },
      { to: sendTo, subject: 'NuxFlow email test', html, text, category: 'test' },
      event,
    )
    return { success: true, message: `Test email sent to ${sendTo}` }
  } catch (err) {
    const msg = errorMessage(err, String(err))
    throw validationError(msg)
  }
})

