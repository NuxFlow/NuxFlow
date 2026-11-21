import { requireRole } from '../../../utils/permissions'
import { getActiveProvider } from '../../../utils/media-providers/index'
import { MAX_MEDIA_UPLOAD_BYTES, storeMediaFile } from '../../../utils/media-upload'
import { created, httpError } from '../../../utils/response'
import { requireSiteId } from '../../../utils/site-context'

export default defineEventHandler(async (event) => {
  const { userId } = await requireRole(event, 'author')
  const siteId = requireSiteId(event)

  // Reject an oversized body before readFormData() buffers the entire multipart payload
  // into memory — the size check in storeMediaFile() only runs after that buffering
  // already happened, which is too late to protect the Worker's own ~128MB isolate memory
  // ceiling (see CLAUDE.md's d1-export.ts postmortem for the same class of failure). A
  // request can lack Content-Length (chunked transfer) and skip this check entirely — the
  // post-buffering size check still catches those, just without the early-exit benefit.
  const contentLength = Number(getHeader(event, 'content-length') ?? 0)
  if (contentLength > MAX_MEDIA_UPLOAD_BYTES) {
    throw httpError({ status: 413, message: 'File too large (max 20 MB)' })
  }

  // No file storage → refuse before buffering the body (409 storage_required).
  const provider = await getActiveProvider(event)

  const formData = await readFormData(event)
  const file = formData.get('file') as File | null
  if (!file) throw badRequest('No file provided')

  const stored = await storeMediaFile(event, provider, { file, userId, siteId })
  return created(event, stored)
})
