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

// ── Moving database-stored media to real storage (server/utils/media-migration.ts)

/** GET /api/v1/media/migration: what's still in the database, and whether it can move. */
export interface MigrationStatus {
  provider: string
  /** True for binding-only R2: media is served through this Worker at /_nuxflow/media/. */
  servedByWorker: boolean
  canMigrate: boolean
  pendingMedia: number
  pendingMediaBytes: number
  /** Images embedded in content and settings as `data:` URLs. */
  pendingInline: number
}

export interface MigrationItemResult {
  id: string
  ok: boolean
  error?: string
  newUrl?: string
}

/** POST /api/v1/media/migration: one batch moved. */
export interface MigrationBatchResult {
  results: MigrationItemResult[]
  /** Pass back as `cursor` for the next batch. */
  nextCursor: string | null
  /** True once this phase has nothing left to do. */
  done: boolean
}
