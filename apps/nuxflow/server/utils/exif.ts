export interface ExifData {
  make?: string
  model?: string
  exposureTime?: string
  fNumber?: number
  iso?: number
  dateTimeOriginal?: string
  focalLength?: number
  flash?: number
}

/**
 * Minimal JPEG EXIF extractor — pure Web APIs, zero dependencies.
 * Reads IFD0 (Make, Model) and ExifIFD (exposure, ISO, focal length).
 * Returns null for non-JPEG files or images without EXIF data.
 */
export function extractExif(buffer: ArrayBuffer): ExifData | null {
  const view = new DataView(buffer)
  if (view.byteLength < 12) return null

  // Must start with JPEG SOI FF D8
  if (view.getUint8(0) !== 0xFF || view.getUint8(1) !== 0xD8) return null

  // Walk JPEG segments to find APP1 (FF E1) with Exif header
  let pos = 2
  let tiff = -1

  while (pos + 4 <= view.byteLength) {
    if (view.getUint8(pos) !== 0xFF) break
    const marker = view.getUint8(pos + 1)
    if (marker === 0xDA) break // Start of Scan — no more metadata headers

    const segLen = view.getUint16(pos + 2) // length includes the 2 length bytes
    if (marker === 0xE1 && pos + 10 <= view.byteLength) {
      const h = pos + 4
      if (
        view.getUint8(h) === 0x45 && view.getUint8(h + 1) === 0x78
        && view.getUint8(h + 2) === 0x69 && view.getUint8(h + 3) === 0x66
        && view.getUint8(h + 4) === 0x00 && view.getUint8(h + 5) === 0x00
      ) {
        tiff = h + 6 // start of TIFF block
        break
      }
    }
    if (segLen < 2) break
    pos += 2 + segLen
  }

  if (tiff === -1) return null

  // TIFF byte-order header
  const bo = view.getUint16(tiff)
  if (bo !== 0x4949 && bo !== 0x4D4D) return null
  const le = bo === 0x4949 // true = little-endian

  const r16 = (off: number) => view.getUint16(tiff + off, le)
  const r32 = (off: number) => view.getUint32(tiff + off, le)

  if (r16(2) !== 42) return null // TIFF magic

  const ifd0Off = r32(4)

  // TIFF data type sizes (bytes per component)
  const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }

  interface Entry { type: number; count: number; valOff: number }

  function readIFD(ifdOff: number): Map<number, Entry> {
    const map = new Map<number, Entry>()
    const abs = tiff + ifdOff
    if (abs + 2 > view.byteLength) return map
    const n = r16(ifdOff)
    for (let i = 0; i < n; i++) {
      const base = ifdOff + 2 + i * 12
      if (tiff + base + 12 > view.byteLength) break
      const tag = r16(base)
      const type = r16(base + 2)
      const count = r32(base + 4)
      const totalSize = (TYPE_SIZE[type] ?? 1) * count
      // Value field is at base+8; if total fits in 4 bytes it's inline, else it's an offset from TIFF start
      const valOff = totalSize <= 4 ? base + 8 : r32(base + 8)
      map.set(tag, { type, count, valOff })
    }
    return map
  }

  function ascii(off: number, count: number): string {
    let s = ''
    const end = Math.min(tiff + off + count, view.byteLength)
    for (let i = tiff + off; i < end; i++) {
      const c = view.getUint8(i)
      if (c === 0) break
      s += String.fromCharCode(c)
    }
    return s.trim()
  }

  function rational(off: number): number {
    const n = r32(off)
    const d = r32(off + 4)
    return d === 0 ? 0 : n / d
  }

  function getStr(map: Map<number, Entry>, tag: number): string | undefined {
    const e = map.get(tag)
    if (!e || e.type !== 2) return undefined
    return ascii(e.valOff, e.count)
  }

  function getShort(map: Map<number, Entry>, tag: number): number | undefined {
    const e = map.get(tag)
    if (!e || e.type !== 3) return undefined
    return r16(e.valOff)
  }

  function getLong(map: Map<number, Entry>, tag: number): number | undefined {
    const e = map.get(tag)
    if (!e || (e.type !== 4 && e.type !== 3)) return undefined
    return e.type === 4 ? r32(e.valOff) : r16(e.valOff)
  }

  function getRational(map: Map<number, Entry>, tag: number): number | undefined {
    const e = map.get(tag)
    if (!e || e.type !== 5) return undefined
    return rational(e.valOff)
  }

  const ifd0 = readIFD(ifd0Off)
  const result: ExifData = {}

  result.make = getStr(ifd0, 0x010F)
  result.model = getStr(ifd0, 0x0110)

  // ExifIFD sub-directory
  const exifOff = getLong(ifd0, 0x8769)
  if (exifOff !== undefined) {
    const exif = readIFD(exifOff)

    const et = getRational(exif, 0x829A)
    if (et !== undefined) {
      result.exposureTime = et >= 1 ? `${et}` : `1/${Math.round(1 / et)}`
    }

    const fn = getRational(exif, 0x829D)
    if (fn !== undefined) result.fNumber = Math.round(fn * 10) / 10

    result.iso = getShort(exif, 0x8827)
    result.dateTimeOriginal = getStr(exif, 0x9003)

    const fl = getRational(exif, 0x920A)
    if (fl !== undefined) result.focalLength = Math.round(fl * 10) / 10

    result.flash = getShort(exif, 0x9209)
  }

  // Only return if we found meaningful camera data
  const hasData = result.make || result.model || result.dateTimeOriginal || result.iso
  return hasData ? result : null
}
