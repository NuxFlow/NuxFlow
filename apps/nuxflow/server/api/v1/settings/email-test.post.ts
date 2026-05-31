import { z } from 'zod'
import { useDb } from '../../../utils/db'
import { requireRole } from '../../../utils/permissions'
import { users } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { sendEmailWithConfig } from '../../../utils/email'

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

  try {
    await sendEmailWithConfig(
      {
        emailProvider: body.provider,
        fromAddress: body.fromAddress,
        resendApiKey: body.resendApiKey,
        brevoApiKey: body.brevoApiKey,
        zeptoApiKey: body.zeptoApiKey,
        smtpHost: body.smtpHost,
        smtpPort: body.smtpPort,
        smtpUser: body.smtpUser,
        smtpPass: body.smtpPass,
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
