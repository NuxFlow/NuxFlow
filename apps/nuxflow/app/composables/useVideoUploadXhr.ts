export interface VideoUploadProgress {
  loaded: number
  total: number
  /** Rounded 0-100. */
  percent: number
}

// Cloudflare Stream's tus rules: every chunk but the last a multiple of 256 KiB, between
// 5 MiB and 200 MiB. 50 MiB is what Cloudflare recommends for ordinary connections.
export const TUS_CHUNK_BYTES = 50 * 1024 * 1024
// Waits before each retry of a failed chunk; after the last, the upload gives up.
const RETRY_DELAYS_MS = [1_000, 3_000, 10_000, 30_000, 60_000]

function request(method: 'HEAD' | 'PATCH', url: string, opts: { offset?: number; body?: Blob; onProgress?: (sent: number) => void }): Promise<XMLHttpRequest> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    if (opts.onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) opts.onProgress!(e.loaded)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr)
      else reject(Object.assign(new Error(`Upload failed (${xhr.status}): ${xhr.statusText || 'unknown error'}`), { status: xhr.status }))
    }
    xhr.onerror = () => reject(new Error('Network error during upload — check your connection and try again.'))
    xhr.onabort = () => reject(Object.assign(new Error('Upload was cancelled.'), { aborted: true }))
    xhr.open(method, url)
    xhr.setRequestHeader('Tus-Resumable', '1.0.0')
    if (method === 'PATCH') {
      xhr.setRequestHeader('Upload-Offset', String(opts.offset ?? 0))
      xhr.setRequestHeader('Content-Type', 'application/offset+octet-stream')
    }
    xhr.send(opts.body ?? null)
  })
}

function serverOffset(xhr: XMLHttpRequest): number {
  const value = Number(xhr.getResponseHeader('Upload-Offset'))
  if (!Number.isFinite(value) || value < 0) throw new Error('Cloudflare Stream sent an unexpected reply during the upload.')
  return value
}

/**
 * The browser half of a Cloudflare Stream resumable (tus) upload (useVideoUpload, consumed
 * by media/videos.vue): the file goes straight to the upload URL the server created
 * (api/v1/media/video/token.post.ts), in chunks, so there's no 200 MB ceiling and a
 * dropped connection carries on where it stopped — after a failure it asks Stream how much
 * arrived (HEAD) and resumes from there. A plain `XMLHttpRequest` is used for its upload
 * progress events, which `$fetch` doesn't have.
 */
export function useVideoUploadXhr() {
  async function uploadFileViaTus(
    url: string,
    file: Blob,
    onProgress?: (progress: VideoUploadProgress) => void,
    wait: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
  ): Promise<void> {
    const total = file.size
    const report = (loaded: number) => onProgress?.({ loaded, total, percent: total ? Math.round((loaded / total) * 100) : 100 })
    let offset = 0
    let failures = 0
    report(0)

    while (offset < total) {
      const end = Math.min(offset + TUS_CHUNK_BYTES, total)
      try {
        const xhr = await request('PATCH', url, { offset, body: file.slice(offset, end), onProgress: sent => report(offset + sent) })
        offset = serverOffset(xhr)
        failures = 0
        report(offset)
      } catch (err) {
        const status = (err as { status?: number }).status
        // Cancelled, or a refusal retrying can't fix (the upload expired, is over its limits…).
        if ((err as { aborted?: boolean }).aborted || (status && status >= 400 && status < 500 && status !== 409 && status !== 429)) throw err
        const delay = RETRY_DELAYS_MS[failures++]
        if (delay === undefined) throw err
        await wait(delay)
        try {
          offset = serverOffset(await request('HEAD', url, {}))
          report(offset)
        } catch {
          // Still offline — the next PATCH attempt will fail and wait again.
        }
      }
    }
  }

  return { uploadFileViaTus }
}
