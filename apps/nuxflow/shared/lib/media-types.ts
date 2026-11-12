// Media shapes the server sends and the admin reads. Import-free, so both sides use the
// same definition instead of each keeping a copy.

/** Camera details read from a JPEG on upload (server/utils/exif.ts), kept in `media.metadata.exif`. */
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

/** A Cloudflare Stream video in the media library, as GET /api/v1/media/video lists it. */
export interface VideoAsset {
  id: string
  title: string
  cloudflareStreamId: string
  duration: number | null
  thumbnailUrl: string | null
  status: 'uploading' | 'processing' | 'ready' | 'failed'
  size: number | null
  createdAt: string
  isPrivate: boolean
  playbackUrl: string
}
