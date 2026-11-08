// Installing a starter site. Built-in starters apply in one request. Catalog starters run as
// a `starter_installs` job the admin page drives one step per request (the same pattern as
// AI site generation and the WordPress import — a Worker request can't safely copy dozens of
// images and then restore a whole site in one go):
//   1. resolve: look the starter up in the signed catalog, check storage + plan, keep its entry;
//   2. images: a few per request, each checked against its catalog checksum and uploaded to
//      the site's own storage (the media library);
//   3. apply: download demo.json/theme.css, swap image references for the uploaded URLs,
//      then applyStarter() (apply.ts).
// A step that fails leaves the job where it was with the error recorded, so Retry carries on.
import type { H3Event } from 'h3'
import { and, eq, inArray, isNull, like, lt, or, sql } from 'drizzle-orm'
import { ulid } from 'ulid'
import { media, sites, starterInstalls } from '@nuxflow/db/schema'
import { useDb, type Db } from '../db'
import { getActiveProvider } from '../media-providers/index'
import { deleteStoredMedia } from '../media-providers/storage-delete'
import { getCfBindings } from '../cf-env'
import { assertWithinPlan } from '../hosting-plans'
import { sanitizeSvg } from '../sanitize-css-svg'
import { extractImageDimensions } from '../image-dimensions'
import { conflict, httpError, notFound } from '../response'
import { isHttpError } from '../errors'
import {
  fillStarterPlaceholders,
  rewriteStarterImageRefs,
  starterCatalogEntrySchema,
  STARTER_IMAGE_TYPES,
  summarizeCatalogEntry,
  type StarterCatalogEntry,
  type StarterSummary,
} from '../../../shared/lib/starters'
import { builtinStarterSummaries, getBuiltinStarter } from './builtin'
import { fetchStarterFile, getStarterCatalog } from './catalog'
import { applyStarter, type ApplyStarterResult } from './apply'
import { parseStarterDemo } from './demo'

type InstallRow = typeof starterInstalls.$inferSelect

const LEASE_MS = 3 * 60_000
const IMAGES_PER_STEP = 6
const BYTES_PER_STEP = 8 * 1024 * 1024
const MAX_DEMO_BYTES = 5 * 1024 * 1024
const MAX_CSS_BYTES = 512 * 1024

export interface StarterInstallView {
  id: string
  starterId: string
  starterName: string
  mode: 'fresh' | 'switch'
  status: InstallRow['status']
  phase: 'resolve' | 'images' | 'apply' | 'done'
  imagesDone: number
  imagesTotal: number
  error: string | null
}

/** The catalog entry a job stored once it was verified (the DB copy is trusted). */
function manifestOf(row: InstallRow): (StarterCatalogEntry & { catalogUrl: string }) | null {
  if (!row.manifest) return null
  const parsed = starterCatalogEntrySchema.safeParse(row.manifest)
  const catalogUrl = (row.manifest as { catalogUrl?: unknown }).catalogUrl
  if (!parsed.success || typeof catalogUrl !== 'string') return null
  return { ...parsed.data, catalogUrl }
}

export function installView(row: InstallRow): StarterInstallView {
  const manifest = manifestOf(row)
  const phase = row.status === 'done'
    ? 'done'
    : !manifest ? 'resolve' : row.imagesDone < row.imagesTotal ? 'images' : 'apply'
  return {
    id: row.id,
    starterId: row.starterId,
    starterName: manifest?.name ?? getBuiltinStarter(row.starterId)?.summary.name ?? row.starterId,
    mode: row.mode,
    status: row.status,
    phase,
    imagesDone: row.imagesDone,
    imagesTotal: row.imagesTotal,
    error: row.error,
  }
}

/** File storage that isn't the database fallback: R2 or Cloudflare Images. */
export async function starterStorageReady(event: H3Event): Promise<boolean> {
  return (await getActiveProvider(event)).name !== 'local'
}

export async function listStarters(event: H3Event): Promise<{ starters: StarterSummary[]; catalogError: string | null }> {
  const { catalog, error } = await getStarterCatalog(event)
  const builtins = builtinStarterSummaries()
  const builtinIds = new Set(builtins.map(s => s.id))
  const fromCatalog = (catalog?.starters ?? [])
    .filter(s => !builtinIds.has(s.id))
    .map(s => summarizeCatalogEntry(s, catalog!.url))
  return { starters: [...fromCatalog, ...builtins], catalogError: error }
}

