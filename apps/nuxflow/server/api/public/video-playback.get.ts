import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { videoAssets } from '@nuxflow/db/schema'
import { findVideoEmbeds } from '@nuxflow/canvas/video'
import { useDb } from '../../utils/db'
import { rateLimit } from '../../utils/rate-limit'
import { findPublishedPage, parseLocalePath } from '../../utils/public-page'
import { checkContentAccess } from '../../utils/content-access'
import { isSiteStaff } from '../../utils/page-password'
import { requireSiteId } from '../../utils/site-context'
import { needsSignedLink, signedPlayback, STREAM_ID_RE } from '../../utils/stream'
import { planLimitMessage } from '../../utils/hosting-plans'

// A signed player link for a private Cloudflare Stream video (utils/stream.ts), fetched by
// the Video block, Video gallery or a post's video in the browser. Anyone who can see the
// page it's on may watch — the same gate as the page (password, members, tier), like
// gallery downloads. `block` names the Canvas block; without it, a video in the page's
// prose (a post) is looked for. A video paused by the plan's watching allowance
// (video-usage.ts) gets a 403 with the reason. Signed-in
// team members may watch any of the site's videos (the editor, previews). Only videos in
// this site's own library are ever signed. `{ url: null }` means the video is public and
// its plain link works.
const querySchema = z.object({
  video: z.string().regex(STREAM_ID_RE).transform(v => v.toLowerCase()),
  path: z.string().max(500).default(''),
  block: z.string().min(1).max(100).optional(),
})

export default defineEventHandler(async (event) => {
  const siteId = requireSiteId(event)
  const query = parseQuery(event, querySchema)
  await rateLimit(event, { limit: 120, windowMs: 60_000, keyPrefix: 'video-playback' })

  setHeader(event, 'Cache-Control', 'private, no-store')
  setHeader(event, 'X-Robots-Tag', 'noindex')

  const db = useDb(event)
  const row = await db.query.videoAssets.findFirst({
    where: and(eq(videoAssets.siteId, siteId), eq(videoAssets.cloudflareStreamId, query.video)),
    columns: { cloudflareStreamId: true, streamAccount: true, thumbnailUrl: true, isPrivate: true, watchPaused: true },
  })
  if (!row) throw notFound()
  if (!needsSignedLink(row)) return { url: null }

  const staff = await isSiteStaff(event, siteId)
  if (!staff) {
    // 404 for anything a visitor may not watch, so a gated page's existence isn't confirmed.
    const slugPath = query.path.replace(/^\/+|\/+$/g, '') || 'home'
    const { locale, slug } = await parseLocalePath(db, siteId, slugPath)
    const page = await findPublishedPage(db, siteId, slug || 'home', locale)
    if (!page) throw notFound()
    const gate = await checkContentAccess(event, { id: page.id, sourceItemId: page.sourceItemId, visibility: page.visibility, settings: page.settings as Record<string, unknown> | null }, siteId)
    if (gate?.blocked) throw notFound()
    const shown = findVideoEmbeds(page.content).some(e => e.ref.provider === 'stream' && e.ref.id === query.video
      && (query.block ? e.blockId === query.block : e.kind === 'node'))
    if (!shown) throw notFound()
    // Paused until the plan's watching allowance resets — the team can still preview it.
    if (row.watchPaused) throw forbidden(planLimitMessage('video_watch', 0), { code: 'plan_limit', limit: 'video_watch' })
  }

  const { playbackUrl } = await signedPlayback(event, siteId, row)
  return { url: playbackUrl }
})
