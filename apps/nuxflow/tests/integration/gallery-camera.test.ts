/**
 * "Show camera details" on Gallery blocks: the public page API adds each photo's EXIF line,
 * looked up in this site's own library only, without changing what's stored.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { initTestDb, teardownTestDb, getCurrentTestDb } from '../helpers/db'
import { seedSite, seedMedia } from '../helpers/seed'
import { addGalleryCameraDetails, cameraLine } from '../../server/utils/gallery-camera'

const SITE = 'site-gallery-camera-01'
const OTHER = 'site-gallery-camera-02'
const exif = { make: 'Canon', model: 'Canon EOS R5', focalLength: 85, fNumber: 1.8, exposureTime: '1/250', iso: 100 }

beforeAll(async () => {
  await initTestDb()
  const db = getCurrentTestDb()
  await seedSite(db, { id: SITE, domain: 'gallery-camera.localhost' })
  await seedSite(db, { id: OTHER, domain: 'gallery-camera2.localhost' })
  await seedMedia(db, SITE, { url: '/_nuxflow/media/a.jpg', metadata: { exif } })
  await seedMedia(db, SITE, { url: '/_nuxflow/media/plain.jpg', metadata: {} })
  await seedMedia(db, OTHER, { url: '/_nuxflow/media/theirs.jpg', metadata: { exif: { make: 'Nikon', model: 'Z9' } } })
})
afterAll(teardownTestDb)

const gallery = (images: unknown[], showCameraDetails = true) => ({
  id: 'g', type: 'canvas-gallery', props: { images: JSON.stringify(images), showCameraDetails },
})

describe('cameraLine', () => {
  it('reads like a photographer would write it, without repeating the maker', () => {
    expect(cameraLine(exif)).toBe('Canon EOS R5 · 85 mm · f/1.8 · 1/250 s · ISO 100')
    expect(cameraLine({ make: 'FUJIFILM', model: 'X-T5', iso: 400 })).toBe('FUJIFILM X-T5 · ISO 400')
    expect(cameraLine({})).toBe('')
    expect(cameraLine(null)).toBe('')
  })
})

describe('addGalleryCameraDetails', () => {
  it('adds the line to photos it knows, including galleries inside columns', async () => {
    const content = {
      type: 'canvas',
      blocks: [{ id: 'c', type: 'canvas-columns', props: {}, children: { col1: [gallery([{ url: '/_nuxflow/media/a.jpg' }, { url: '/_nuxflow/media/plain.jpg' }, { url: 'https://elsewhere.test/x.jpg' }])] } }],
    }
    const out = await addGalleryCameraDetails(getCurrentTestDb(), SITE, content)
    const images = JSON.parse((out.blocks[0]!.children!.col1![0]!.props as { images: string }).images)
    expect(images[0].camera).toBe('Canon EOS R5 · 85 mm · f/1.8 · 1/250 s · ISO 100')
    expect(images[1].camera).toBeUndefined()
    expect(images[2].camera).toBeUndefined()
    // The stored content is untouched.
    expect(JSON.parse((content.blocks[0]!.children.col1[0]!.props as { images: string }).images)[0].camera).toBeUndefined()
  })

  it('never reads another site\'s library', async () => {
    const out = await addGalleryCameraDetails(getCurrentTestDb(), SITE, { type: 'canvas', blocks: [gallery([{ url: '/_nuxflow/media/theirs.jpg' }])] })
    expect(JSON.parse((out.blocks[0]!.props as { images: string }).images)[0].camera).toBeUndefined()
  })

  it('leaves galleries with the switch off, and non-canvas content, alone', async () => {
    const off = { type: 'canvas', blocks: [gallery([{ url: '/_nuxflow/media/a.jpg' }], false)] }
    expect(await addGalleryCameraDetails(getCurrentTestDb(), SITE, off)).toBe(off)
    const prose = { type: 'doc', content: [] }
    expect(await addGalleryCameraDetails(getCurrentTestDb(), SITE, prose)).toBe(prose)
  })
})