/**
 * Whether `id` names a starter that exists. A catalog that can't be reached right now gives
 * the benefit of the doubt (the person picked it from a list moments ago); the install step
 * checks again and reports clearly if it's gone.
 */
export async function isKnownStarter(event: H3Event, id: string): Promise<boolean> {
  if (getBuiltinStarter(id)) return true
  const { catalog } = await getStarterCatalog(event)
  return catalog ? catalog.starters.some(s => s.id === id) : true
}

export async function getOpenInstall(db: Db, siteId: string): Promise<InstallRow | null> {
  const row = await db.query.starterInstalls.findFirst({
    where: and(eq(starterInstalls.siteId, siteId), inArray(starterInstalls.status, ['pending', 'running'])),
  })
  return row ?? null
}

/** Records a catalog starter to install later (a new site, before anyone is signed in). */
export async function createPendingInstall(db: Db, opts: { siteId: string; userId: string | null; starterId: string; mode: 'fresh' | 'switch' }): Promise<InstallRow> {
  const [row] = await db.insert(starterInstalls).values({
    id: ulid(),
    siteId: opts.siteId,
    userId: opts.userId,
    starterId: opts.starterId,
    mode: opts.mode,
    status: 'pending',
  }).returning()
  return row!
}

/**
 * Starts installing a starter on the current site. A built-in one is applied now
 * (`result`); a catalog one returns its job for the page to drive with stepStarterInstall().
 */
export async function startStarterInstall(
  event: H3Event,
  siteId: string,
  userId: string,
  starterId: string,
): Promise<{ install: StarterInstallView | null; result: ApplyStarterResult | null }> {
  const db = useDb(event)
  if (await getOpenInstall(db, siteId)) {
    throw conflict('A starter site is already being installed. Finish or cancel it first.')
  }
  const builtin = getBuiltinStarter(starterId)
  if (builtin) {
    const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { name: true } })
    const result = await applyStarter(event, {
      siteId, userId,
      starter: { id: builtin.summary.id, name: builtin.summary.name, version: builtin.summary.version },
      content: builtin.build(site?.name ?? ''),
      css: null,
      mode: 'switch',
    })
    return { install: null, result }
  }
  if (!(await isKnownStarter(event, starterId))) throw notFound('That starter site is no longer available.')
  try {
    const row = await createPendingInstall(db, { siteId, userId, starterId, mode: 'switch' })
    return { install: installView(row), result: null }
  } catch {
    // The partial unique index: another tab got there first.
    throw conflict('A starter site is already being installed. Finish or cancel it first.')
  }
}

async function claim(db: Db, siteId: string, installId: string): Promise<InstallRow | null> {
  const now = new Date()
  const [row] = await db.update(starterInstalls)
    .set({ lockedUntil: new Date(now.getTime() + LEASE_MS).toISOString() })
    .where(and(
      eq(starterInstalls.id, installId),
      eq(starterInstalls.siteId, siteId),
      inArray(starterInstalls.status, ['pending', 'running']),
      or(isNull(starterInstalls.lockedUntil), lt(starterInstalls.lockedUntil, now.toISOString())),
    ))
    .returning()
  return row ?? null
}

async function save(db: Db, row: Pick<InstallRow, 'id' | 'siteId'>, values: Partial<InstallRow>): Promise<InstallRow> {
  const [updated] = await db.update(starterInstalls)
    .set({ ...values, updatedAt: sql`(datetime('now'))` })
    .where(and(eq(starterInstalls.id, row.id), eq(starterInstalls.siteId, row.siteId)))
    .returning()
  return updated!
}

function storagePrefix(row: Pick<InstallRow, 'id' | 'siteId'>): string {
  return `${row.siteId}/starters/${row.id}/`
}

