export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('error', (error, { event }) => {
    const statusCode = error.statusCode ?? 500

    // 4xx errors are expected client mistakes — don't pollute the log stream
    if (statusCode < 500) return

    const url = event ? getRequestURL(event).toString() : 'unknown'
    const method = event ? getMethod(event) : 'unknown'
    const country = event ? (getRequestHeader(event, 'cf-ipcountry') ?? '-') : '-'
    const ray = event ? (getRequestHeader(event, 'cf-ray') ?? '-') : '-'

    console.error(JSON.stringify({
      level: 'error',
      source: 'nuxflow',
      statusCode,
      method,
      url,
      country,
      cfRay: ray,
      message: error.message,
      stack: error.stack,
      ts: new Date().toISOString(),
    }))
  })
})
