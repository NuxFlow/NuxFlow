import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { users } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { sendEmailWithConfig } from '../../../utils/email'
import { resolveSetting, SECRET_MASK } from '../../../utils/settings'

const bodySchema = z.object({
  sendTo: z.string().email().optional(),
  provider: z.enum(['console', 'resend', 'brevo', 'zepto', 'smtp']),
  fromAddress: z.string().optional(),
  resendApiKey: z.string().optional(),
  brevoApiKey: z.string().optional(),
  zeptoApiKey: z.string().optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.string().optional(),
  smtpUser: z.string().optional(),
  smtpPass: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')
  const body = await readValidatedBody(event, bodySchema.parse)

  const db = useDb(event)
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { email: true, name: true },
  })

  const sendTo = body.sendTo || user?.email
  if (!sendTo) throw createError({ statusCode: 400, message: 'No recipient email address' })

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

  let smtpPass = body.smtpPass
  if (smtpPass === SECRET_MASK || !smtpPass) {
    smtpPass = await resolveSetting(event, 'email.smtp_pass', 'smtpPass')
  }

  let fromAddress = body.fromAddress
  if (!fromAddress) {
    fromAddress = await resolveSetting(event, 'email.from_address', 'emailFromAddress')
  }

  let smtpHost = body.smtpHost
  if (!smtpHost) {
    smtpHost = await resolveSetting(event, 'email.smtp_host', 'smtpHost')
  }

  let smtpPort = body.smtpPort
  if (!smtpPort) {
    smtpPort = await resolveSetting(event, 'email.smtp_port', 'smtpPort')
  }

  let smtpUser = body.smtpUser
  if (!smtpUser) {
    smtpUser = await resolveSetting(event, 'email.smtp_user', 'smtpUser')
  }

  try {
    await sendEmailWithConfig(
      {
        emailProvider: body.provider,
        fromAddress,
        resendApiKey,
        brevoApiKey,
        zeptoApiKey,
        smtpHost,
        smtpPort,
        smtpUser,
        smtpPass,
      },
      {
        to: sendTo,
        subject: 'NuxFlow email test',
        html: '<p>This is a test email from your NuxFlow site. If you received this, your email delivery is configured correctly.</p>',
        text: 'This is a test email from your NuxFlow site. If you received this, your email delivery is configured correctly.',
      },
    )
    return { success: true, message: `Test email sent to ${sendTo}` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw createError({ statusCode: 422, message: msg })
  }
})

