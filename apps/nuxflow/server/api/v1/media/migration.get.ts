import { requireRole } from '../../../utils/permissions'
import { getMigrationStatus } from '../../../utils/media-migration'

// How much of this site's media still lives in the database (the storage fallback), and
// whether a real provider is connected to move it to. Drives the "Move to storage" panel
// in Settings → Media and the Super Admin → Database warning.
export default defineEventHandler(async (event) => {
  await requireRole(event, 'admin')
  return getMigrationStatus(event)
})
