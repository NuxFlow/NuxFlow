import { base64ToBytes as fromBase64Url } from '#shared/lib/base64'

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.length) return false
  const view = new Uint8Array(a)
  return view.every((byte, i) => byte === b[i])
}

/** This browser's push subscription for the site, if it has one. */
async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration('/')
  return (await reg?.pushManager.getSubscription()) ?? null
}

export function usePushNotifications() {
  const isSupported = computed(() =>
    import.meta.client && 'serviceWorker' in navigator && 'PushManager' in window,
  )

  const permission = ref<NotificationPermission>('default')
  const isSubscribed = ref(false)
  const isLoading = ref(false)
  /** Why the last subscribe/unsubscribe didn't work, for the UI to show; null when it did. */
  const error = ref<string | null>(null)

  if (import.meta.client) {
    permission.value = Notification.permission
  }

  // Per browser, not per account: subscribed means this browser has a subscription *and*
  // the site still has it on file (regenerating the site's keys drops every row).
  async function refreshStatus() {
    if (!isSupported.value) return
    try {
      const sub = await currentSubscription()
      if (!sub) {
        isSubscribed.value = false
        return
      }
      const { subscribed } = await $fetch<{ subscribed: boolean }>('/api/v1/push/status', { query: { endpoint: sub.endpoint } })
      isSubscribed.value = subscribed
    } catch { /* not logged in or push not configured */ }
  }

  async function ensureServiceWorker(): Promise<ServiceWorkerRegistration> {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    await navigator.serviceWorker.ready
    return reg
  }

  async function subscribe(): Promise<boolean> {
    if (!isSupported.value || isLoading.value) return false
    isLoading.value = true
    error.value = null
    try {
      const result = await Notification.requestPermission()
      permission.value = result
      if (result !== 'granted') {
        if (result === 'denied') error.value = 'Notifications are blocked for this site in your browser settings.'
        return false
      }

      const { publicKey } = await $fetch<{ publicKey: string | null }>('/api/v1/push/vapid-public-key')
      if (!publicKey) {
        error.value = "Push notifications aren't set up on this site yet."
        return false
      }

      const applicationServerKey = fromBase64Url(publicKey)
      const reg = await ensureServiceWorker()
      // A browser keeps one subscription per site, tied to the key it was made with, and
      // subscribe() with a different key throws. After an admin regenerates the site's
      // keys, drop the old one first or the switch can never be turned back on.
      const existing = await reg.pushManager.getSubscription()
      if (existing && !sameKey(existing.options.applicationServerKey, applicationServerKey)) {
        await existing.unsubscribe()
      }
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      })

      const keys = subscription.toJSON().keys ?? {}
      await $fetch('/api/v1/push/subscribe', {
        method: 'POST',
        body: {
          endpoint: subscription.endpoint,
          p256dh: keys.p256dh ?? '',
          auth: keys.auth ?? '',
        },
      })

      isSubscribed.value = true
      return true
    } catch (err) {
      console.error('[push] Subscribe failed:', err)
      error.value = getErrorMessage(err, "Couldn't turn on notifications. Please try again.")
      return false
    } finally {
      isLoading.value = false
    }
  }

  async function unsubscribe(): Promise<void> {
    if (!isSupported.value || isLoading.value) return
    isLoading.value = true
    error.value = null
    try {
      const sub = await currentSubscription()

      if (sub) {
        await $fetch('/api/v1/push/unsubscribe', {
          method: 'DELETE',
          body: { endpoint: sub.endpoint },
        })
        await sub.unsubscribe()
      }

      isSubscribed.value = false
    } catch (err) {
      console.error('[push] Unsubscribe failed:', err)
      error.value = getErrorMessage(err, "Couldn't turn off notifications. Please try again.")
    } finally {
      isLoading.value = false
    }
  }

  return { isSupported, permission, isSubscribed, isLoading, error, subscribe, unsubscribe, refreshStatus }
}
