import { baselineSecurityHeaders } from '../utils/security-headers'

// Runs after 03.accounts-routing.ts (alphabetical within the 03 group), so the accounts
// origin's stricter headers are already set and are left alone; and before the page cache
// (07), so cached HITs carry these too. See utils/security-headers.ts.
export default defineEventHandler((event) => {
  const url = getRequestURL(event)
  const headers = baselineSecurityHeaders(
    url.pathname,
    name => getResponseHeader(event, name),
    { https: url.protocol === 'https:' },
  )
  setResponseHeaders(event, headers)
})
