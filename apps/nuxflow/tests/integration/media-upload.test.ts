/**
 * Integration tests for POST /api/v1/media/upload (server/api/v1/media/upload.post.ts).
 *
 * media-patch.test.ts covers PATCH /api/v1/media/:id; tests/unit/media-providers.test.ts
 * unit-tests the provider abstraction in isolation. Nothing previously exercised the
 * upload route's own wiring: provider selection via getActiveProvider() (which falls
 * back to the local base64-in-D1 provider when no Cloudflare Images/R2/S3/Bunny setting
 * or binding is configured — the easiest real path to exercise without mocking a live
 * cloud provider call), the extractExif() call chain, and the resulting media.metadata
 * write, all wired together through the real handler.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { H3Event } from 'h3'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { createMockEvent } from '../helpers/event'
import { seedSite, seedUser, seedRole } from '../helpers/seed'
import { media } from '@nuxflow/db/schema'
import { eq } from 'drizzle-orm'
import uploadHandler from '../../server/api/v1/media/upload.post'

vi.mock('../../server/utils/db', () => ({
  useDb: () => getCurrentTestDb(),
  getD1: () => null,
}))

const SITE = 'site-media-upload-01'
let authorId: string
let viewerId: string

type HandlerFn = (e: H3Event) => Promise<unknown>

function mkEvent(file: File, userId = authorId) {
  const formData = new FormData()
  formData.set('file', file)
  return createMockEvent({
    siteId: SITE,
    session: { user: { id: userId, name: 'Test', email: 'test@media-upload.test' } },
    formData,
  }) as unknown as H3Event
}

// Builds a minimal-but-real JPEG: SOI + a single APP1 "Exif" segment containing a TIFF
// IFD0 with Make/Model ASCII tags (offset-addressed, i.e. > 4 bytes, matching how real
// camera metadata is stored) — everything extractExif() actually reads before it stops
// walking segments. No image data / EOI needed since extractExif() returns as soon as it
// locates and parses the Exif TIFF block.
function buildJpegWithExif(make: string, model: string): Uint8Array {
  const enc = new TextEncoder()
  const makeBytes = enc.encode(`${make}\0`)
  const modelBytes = enc.encode(`${model}\0`)

  const ifd0Off = 8 // tiff-relative offset to IFD0
  const entryCount = 2
  const entriesZoneSize = 2 + entryCount * 12 + 4 // count(2) + entries(12 each) + nextIFDOffset(4)
  const makeStrOff = ifd0Off + entriesZoneSize
  const modelStrOff = makeStrOff + makeBytes.length
  const tiffLen = modelStrOff + modelBytes.length

  const tiff = new Uint8Array(tiffLen)
  const dv = new DataView(tiff.buffer)

  tiff[0] = 0x49 // 'I'
  tiff[1] = 0x49 // 'I' — little-endian TIFF
  dv.setUint16(2, 42, true) // TIFF magic
  dv.setUint32(4, ifd0Off, true) // offset to IFD0

  dv.setUint16(ifd0Off, entryCount, true)

  function writeEntry(off: number, tag: number, type: number, count: number, valueOrOffset: number) {
    dv.setUint16(off, tag, true)
    dv.setUint16(off + 2, type, true)
    dv.setUint32(off + 4, count, true)
    dv.setUint32(off + 8, valueOrOffset, true)
  }

  const entry1Off = ifd0Off + 2
  const entry2Off = entry1Off + 12
  writeEntry(entry1Off, 0x010F, 2, makeBytes.length, makeStrOff) // Make (ASCII, type 2)
  writeEntry(entry2Off, 0x0110, 2, modelBytes.length, modelStrOff) // Model (ASCII, type 2)
  dv.setUint32(entry2Off + 12, 0, true) // next IFD offset = none

  tiff.set(makeBytes, makeStrOff)
  tiff.set(modelBytes, modelStrOff)

  const exifHeader = enc.encode('Exif\0\0')
  const app1Content = new Uint8Array(exifHeader.length + tiff.length)
  app1Content.set(exifHeader, 0)
  app1Content.set(tiff, exifHeader.length)

  const segLen = app1Content.length + 2 // segment length field includes itself
  const jpeg = new Uint8Array(2 + 2 + 2 + app1Content.length)
  jpeg[0] = 0xFF
  jpeg[1] = 0xD8 // SOI
  jpeg[2] = 0xFF
  jpeg[3] = 0xE1 // APP1
  new DataView(jpeg.buffer).setUint16(4, segLen, false) // segment length is big-endian
  jpeg.set(app1Content, 6)

  return jpeg
}

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()

  await seedSite(db, { id: SITE, domain: 'media-upload.localhost' })
  authorId = await seedUser(db, { email: 'author@media-upload.test' })
  viewerId = await seedUser(db, { email: 'viewer@media-upload.test' })
  await seedRole(db, authorId, SITE, 'author')
  await seedRole(db, viewerId, SITE, 'viewer')
})

afterAll(teardownTestDb)

describe('POST /api/v1/media/upload', () => {
  it('(a) uploads successfully via the local base64 fallback provider when no real provider is configured', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], 'small.png', { type: 'image/png' })
    const event = mkEvent(file)

    const result = await (uploadHandler as HandlerFn)(event) as { id: string; url: string }

    expect(result.id).toBeTruthy()
    expect(result.url).toMatch(/^data:image\/png;base64,/)
    expect((event as unknown as { _status?: number })._status).toBe(201)

    const db = getCurrentTestDb()
    const row = await db.query.media.findFirst({ where: eq(media.id, result.id) })
    expect(row).toBeTruthy()
    expect(row!.siteId).toBe(SITE)
    expect(row!.storageProvider).toBe('local')
    expect(row!.mimeType).toBe('image/png')
    expect(row!.originalName).toBe('small.png')
    expect(row!.size).toBe(5)
  })

  it('(b) rejects an upload over the local fallback\'s 512 KB cap with 413', async () => {
    const oversized = new Uint8Array(513 * 1024)
    const file = new File([oversized], 'big.png', { type: 'image/png' })
    const event = mkEvent(file)

    await expect((uploadHandler as HandlerFn)(event)).rejects.toMatchObject({ statusCode: 413 })

    // No media row should have been created for a rejected upload.
    const db = getCurrentTestDb()
    const rows = await db.query.media.findMany({ where: eq(media.originalName, 'big.png') })
    expect(rows).toHaveLength(0)
  })

  it('(c) extracts and stores EXIF metadata for a JPEG that has it', async () => {
    const jpegBytes = buildJpegWithExif('Canon', 'Canon EOS 5D')
    const file = new File([jpegBytes], 'photo.jpg', { type: 'image/jpeg' })
    const event = mkEvent(file)

    const result = await (uploadHandler as HandlerFn)(event) as { id: string; url: string }

    const db = getCurrentTestDb()
    const row = await db.query.media.findFirst({ where: eq(media.id, result.id) })
    expect(row).toBeTruthy()
    expect(row!.metadata).toBeTruthy()
    const metadata = row!.metadata as { exif?: { make?: string; model?: string } }
    expect(metadata.exif).toBeTruthy()
    expect(metadata.exif!.make).toBe('Canon')
    expect(metadata.exif!.model).toBe('Canon EOS 5D')
  })

  it('(d) a non-JPEG image is stored with no exif key in metadata (extraction is skipped entirely)', async () => {
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'plain.png', { type: 'image/png' })
    const event = mkEvent(file)

    const result = await (uploadHandler as HandlerFn)(event) as { id: string }

    const db = getCurrentTestDb()
    const row = await db.query.media.findFirst({ where: eq(media.id, result.id) })
    expect(row).toBeTruthy()
    expect(row!.metadata == null || !('exif' in (row!.metadata as object))).toBe(true)
  })

  it('(d.2) a JPEG with no EXIF data is stored with no exif key in metadata', async () => {
    // A bare JPEG with just SOI + EOI, no APP1 segment at all — extractExif() returns
    // null (no Exif TIFF block found), and the handler never sets `metadata` at all.
    const bareJpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9])
    const file = new File([bareJpeg], 'no-exif.jpg', { type: 'image/jpeg' })
    const event = mkEvent(file)

    const result = await (uploadHandler as HandlerFn)(event) as { id: string }

    const db = getCurrentTestDb()
    const row = await db.query.media.findFirst({ where: eq(media.id, result.id) })
    expect(row).toBeTruthy()
    expect(row!.metadata).toBeFalsy()
  })

  it('rejects a viewer (needs author+) with 403', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' })
    const event = mkEvent(file, viewerId)

    await expect((uploadHandler as HandlerFn)(event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rejects an upload with no file provided', async () => {
    const event = createMockEvent({
      siteId: SITE,
      session: { user: { id: authorId, name: 'Test', email: 'test@media-upload.test' } },
      formData: new FormData(),
    }) as unknown as H3Event

    await expect((uploadHandler as HandlerFn)(event)).rejects.toMatchObject({ statusCode: 400 })
  })

  // The SVG sanitizer used to run only on an exact `image/svg+xml` match, so a parameter
  // on the declared type skipped it while still passing the `image/` allowlist.
  it('sanitizes an SVG whose declared type carries parameters, and stores the bare type', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>'
    const file = new File([svg], 'logo.svg', { type: 'image/svg+xml;charset=utf-8' })
    const result = await (uploadHandler as HandlerFn)(mkEvent(file)) as { id: string; url: string }

    expect(result.url.startsWith('data:image/svg+xml;base64,')).toBe(true)
    const stored = atob(result.url.slice('data:image/svg+xml;base64,'.length))
    expect(stored).not.toMatch(/onload|<script/i)

    const row = await getCurrentTestDb().query.media.findFirst({ where: eq(media.id, result.id) })
    expect(row!.mimeType).toBe('image/svg+xml')
  })
})

