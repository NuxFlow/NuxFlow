self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data?.json() ?? {} } catch { /* ignore malformed payloads */ }

  const title = data.title ?? 'New notification'
  const options = {
    body: data.body ?? '',
    icon: data.icon ?? '/favicon.svg',
    badge: '/favicon.svg',
    data: { url: data.url ?? '/' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // Payload URLs are usually site-relative ("/blog/post"); window clients report absolute
  // ones, so resolve before comparing or an already-open tab is never reused.
  const url = new URL(event.notification.data?.url ?? '/', self.location.origin).href

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) return client.focus()
      }
      return clients.openWindow(url)
    }),
  )
})

// Browsers can replace a subscription on their own (expiry, push-service key rotation).
// Without this the site kept the dead endpoint and the visitor silently stopped getting
// notifications. Best-effort: if the visitor's session has ended, the POST is refused and
// the toggle under My account shows them as unsubscribed.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const old = event.oldSubscription
    const sub = event.newSubscription
      ?? (old?.options ? await self.registration.pushManager.subscribe(old.options) : null)
    if (!sub) return
    const keys = sub.toJSON().keys ?? {}
    const send = (method, path, body) => fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    await send('POST', '/api/v1/push/subscribe', { endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth })
    if (old && old.endpoint !== sub.endpoint) {
      await send('DELETE', '/api/v1/push/unsubscribe', { endpoint: old.endpoint })
    }
  })().catch(() => { /* nothing useful to do from a service worker */ }))
})
