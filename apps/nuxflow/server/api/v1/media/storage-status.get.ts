import { requireAuth } from '../../../utils/permissions'
import { getActiveProvider } from '../../../utils/media-providers/index'

// Surfaces whether uploads are currently landing on the local base64-in-D1 fallback
// (see getActiveProvider's doc comment) so the admin UI can warn about it proactively
// instead of an operator discovering it months later via a bloated page — see
// AdminMediaFallbackWarning.vue, shown on the dashboard and the media library.
export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const provider = await getActiveProvider(event)
  return {
    provider: provider.name,
    isFallback: provider.name === 'local',
  }
})
