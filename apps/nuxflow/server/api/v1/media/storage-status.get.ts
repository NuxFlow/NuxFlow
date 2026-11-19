import { requireAuth } from '../../../utils/permissions'
import { findMediaProvider } from '../../../utils/media-providers/index'

// Whether this site has file storage at all — without it every upload is refused
// (getActiveProvider() throws 409 storage_required), so the admin UI says so up front
// instead of an author finding out from a failed upload. See AdminMediaStorageWarning.vue.
export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const provider = await findMediaProvider(event)
  return {
    provider: provider?.name ?? null,
    hasStorage: provider !== null,
  }
})
