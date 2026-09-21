import { describe, it, expect } from 'vitest'
import { extractImageDimensions } from '../../server/utils/image-dimensions'

function buf(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer
}

describe('extractImageDimensions', () => {
  it('reads width/height from a PNG IHDR chunk', () => {
    const bytes = [
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // signature
      0x00, 0x00, 0x00, 0x0D, // chunk length (13, unused by parser)
      0x49, 0x48, 0x44, 0x52, // "IHDR"
      0x00, 0x00, 0x01, 0x90, // width = 400 (BE)
      0x00, 0x00, 0x00, 0xC8, // height = 200 (BE)
      0x08, 0x06, 0x00, 0x00, 0x00, // rest of IHDR (bit depth etc, unused)
    ]
    expect(extractImageDimensions(buf(bytes), 'image/png')).toEqual({ width: 400, height: 200 })
  })

  it('reads width/height from a GIF logical screen descriptor', () => {
    const bytes = [
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // "GIF89a"
      0x20, 0x03, // width = 800 (LE)
      0x58, 0x02, // height = 600 (LE)
      0x00, 0x00,
    ]
    expect(extractImageDimensions(buf(bytes), 'image/gif')).toEqual({ width: 800, height: 600 })
  })

  it('reads width/height from a baseline JPEG SOF0 marker', () => {
    const bytes = [
      0xFF, 0xD8, // SOI
      0xFF, 0xE0, 0x00, 0x10, // APP0 marker, length 16 (14 bytes of payload follow)
      0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // JFIF payload
      0xFF, 0xC0, 0x00, 0x11, // SOF0, length 17
      0x08, // precision
      0x01, 0x2C, // height = 300 (BE)
      0x02, 0x58, // width = 600 (BE)
      0x03, // component count (rest of SOF0 payload omitted — parser stops reading after width)
    ]
    expect(extractImageDimensions(buf(bytes), 'image/jpeg')).toEqual({ width: 600, height: 300 })
  })

  it('reads width/height from a WebP VP8X (extended) chunk', () => {
    const bytes = [
      0x52, 0x49, 0x46, 0x46, // "RIFF"
      0x00, 0x00, 0x00, 0x00, // file size (unused)
      0x57, 0x45, 0x42, 0x50, // "WEBP"
      0x56, 0x50, 0x38, 0x58, // "VP8X"
      0x0A, 0x00, 0x00, 0x00, // chunk size
      0x00, 0x00, 0x00, 0x00, // flags + reserved
      0xFF, 0x00, 0x00, // canvas width - 1 = 255 → width 256 (3-byte LE)
      0x7F, 0x00, 0x00, // canvas height - 1 = 127 → height 128 (3-byte LE)
    ]
    expect(extractImageDimensions(buf(bytes), 'image/webp')).toEqual({ width: 256, height: 128 })
  })

  it('reads width/height from a WebP VP8 (lossy) chunk', () => {
    const bytes = [
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, // RIFF....WEBP
      0x56, 0x50, 0x38, 0x20, // "VP8 "
      0x00, 0x00, 0x00, 0x00, // chunk size (unused)
      0x00, 0x00, 0x00, // frame tag (unused)
      0x9D, 0x01, 0x2A, // start code
      0x90, 0x01, // width = 400 (14-bit LE, top 2 bits are scale flags = 0)
      0xC8, 0x00, // height = 200 (14-bit LE)
    ]
    expect(extractImageDimensions(buf(bytes), 'image/webp')).toEqual({ width: 400, height: 200 })
  })

  it('reads width/height from a WebP VP8L (lossless) chunk', () => {
    // 14-bit (width-1) then 14-bit (height-1) packed little-endian across 3 bytes,
    // width-1=399 (400), height-1=199 (200): bits = 399 | (199 << 14) = 0x0C_E38F
    const packed = 399 | (199 << 14)
    const bytes = [
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      0x56, 0x50, 0x38, 0x4C, // "VP8L"
      0x00, 0x00, 0x00, 0x00, // chunk size (unused)
      0x2F, // signature
      packed & 0xFF, (packed >> 8) & 0xFF, (packed >> 16) & 0xFF,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // padding — real WebP files always exceed the 30-byte floor
    ]
    expect(extractImageDimensions(buf(bytes), 'image/webp')).toEqual({ width: 400, height: 200 })
  })

  it('returns null for an unrecognized mime type', () => {
    expect(extractImageDimensions(buf([0x00, 0x01, 0x02, 0x03]), 'image/tiff')).toBeNull()
  })

  it('returns null for a truncated/corrupt buffer instead of throwing', () => {
    expect(extractImageDimensions(buf([0x89, 0x50]), 'image/png')).toBeNull()
    expect(extractImageDimensions(buf([]), 'image/jpeg')).toBeNull()
  })

  it('returns null when the PNG signature does not match', () => {
    const bytes = Array.from({ length: 24 }, () => 0)
    expect(extractImageDimensions(buf(bytes), 'image/png')).toBeNull()
  })
})