async function resolveStep(event: H3Event, db: Db, row: InstallRow): Promise<InstallRow> {
  const { catalog, error } = await getStarterCatalog(event)
  if (!catalog) throw httpError({ status: 503, message: error ?? 'The starter catalog is switched off on this server.' })
  const entry = catalog.starters.find(s => s.id === row.starterId)
  if (!entry) throw notFound('That starter site is no longer in the catalog. Cancel this install and pick another.')
  if (entry.images.length > 0 && !(await starterStorageReady(event))) {
    throw httpError({
      status: 409,
      message: 'This starter site includes images, which need file storage. Connect R2 or Cloudflare Images in Settings → Media, then try again.',
      data: { code: 'storage_required' },
    })
  }
  if (entry.css && !getCfBindings(event).kv) {
    throw httpError({ status: 503, message: 'This starter site includes a theme, which needs the PLUGIN_KV namespace in wrangler.toml.' })
  }
  const total = entry.images.reduce((sum, i) => sum + i.size, 0)
  if (total > 0) await assertWithinPlan(event, 'storage', total, row.siteId)
  return save(db, row, {
    manifest: { ...entry, catalogUrl: catalog.url },
    imagesTotal: entry.images.length,
    imagesDone: 0,
    imageUrls: {},
    status: 'running',
    error: null,
  })
}

async function imagesStep(event: H3Event, db: Db, row: InstallRow, manifest: NonNullable<ReturnType<typeof manifestOf>>, userId: string): Promise<InstallRow> {
  const provider = await getActiveProvider(event)
  const urls = { ...(row.imageUrls ?? {}) }
  let done = row.imagesDone
  let bytes = 0
  let count = 0
  while (done < manifest.images.length && count < IMAGES_PER_STEP && (count === 0 || bytes < BYTES_PER_STEP)) {
    const image = manifest.images[done]!
    const filename = image.ref.split('/').pop()!
    const ext = filename.split('.').pop()!.toLowerCase()
    const mimeType = STARTER_IMAGE_TYPES[ext] ?? 'application/octet-stream'
    let data: Uint8Array = await fetchStarterFile(manifest.catalogUrl, image)
    if (mimeType === 'image/svg+xml') data = new TextEncoder().encode(sanitizeSvg(new TextDecoder().decode(data)))
    await assertWithinPlan(event, 'storage', data.byteLength, row.siteId)

    const storageKey = `${storagePrefix(row)}${done}-${filename}`
    const buffer = data.slice().buffer
    const uploaded = await provider.upload(new File([buffer], filename, { type: mimeType }), storageKey, row.siteId)
    const dims = extractImageDimensions(buffer, mimeType)
    await db.insert(media).values({
      id: ulid(),
      siteId: row.siteId,
      uploadedBy: userId,
      filename: storageKey,
      originalName: filename,
      mimeType,
      size: data.byteLength,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      url: uploaded.url,
      storageProvider: provider.name as 'cloudflare' | 'local' | 'r2',
      storageKey: uploaded.storageKey || storageKey,
    })
    urls[image.ref] = uploaded.url
    done++
    count++
    bytes += data.byteLength
    // Saved per image, so a request that dies mid-step never uploads the same file twice.
    row = await save(db, row, { imageUrls: urls, imagesDone: done, error: null })
  }
  return row
}

async function applyStep(event: H3Event, db: Db, row: InstallRow, manifest: NonNullable<ReturnType<typeof manifestOf>>, userId: string): Promise<{ row: InstallRow; result: ApplyStarterResult }> {
  if (manifest.demo.size > MAX_DEMO_BYTES) throw httpError({ status: 422, message: 'This starter site\'s content is too large.' })
  if (manifest.css && manifest.css.size > MAX_CSS_BYTES) throw httpError({ status: 422, message: 'This starter site\'s theme is too large.' })
  const site = await db.query.sites.findFirst({ where: eq(sites.id, row.siteId), columns: { name: true } })
  const demoText = new TextDecoder().decode(await fetchStarterFile(manifest.catalogUrl, manifest.demo))
  const css = manifest.css ? new TextDecoder().decode(await fetchStarterFile(manifest.catalogUrl, manifest.css)) : null
  let backup
  try {
    backup = parseStarterDemo(rewriteStarterImageRefs(fillStarterPlaceholders(demoText, site?.name ?? ''), row.imageUrls ?? {}))
  } catch (err) {
    throw httpError({ status: 422, message: err instanceof Error ? err.message : 'The starter site\'s content could not be read.' })
  }

  // From here on the site is being changed; a failure part-way can't simply be retried.
  try {
    const result = await applyStarter(event, {
      siteId: row.siteId,
      userId,
      starter: { id: manifest.id, name: manifest.name, version: manifest.version },
      content: {
        content: backup.content,
        contentTypes: backup.contentTypes,
        taxonomies: backup.taxonomies,
        menus: backup.menus,
        forms: backup.forms,
        settings: backup.settings,
      },
      css,
      mode: row.mode,
    })
    return { row: await save(db, row, { status: 'done', lockedUntil: null, error: null }), result }
  } catch (err) {
    console.error('[starters] applying starter failed:', err)
    await save(db, row, {
      status: 'failed',
      lockedUntil: null,
      error: 'Installing stopped part-way through. Some of the starter\'s pages may have been added — check Content, then try again.',
    })
    throw err
  }
}

