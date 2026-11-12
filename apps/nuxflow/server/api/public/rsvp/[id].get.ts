import { getPublicRsvpEvent, publicRsvpState } from '../../../utils/event-rsvp'
import { useDb } from '../../../utils/db'
import { requireSiteId } from '../../../utils/site-context'
import { getIntakeForm, publicIntakeForm } from '../../../utils/booking-intake'

// Whether an event is taking RSVPs and how many places are left, plus its intake form's
// questions when it has one. The event page itself is cached whole, so the browser fetches
// this to stay current. No personal data.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const item = await getPublicRsvpEvent(event, getRouterParam(event, 'id')!)
  const [state, intake] = await Promise.all([
    publicRsvpState(event, item),
    getIntakeForm(useDb(event), requireSiteId(event), item.id),
  ])
  return { ...state, intake: intake ? publicIntakeForm(intake) : null }
})
