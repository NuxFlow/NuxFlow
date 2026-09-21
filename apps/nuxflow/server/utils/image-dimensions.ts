// Pure Web APIs, zero dependencies — reads pixel width/height straight out of each
// format's own header instead of decoding the image, same spirit as exif.ts's hand-rolled
// JPEG parser. This exists because @nuxt/image's normal path for this (the 'ipx' provider,
// which wraps `sharp`) cannot run in the Workers runtime at all — sharp's native bindings
// don't exist there, a documented, real bundling failure (see nuxt.config.ts's `image`
// block comment) — so there is no decode-the-image fallback available; the only dimensions
// this app can ever know are whatever a lightweight header parse like this one can find.
// Returns null (never throws) for any format/corruption it doesn't recognize — dimensions
// are a nice-to-have for reserving layout space, never a require-to-succeed part of upload.
export interface ImageDimensions {
  width: number
  height: number
}

function readPng(view: DataView): ImageDimensions | null {
  // 8-byte signature, then first chunk must be IHDR: length(4) + "IHDR"(4) + width(4) + height(4)
  if (view.byteLength < 24) return null
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
  for (let i = 0; i < 8; i++) if (view.getUint8(i) !== sig[i]) return null
  if (view.getUint32(12) !== 0x49484452) return null // "IHDR"
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

function readGif(view: DataView): ImageDimensions | null {
  // "GIF87a" or "GIF89a" (6 bytes) + width(2 LE) + height(2 LE)
  if (view.byteLength < 10) return null
  if (view.getUint8(0) !== 0x47 || view.getUint8(1) !== 0x49 || view.getUint8(2) !== 0x46) return null
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
}

function readJpeg(view: DataView): ImageDimensions | null {
  if (view.byteLength < 4) return null
  if (view.getUint8(0) !== 0xFF || view.getUint8(1) !== 0xD8) return null

  let pos = 2
  while (pos + 4 <= view.byteLength) {
    if (view.getUint8(pos) !== 0xFF) break
    const marker = view.getUint8(pos + 1)
    // SOFn markers carrying real frame dimensions — excludes DHT (C4), JPG (C8), DAC (CC),
    // which share the C0-CF range but aren't start-of-frame markers.
    const isSof = (marker >= 0xC0 && marker <= 0xC3) || (marker >= 0xC5 && marker <= 0xC7)
      || (marker >= 0xC9 && marker <= 0xCB) || (marker >= 0xCD && marker <= 0xCF)
    if (isSof && pos + 9 <= view.byteLength) {
      return { height: view.getUint16(pos + 5), width: view.getUint16(pos + 7) }
    }
    if (marker === 0xD8 || marker === 0xD9) { pos += 2; continue } // no length field
    const segLen = view.getUint16(pos + 2)
    if (segLen < 2) break
    pos += 2 + segLen
  }
  return null
}

function readWebp(view: DataView): ImageDimensions | null {
  // "RIFF" + size(4) + "WEBP" + first chunk
  if (view.byteLength < 30) return null
  if (view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x57454250) return null

  const chunkFourCC = view.getUint32(12)
  if (chunkFourCC === 0x56503820) { // "VP8 " — lossy
    // Frame tag at offset 20-22 is a 3-byte size/key-frame flag we don't need; the
    // 0x9d 0x01 0x2a start code is at offset 23-25, followed by 2x uint16 LE 14-bit
    // width/height (top 2 bits are scaling flags, masked off).
    if (view.getUint8(23) !== 0x9D || view.getUint8(24) !== 0x01 || view.getUint8(25) !== 0x2A) return null
    const w = view.getUint16(26, true) & 0x3FFF
    const h = view.getUint16(28, true) & 0x3FFF
    return { width: w, height: h }
  }
  if (chunkFourCC === 0x56503858) { // "VP8X" — extended (has explicit canvas size)
    // flags(1) + reserved(3) at offset 20-23, then 3-byte LE (width-1), 3-byte LE (height-1)
    const w = (view.getUint8(24) | (view.getUint8(25) << 8) | (view.getUint8(26) << 16)) + 1
    const h = (view.getUint8(27) | (view.getUint8(28) << 8) | (view.getUint8(29) << 16)) + 1
    return { width: w, height: h }
  }
  if (chunkFourCC === 0x5650384C) { // "VP8L" — lossless
    if (view.getUint8(20) !== 0x2F) return null // signature byte
    // 4 bytes LE starting at offset 21 pack: 14-bit (width-1), 14-bit (height-1), then flags
    const b0 = view.getUint8(21)
    const b1 = view.getUint8(22)
    const b2 = view.getUint8(23)
    const bits = b0 | (b1 << 8) | (b2 << 16)
    const w = (bits & 0x3FFF) + 1
    const h = ((bits >> 14) & 0x3FFF) + 1
    return { width: w, height: h }
  }
  return null
}

export function extractImageDimensions(buffer: ArrayBuffer, mimeType: string): ImageDimensions | null {
  try {
    const view = new DataView(buffer)
    let result: ImageDimensions | null = null
    if (mimeType === 'image/png') result = readPng(view)
    else if (mimeType === 'image/gif') result = readGif(view)
    else if (mimeType === 'image/jpeg') result = readJpeg(view)
    else if (mimeType === 'image/webp') result = readWebp(view)
    if (!result || result.width <= 0 || result.height <= 0) return null
    return result
  }
  catch {
    return null
  }
}
