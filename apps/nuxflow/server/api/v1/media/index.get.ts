import { useDb } from '../../../utils/db'
import { requireAuth } from '../../../utils/permissions'
import { parsePagination } from '../../../utils/pagination'
import { paginate, countRows } from '@nuxflow/db/queries'
import { media } from '@nuxflow/db/schema'
import { and, asc, eq, isNull, desc } from 'drizzle-orm'
import { requireSiteId } from '../../../utils/site-context'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const db = useDb(event)
  const siteId = requireSiteId(event)
  const query = getQuery(event)

  const folderFilter = query.folderId !== undefined
    ? (query.folderId === 'null' || query.folderId === '')
      ? isNull(media.folderId)
      : eq(media.folderId, query.folderId as string)
    : undefined

  const where = folderFilter
    ? and(eq(media.siteId, siteId), folderFilter)!
    : eq(media.siteId, siteId)

  const { page, limit, offset } = parsePagination(query, 60)

  const { items: files, total } = await paginate(
    countRows(db, media, where),
    () => db.query.media.findMany({
      where,
      // `sort=name` gives camera order (DSC_0001, DSC_0002…) for adding a shoot to a
      // gallery; the id tiebreak keeps paging stable when names repeat.
      orderBy: query.sort === 'name'
        ? [asc(media.originalName), asc(media.id)]
        : [desc(media.createdAt)],
      limit,
      offset,
      // Explicit projection — the admin media grid (app/pages/admin/media/index.vue)
      // only reads these columns. `metadata` is deliberately excluded: it's an
      // unbounded JSON blob (currently just EXIF data, but with no size cap in the
      // schema) that's only used to populate the detail modal's EXIF panel, which is
      // a non-critical nicety. `storageKey` is excluded because the frontend never
      // reads it.
      //
      // `url` IS kept, even though it's unbounded too: the grid renders it directly
      // via `<img :src="file.url">` for every storage provider, so dropping it would
      // break thumbnails, not just save bytes. It's only actually large when the
      // active provider is the `local` base64-data-URI fallback (512 KB cap) — for
      // the common case (R2 / Cloudflare Images) it's a short link, so
      // keeping it costs nothing there. There's no separate thumbnail representation
      // to fetch instead, so this is accepted as the local-fallback path's documented
      // last-resort cost rather than solved here.
      columns: {
        id: true,
        folderId: true,
        filename: true,
        originalName: true,
        mimeType: true,
        size: true,
        width: true,
        height: true,
        url: true,
        altText: true,
        caption: true,
        focalX: true,
        focalY: true,
        storageProvider: true,
        uploadedBy: true,
        createdAt: true,
      },
    }),
  )

  return { files, page, limit, total }
})
