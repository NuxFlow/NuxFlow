/**
 * Owns the Cloudflare Stream upload flow used by media/videos.vue: get a direct-upload
 * URL, stream the file via XHR (for progress events, via useVideoUploadXhr), then
 * register the resulting video in NuxFlow. Extracted from videos.vue so the upload
 * state machine (progress/status/quota-error) is independently testable and separate
 * from the page's grid/modal orchestration.
 */
export function useVideoUpload(onUploaded?: () => Promise<void> | void) {
  const toast = useToast()
  const { uploadFileViaXhr } = useVideoUploadXhr()

  const uploading = ref(false)
  const progress = ref(0)
  const statusText = ref('')
  const streamError = ref<string | null>(null)

  async function upload(file: File) {
    uploading.value = true
    progress.value = 0
    statusText.value = 'Preparing upload...'
    streamError.value = null

    try {
      // 1. Get a pre-authorised upload.cloudflarestream.com URL from the backend.
      //    TUS cannot be used from the browser: the authenticated CF TUS endpoint has no
      //    CORS headers, and the direct_upload URL doesn't implement TUS properly.
      //    A plain XHR POST to the direct_upload URL is the correct approach.
      const { uploadUrl, uid } = await $fetch<{ uploadUrl: string; uid: string }>('/api/v1/media/video/token', {
        method: 'POST',
        body: { title: file.name },
      })

      statusText.value = 'Uploading to Cloudflare Stream...'

      // 2. Upload via XHR so we get upload progress events.
      await uploadFileViaXhr(uploadUrl, file, (p) => {
        progress.value = p.percent
        statusText.value = `Uploading: ${p.percent}% (${formatBytes(p.loaded)} of ${formatBytes(p.total)})`
      })

      // 3. Register the video in NuxFlow and let the caller's poller sync processing status.
      statusText.value = 'Registering video with library...'
      await $fetch('/api/v1/media/video', {
        method: 'POST',
        body: { uid, title: file.name.replace(/\.[^/.]+$/, ''), size: file.size },
      })
      toast.add({ title: 'Video uploaded!', color: 'success', description: 'Cloudflare Stream is now processing the file.' })
      await onUploaded?.()
    }
    catch (err: unknown) {
      console.error('Video upload failed:', err)
      const status = (err as { status?: number })?.status
      const errorMsg = getErrorMessage(err, 'Verify your Cloudflare Stream settings.')
      if (status === 402) {
        streamError.value = errorMsg
      }
      else {
        toast.add({ title: 'Upload failed', color: 'error', description: errorMsg })
      }
    }
    finally {
      uploading.value = false
    }
  }

  return { uploading, progress, statusText, streamError, upload }
}
