/**
 * Owns the Cloudflare Stream upload flow used by media/videos.vue: ask the backend to start
 * a resumable upload (which also adds the video to the library as 'uploading'), send the
 * file to Stream in chunks (useVideoUploadXhr), then tell NuxFlow it's finished so the
 * caller's poller can follow processing. Extracted from videos.vue so the upload state
 * machine (progress/status/quota-error) is independently testable and separate from the
 * page's grid/modal orchestration.
 *
 * Not built on useAdminAction(): a 402 (no Stream minutes) or 403 (the plan's video
 * minutes) is shown inline as `streamError` instead of a toast, and progress/status need
 * their own state.
 */
export function useVideoUpload(onUploaded?: () => Promise<void> | void) {
  const toast = useToast()
  const { uploadFileViaTus } = useVideoUploadXhr()

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
      // 1. The backend starts a resumable upload in the site's Stream account and returns
      //    the address to send the file to. The browser never sees the Stream token.
      const { uploadUrl, uid } = await $fetch<{ id: string; uid: string; uploadUrl: string }>('/api/v1/media/video/token', {
        method: 'POST',
        body: { title: file.name, size: file.size },
      })

      statusText.value = 'Uploading to Cloudflare Stream...'

      // 2. Send it in chunks; a dropped connection picks up where it stopped.
      await uploadFileViaTus(uploadUrl, file, (p) => {
        progress.value = p.percent
        statusText.value = `Uploading: ${p.percent}% (${formatBytes(p.loaded)} of ${formatBytes(p.total)})`
      })

      // 3. Tell NuxFlow it's finished and let the caller's poller sync processing status.
      statusText.value = 'Registering video with library...'
      await $fetch<unknown>('/api/v1/media/video', {
        method: 'POST',
        body: { uid, size: file.size },
      })
      toast.add({ title: 'Video uploaded!', color: 'success', description: 'Cloudflare Stream is now processing the file.' })
      await onUploaded?.()
    }
    catch (err: unknown) {
      console.error('Video upload failed:', err)
      const status = (err as { status?: number })?.status
      const errorMsg = getErrorMessage(err, 'Verify your Cloudflare Stream settings.')
      if (status === 402 || status === 403) {
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
