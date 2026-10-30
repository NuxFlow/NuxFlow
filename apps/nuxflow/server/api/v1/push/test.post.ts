import { requireRole } from '../../../utils/permissions'
import { sendPushToUser } from '../../../utils/webpush'
import { validationError, httpError } from '../../../utils/response'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'admin')

  const result = await sendPushToUser(event, userId, {
    title: 'Test notification',
    body: 'Push notifications are working correctly.',
    url: '/admin',
  })
  // Every subscription turned out to be dead (and was pruned) — same as having none.
  if (result.total === result.removed) {
    validationError('You have no browser subscribed to push notifications on this site yet — turn them on under My account first.')
  }
  if (result.delivered === 0) {
    throw httpError({ status: 502, message: 'The push service refused the notification. Try turning push notifications off and on again under My account.' })
  }

  return { sent: true, ...result }
})