/** Does the next unit of work of a catalog starter install. */
export async function stepStarterInstall(
  event: H3Event,
  siteId: string,
  installId: string,
  userId: string,
): Promise<{ install: StarterInstallView; busy: boolean; result: ApplyStarterResult | null }> {
  const db = useDb(event)
  const row = await claim(db, siteId, installId)
  if (!row) {
    const existing = await db.query.starterInstalls.findFirst({
      where: and(eq(starterInstalls.id, installId), eq(starterInstalls.siteId, siteId)),
    })
    if (!existing) throw notFound('Starter install not found')
    return { install: installView(existing), busy: existing.status === 'pending' || existing.status === 'running', result: null }
  }

  try {
    // A pending 'fresh' row can name a built-in starter (never written that way today, but
    // cheap to honour): apply it straight away.
    const builtin = getBuiltinStarter(row.starterId)
    if (builtin && !row.manifest) {
      const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId), columns: { name: true } })
      const result = await applyStarter(event, {
        siteId, userId,
        starter: { id: builtin.summary.id, name: builtin.summary.name, version: builtin.summary.version },
        content: builtin.build(site?.name ?? ''),
        css: null,
        mode: row.mode,
      })
      return { install: installView(await save(db, row, { status: 'done', lockedUntil: null })), busy: false, result }
    }

    const manifest = manifestOf(row)
    if (!manifest) {
      const resolved = await resolveStep(event, db, row)
      return { install: installView(await save(db, resolved, { lockedUntil: null })), busy: false, result: null }
    }
    if (row.imagesDone < manifest.images.length) {
      const after = await imagesStep(event, db, row, manifest, userId)
      return { install: installView(await save(db, after, { lockedUntil: null })), busy: false, result: null }
    }
    const { row: finished, result } = await applyStep(event, db, row, manifest, userId)
    return { install: installView(finished), busy: false, result }
  } catch (err) {
    const message = isHttpError(err) || err instanceof Error ? (err as Error).message : 'Something went wrong.'
    const current = await db.query.starterInstalls.findFirst({
      where: and(eq(starterInstalls.id, installId), eq(starterInstalls.siteId, siteId)),
      columns: { status: true },
    })
    if (current && current.status !== 'failed') await save(db, row, { lockedUntil: null, error: message })
    throw err
  }
}

/** Stops an unfinished (or failed) install and removes the images it had copied. */
export async function cancelStarterInstall(event: H3Event, siteId: string, installId: string): Promise<StarterInstallView> {
  const db = useDb(event)
  const row = await db.query.starterInstalls.findFirst({
    where: and(eq(starterInstalls.id, installId), eq(starterInstalls.siteId, siteId)),
  })
  if (!row) throw notFound('Starter install not found')
  if (row.status === 'done' || row.status === 'cancelled') return installView(row)
  if (row.lockedUntil && row.lockedUntil > new Date().toISOString() && row.status !== 'failed') {
    throw conflict('A step is running right now. Try again in a moment.')
  }
  const cancelled = await save(db, row, { status: 'cancelled', lockedUntil: null })

  // A failed install got as far as applying, so its images may be in use on the new pages.
  if (row.status !== 'failed') {
    const files = await db.query.media.findMany({
      where: and(eq(media.siteId, siteId), like(media.storageKey, `${storagePrefix(row)}%`)),
      columns: { id: true, storageKey: true, storageProvider: true },
    })
    for (const file of files) {
      try {
        await deleteStoredMedia(event, siteId, file)
      } catch (err) {
        console.warn('[starters] could not delete a cancelled install\'s file:', err)
      }
    }
    if (files.length > 0) {
      await db.delete(media).where(and(eq(media.siteId, siteId), inArray(media.id, files.map(f => f.id))))
    }
  }
  return installView(cancelled)
}
