import { z } from 'zod'
import { countUsage } from '../../../utils/usage'

const bodySchema = z.object({
  type: z.enum(['shown', 'dismissed']),
})

// Popup statistics for Admin → Mailing list: how often it was shown and closed. Counted in
// the isolate and written at most once a minute (usage.ts), so this costs no D1 write per
// call — which is also why it isn't rate limited; a bot can only inflate a counter.
export default defineEventHandler(async (event) => {
  if (!event.context.siteId) notFound()
  const body = await parseBody(event, bodySchema)
  countUsage(event, body.type === 'shown' ? 'signup_prompt_shown' : 'signup_prompt_dismissed')
  return noContent(event)
})
