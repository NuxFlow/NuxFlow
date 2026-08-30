import type { H3Event } from 'h3'
import { useDb } from './db'
import { sendEmail } from './email'
import { sendPushToUser } from './webpush'
import { notifications, users } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import { ulid } from 'ulid'

interface NotifyOptions {
  siteId: string
  userId: string
  type: string
  title: string
  body: string
  data?: Record<string, unknown>
  /** Also send an email to the user. */
  sendEmailNotification?: boolean
  /** Also send a browser push notification (requires VAPID keys configured). */
  sendPush?: boolean
  /** Deep link opened when the push notification is clicked. */
  pushUrl?: string
}

export async function sendNotification(opts: NotifyOptions, event: H3Event) {
  const db = useDb(event)

  await db.insert(notifications).values({
    id: ulid(),
    siteId: opts.siteId,
    userId: opts.userId,
    type: opts.type,
    title: opts.title,
    body: opts.body,
    data: opts.data,
  })

  if (opts.sendEmailNotification) {
    const user = await db.query.users.findFirst({
      where: eq(users.id, opts.userId),
      columns: { email: true, name: true },
    })

    if (user?.email) {
      await sendEmail(event, {
        to: user.email,
        subject: opts.title,
        html: `<p>${opts.body}</p>`,
        text: opts.body,
      }).catch(err => console.error('[notify] Email delivery failed:', err))
    }
  }

  if (opts.sendPush) {
    await sendPushToUser(event, opts.userId, {
      title: opts.title,
      body: opts.body,
      url: opts.pushUrl,
      data: opts.data,
    }).catch(err => console.error('[notify] Push delivery failed:', err))
  }
}
