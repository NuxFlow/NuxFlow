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

/** A file in the media library, as GET /api/v1/media lists it. */
export interface MediaItem {
  id: string
  originalName: string
  mimeType: string
  size: number
  url: string
  altText: string | null
  caption: string | null
  folderId: string | null
  width: number | null
  height: number | null
  focalX: number | null
  focalY: number | null
  metadata?: { exif?: ExifData } | null
  createdAt: string
}

/** A media library folder, with how many files it holds (GET /api/v1/media/folders). */
export interface MediaFolder {
  id: string
  name: string
  fileCount: number
}

export interface MediaFoldersResponse {
  folders: MediaFolder[]
  /** Files in no folder. */
  unfolderedCount: number
}

/** POST /api/v1/ai/bulk-alt-text: one batch of alt text written by AI. */
export interface BulkAltTextResult {
  processed: number
  skipped: number
  updated: { id: string; altText: string }[]
  /** Ids of images the model couldn't describe. */
  failed: string[]
  /** More images without alt text are waiting: send another batch. */
  hasMore: boolean
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
