export interface VideoUploadProgress {
  loaded: number
  total: number
  /** Rounded 0-100. */
  percent: number
}

/**
 * Raw XHR upload used specifically for the Cloudflare Stream direct-upload flow
 * (media/videos.vue) — `$fetch`/`ofetch` has no upload-progress event, so a plain
 * `XMLHttpRequest` is used instead purely to get `xhr.upload.onprogress`. Kept as its
 * own composable (rather than folded into a generic fetch helper) since this progress
 * requirement is the only reason it isn't just `$fetch`.
 */
export function useVideoUploadXhr() {
  function uploadFileViaXhr(url: string, file: File, onProgress?: (progress: VideoUploadProgress) => void): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress?.({ loaded: e.loaded, total: e.total, percent: Math.round((e.loaded / e.total) * 100) })
        }
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve()
        else reject(new Error(`Upload failed (${xhr.status}): ${xhr.statusText || 'unknown error'}`))
      }
      xhr.onerror = () => reject(new Error('Network error during upload — check your connection and try again.'))
      xhr.onabort = () => reject(new Error('Upload was cancelled.'))
      xhr.open('POST', url)
      const form = new FormData()
      form.append('file', file)
      xhr.send(form)
    })
  }

  return { uploadFileViaXhr }
}
