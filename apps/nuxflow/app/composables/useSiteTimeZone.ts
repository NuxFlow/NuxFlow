import type { PublicSite } from '#shared/lib/public-site-types'

/**
 * The site's time zone (Settings → General), which every event and publish date is
 * entered and shown in. Await it before converting a stored date for a form.
 */
export async function useSiteTimeZone() {
  const { data } = await useFetch<PublicSite>('/api/public/site', {
    key: 'nuxflow-public-site',
    headers: useRequestHeaders(['host']),
  })
  return computed(() => data.value?.timezone || 'UTC')
}
