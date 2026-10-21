import { z } from 'zod'
import { rateLimit } from '../../../utils/rate-limit'
import { confirmSubscriber } from '../../../utils/mailing-list'

const bodySchema = z.object({
  id: z.string().min(1).max(64),
  token: z.string().min(1).max(128),
})

// Double opt-in: the "Yes, subscribe me" button on /mailing-list/confirm. A POST from the
// page rather than the emailed GET link itself, so mail scanners that open every link
// don't confirm on the visitor's behalf.
export default defineEventHandler(async (event) => {
  await rateLimit(event, { limit: 20, windowMs: 60_000, keyPrefix: 'mailing-list-confirm' })
  const body = await parseBody(event, bodySchema)
  const result = await confirmSubscriber(event, body.id, body.token)
  if (!result) notFound('This confirmation link is not valid.')
  return {
    heading: result.settings.successHeading,
    body: result.settings.successBody,
    reward: result.reward,
  }
})
