<script setup lang="ts">
// "Your addresses" for one hosted site on My hosting: the main address, the customer's own
// domains with their Cloudflare status and the DNS record to add, and connecting,
// checking, switching the main address and removing.
const props = defineProps<{ subscriptionId: string }>()

interface DomainRow {
  hostname: string
  kind: 'custom' | 'platform'
  main: boolean
  live: boolean
  status: string
  sslStatus: string | null
  errors: string[]
}
interface Panel {
  available: boolean
  target: string
  allowed: number | null
  used: number
  domains: DomainRow[]
}

const toast = useToast()
const { data } = await useFetch<Panel>('/api/accounts/hosting/domains', {
  query: { id: props.subscriptionId },
  headers: useRequestHeaders(['cookie']),
})

const newDomain = ref('')
const busy = ref<string | null>(null)
const confirmRemove = ref<string | null>(null)

const canAdd = computed(() => {
  const d = data.value
  if (!d?.available) return false
  return d.allowed === null || d.used < d.allowed
})
const limitNote = computed(() => {
  const d = data.value
  if (!d) return ''
  if (!d.available) return 'Connecting your own domain is coming soon.'
  if (d.allowed === 0) return "Your plan doesn't include your own domain. You can change plan under Billing."
  if (d.allowed !== null && d.used >= d.allowed) return `Your plan includes ${d.allowed} of your own ${d.allowed === 1 ? 'domain' : 'domains'}, and you're using ${d.used === 1 ? 'it' : 'them all'}.`
  return ''
})

async function act(key: string, url: string, method: 'POST' | 'DELETE', body: Record<string, string>, done: string) {
  busy.value = key
  try {
    data.value = await $fetch<Panel>(url, { method, body: { id: props.subscriptionId, ...body } })
    toast.add({ title: done, color: 'success' })
    return true
  }
  catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'Something went wrong'), color: 'error' })
    return false
  }
  finally {
    busy.value = null
  }
}

async function connect() {
  const hostname = newDomain.value.trim()
  if (!hostname) return
  if (await act('add', '/api/accounts/hosting/domains', 'POST', { hostname }, 'Domain added. Now add the DNS record below.')) newDomain.value = ''
}
const check = (h: string) => act(`check:${h}`, '/api/accounts/hosting/domains/check', 'POST', { hostname: h }, 'Status updated')
const makeMain = (h: string) => act(`main:${h}`, '/api/accounts/hosting/domains/primary', 'POST', { hostname: h }, `${h} is now your main address`)
async function remove(h: string) {
  confirmRemove.value = null
  await act(`remove:${h}`, '/api/accounts/hosting/domains', 'DELETE', { hostname: h }, `${h} removed`)
}

function stateOf(d: DomainRow): { label: string; color: 'success' | 'warning' | 'error' | 'neutral' | 'info' } {
  if (d.main) return { label: 'Main address', color: 'info' }
  if (d.live) return { label: 'Working', color: 'success' }
  if (d.errors.length) return { label: 'Needs attention', color: 'warning' }
  return { label: 'Waiting for DNS', color: 'neutral' }
}
</script>

<template>
  <div v-if="data" class="space-y-3">
    <p class="text-sm font-semibold text-gray-900 dark:text-white">Addresses</p>

    <ul class="space-y-2">
      <li v-for="d in data.domains" :key="d.hostname" class="rounded-lg border border-gray-200 dark:border-gray-800 p-3 space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <a :href="`https://${d.hostname}`" target="_blank" class="text-sm font-medium text-gray-900 dark:text-white hover:underline truncate">{{ d.hostname }}</a>
            <UBadge :color="stateOf(d).color" variant="subtle" size="sm">{{ stateOf(d).label }}</UBadge>
          </div>
          <div v-if="!d.main" class="flex flex-wrap gap-1.5">
            <UButton v-if="d.kind === 'custom' && !d.live" size="xs" variant="soft" icon="i-lucide-refresh-cw" :loading="busy === `check:${d.hostname}`" @click="check(d.hostname)">Check now</UButton>
            <UButton v-if="d.live" size="xs" variant="soft" :loading="busy === `main:${d.hostname}`" @click="makeMain(d.hostname)">Make main address</UButton>
            <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" :aria-label="`Remove ${d.hostname}`" :loading="busy === `remove:${d.hostname}`" @click="confirmRemove = d.hostname" />
          </div>
        </div>
        <p v-if="!d.main && d.live && d.kind === 'platform'" class="text-xs text-gray-500">Visitors here are sent to your main address.</p>

        <div v-if="d.kind === 'custom' && !d.live" class="rounded-md bg-gray-50 dark:bg-gray-900 p-3 text-xs text-gray-600 dark:text-gray-300 space-y-2">
          <p>At the company where you bought your domain (its DNS settings), add this record:</p>
          <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono">
            <span class="text-gray-400">Type</span><span>CNAME</span>
            <span class="text-gray-400">Name</span><span class="break-all">{{ d.hostname }}</span>
            <span class="text-gray-400">Target</span><span class="break-all">{{ data.target }}</span>
          </div>
          <p>Some providers want only the first part as the Name (for example <code>www</code>). It can take from a few minutes to a few hours to start working. We'll email you when it does.</p>
          <ul v-if="d.errors.length" class="list-disc pl-4 text-amber-700 dark:text-amber-400">
            <li v-for="e in d.errors" :key="e">{{ e }}</li>
          </ul>
        </div>
      </li>
    </ul>

    <form v-if="canAdd" class="flex flex-wrap gap-2" @submit.prevent="connect">
      <UInput v-model="newDomain" placeholder="www.yourbusiness.co.uk" class="flex-1 min-w-[200px]" aria-label="Your own domain" autocomplete="off" />
      <UButton type="submit" :loading="busy === 'add'" :disabled="!newDomain.trim()">Connect your own domain</UButton>
    </form>
    <p v-else-if="limitNote" class="text-xs text-gray-500">{{ limitNote }}</p>
    <p v-if="canAdd" class="text-xs text-gray-500">
      Tip: connect <strong>www.</strong>yourdomain. A domain without www only works if your DNS provider supports a CNAME at the root (sometimes called ALIAS or CNAME flattening).
    </p>

    <UModal :open="!!confirmRemove" title="Remove this address?" @update:open="(v: boolean) => { if (!v) confirmRemove = null }">
      <template #body>
        <p class="text-sm text-gray-500">{{ confirmRemove }} will stop reaching your site. You can connect it again later.</p>
      </template>
      <template #footer>
        <UButton variant="ghost" @click="confirmRemove = null">Cancel</UButton>
        <UButton color="error" @click="remove(confirmRemove!)">Remove</UButton>
      </template>
    </UModal>
  </div>
</template>
