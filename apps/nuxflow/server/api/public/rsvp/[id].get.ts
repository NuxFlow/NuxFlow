import { getPublicRsvpEvent, publicRsvpState } from '../../../utils/event-rsvp'

// Whether an event is taking RSVPs and how many places are left. The event page itself is
// cached whole, so the browser fetches this to stay current. No personal data.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const item = await getPublicRsvpEvent(event, getRouterParam(event, 'id')!)
  return publicRsvpState(event, item)
})
