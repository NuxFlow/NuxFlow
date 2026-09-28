import type { SiteBranding } from '~/types/accounts'

/**
 * On the accounts origin, the site named by `?site=` (the one being signed in to or
 * registered with), for branding the page. Null elsewhere or when there's no `site`.
 */
export async function useAccountsSite() {
  const route = useRoute()
  const { isAccountsHost } = useAccounts()
  const siteId = computed(() => (isAccountsHost && typeof route.query.site === 'string') ? route.query.site : '')
  const { data } = await useFetch<SiteBranding | null>('/api/accounts/site', {
    query: { site: siteId },
    immediate: Boolean(siteId.value),
    default: () => null,
  })
  return { siteId, site: computed(() => (siteId.value ? data.value : null)) }
}
