import { z } from 'zod'
import { rateLimit } from '../../../utils/rate-limit'
import { unsubscribe } from '../../../utils/mailing-list'

const querySchema = z.object({
  id: z.string().min(1).max(64).optional(),
  token: z.string().min(1).max(128).optional(),
})

// Two callers: the button on /mailing-list/unsubscribe (JSON body), and mail clients doing
// an RFC 8058 one-click unsubscribe — a form-encoded POST ("List-Unsubscribe=One-Click") to
// the List-Unsubscribe URL, which carries id and token in its query string.
export default defineEventHandler(async (event) => {
  await rateLimit(event, { limit: 20, windowMs: 60_000, keyPrefix: 'mailing-list-unsubscribe' })
  const query = parseQuery(event, querySchema)
  let { id, token } = query
  if (!id || !token) {
    const body = await readBody<Record<string, unknown> | null>(event).catch(() => null)
    id = typeof body?.id === 'string' ? body.id.slice(0, 64) : undefined
    token = typeof body?.token === 'string' ? body.token.slice(0, 128) : undefined
  }
  if (!id || !token || !(await unsubscribe(event, id, token))) notFound('This unsubscribe link is not valid.')
  return { unsubscribed: true }
})
