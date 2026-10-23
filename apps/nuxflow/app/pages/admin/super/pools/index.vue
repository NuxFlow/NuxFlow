<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Pools' })

interface PoolStatus {
  poolId: string | null
  commit: string | null
  release: string | null
  siteCount: number
  lastMigration: string | null
  settingsReceivedAt: string | null
}
interface PoolReport {
  binding: string
  status: PoolStatus | null
  sites: { id: string; name: string; domain: string; status: string }[]
  error: string | null
}
interface PoolsState {
  /** customerSites: sites besides the operator's own still on this Worker; plansWithoutPool: plans whose sign-ups land here. */
  controlPlane: { commit: string | null; release: string | null; siteCount: number; customerSites: number; plansWithoutPool: number }
  pools: PoolReport[]
  newestRelease: string | null
  /** Addresses the front-door router sends to each pool, by pool id. */
  routed: Record<string, number>
}
interface DirectorySyncResult {
  routed: number
  added: string[]
  removed: string[]
  conflicts: { hostname: string; reason: string }[]
  unreachable: string[]
}

const { data, error, refresh, status } = await useFetch<PoolsState>('/api/v1/admin/pools')
const { run, isRunning } = useAdminAction()

// Customer sites on the control panel share its Worker with sign-in and billing, so every
// release for them also updates those (docs/pools.md → "Keep customer sites apart").
const splitAdvice = computed(() => {
  const cp = data.value?.controlPlane
  if (!cp) return ''
  const parts: string[] = []
  if (cp.customerSites) parts.push(`${cp.customerSites} customer ${cp.customerSites === 1 ? 'site runs' : 'sites run'} on this control panel. Move ${cp.customerSites === 1 ? 'it' : 'them'} into a pool with Super Admin → Sites → Move.`)
  if (cp.plansWithoutPool) parts.push(`${cp.plansWithoutPool} ${cp.plansWithoutPool === 1 ? 'plan puts' : 'plans put'} new sign-ups here. Set "Sign-ups get their site in" in Super Admin → Plans.`)
  return [...parts, 'Then a release for customer sites never touches sign-in or billing.'].join(' ')
})

function version(release: string | null, commit: string | null): string {
  if (!commit) return 'Not recorded (deployed without the release scripts)'
  return release ? `${release}, commit ${commit.slice(0, 7)}` : `commit ${commit.slice(0, 7)}`
}

function releaseBadge(release: string | null): { label: string; color: 'success' | 'warning' | 'neutral' } {
  if (!release || !data.value?.newestRelease) return { label: 'Version unknown', color: 'neutral' }
  return release === data.value.newestRelease
    ? { label: 'Newest release', color: 'success' }
    : { label: 'Older release', color: 'warning' }
}

async function sendSettings() {
  await run(async () => {
    const { results } = await $fetch<{ results: { binding: string; ok: boolean; error: string | null }[] }>('/api/v1/admin/pools/settings', { method: 'POST' })
    await refresh()
    const failed = results.filter(r => !r.ok)
    if (failed.length) throw new Error(failed.map(r => `${r.binding}: ${r.error}`).join('; '))
    return results.length
  }, {
    successTitle: (n: number) => `Platform settings sent to ${n} pool${n === 1 ? '' : 's'}`,
    errorTitle: 'Couldn\'t send to every pool',
    key: 'send',
  })
}

// Problems from the last "Update routing", shown until the next one.
const routingProblems = ref<string[]>([])

async function updateRouting() {
  await run(async () => {
    const result = await $fetch<DirectorySyncResult>('/api/v1/admin/pools/directory', { method: 'POST' })
    await refresh()
    routingProblems.value = [
      ...result.conflicts.map(c => `${c.hostname}: ${c.reason}`),
      ...result.unreachable.map(b => `${b} didn't answer, so its addresses were left as they were`),
    ]
    return result
  }, {
    successTitle: (r: DirectorySyncResult) => `Routing updated: ${r.routed} address${r.routed === 1 ? '' : 'es'} go to pools`
      + (r.added.length || r.removed.length ? ` (${r.added.length} added, ${r.removed.length} removed)` : ''),
    errorTitle: 'Couldn\'t update routing',
    key: 'routing',
  })
}

const bindingExample = `[[services]]
binding = "POOL_CLIENTX"
service = "nuxflow-pool-clientx"
entrypoint = "NuxflowPoolAdmin"`
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Pools</h1>
        <p class="text-sm text-gray-500 mt-0.5">Groups of sites on their own Worker and database, run from this control panel</p>
      </div>
      <div class="flex gap-2">
        <UButton variant="ghost" icon="i-lucide-refresh-cw" :loading="status === 'pending'" @click="refresh()">Refresh</UButton>
        <UButton
          variant="outline"
          icon="i-lucide-route"
          :loading="isRunning('routing')"
          :disabled="!data?.pools.length"
          @click="updateRouting"
        >
          Update routing
        </UButton>
        <UButton
          icon="i-lucide-send"
          :loading="isRunning('send')"
          :disabled="!data?.pools.length"
          @click="sendSettings"
        >
          Send platform settings
        </UButton>
      </div>
    </div>

    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" :description="getErrorMessage(error, 'Could not load pools')" />

    <UAlert
      v-if="data?.pools.length && (data.controlPlane.customerSites || data.controlPlane.plansWithoutPool)"
      color="info"
      variant="soft"
      icon="i-lucide-shield"
      title="Keep customer sites apart from sign-in and billing"
      :description="splitAdvice"
    />

    <template v-else-if="data">
      <UAlert
        v-if="routingProblems.length"
        color="warning"
        variant="soft"
        icon="i-lucide-triangle-alert"
        title="Some addresses weren't routed"
      >
        <template #description>
          <ul class="list-disc pl-5 space-y-1">
            <li v-for="problem in routingProblems" :key="problem">{{ problem }}</li>
          </ul>
        </template>
      </UAlert>

      <UCard>
        <div class="flex items-start justify-between gap-4 text-sm">
          <div class="space-y-1">
            <h2 class="font-semibold text-gray-900 dark:text-white">This control panel</h2>
            <p class="text-gray-500">Accounts, billing, plans and platform settings for every pool. Its own sites: {{ data.controlPlane.siteCount }}.</p>
            <p class="text-gray-500">Version: {{ version(data.controlPlane.release, data.controlPlane.commit) }}</p>
          </div>
          <UBadge v-if="data.controlPlane.release" :color="releaseBadge(data.controlPlane.release).color" variant="subtle">
            {{ releaseBadge(data.controlPlane.release).label }}
          </UBadge>
        </div>
      </UCard>

      <UCard v-if="!data.pools.length">
        <div class="space-y-3 text-sm">
          <h2 class="font-semibold text-gray-900 dark:text-white">No pools connected yet</h2>
          <p class="text-gray-500">To add one:</p>
          <ol class="list-decimal pl-5 space-y-2 text-gray-600 dark:text-gray-300">
            <li>Run <code>pnpm pool:create &lt;name&gt; --from &lt;this Worker's wrangler config&gt;</code>. It creates the pool and prints the next step.</li>
            <li>Add the pool to this Worker's wrangler config (the command prints it with your pool's name):</li>
          </ol>
          <pre class="text-xs bg-gray-50 dark:bg-gray-900 rounded p-3 overflow-x-auto">{{ bindingExample }}</pre>
          <ol start="3" class="list-decimal pl-5 space-y-2 text-gray-600 dark:text-gray-300">
            <li>Deploy this Worker.</li>
            <li>Come back here and press <strong>Send platform settings</strong>.</li>
          </ol>
        </div>
      </UCard>

      <UCard v-for="pool in data.pools" :key="pool.binding">
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <div>
              <h2 class="font-semibold text-gray-900 dark:text-white">{{ pool.status?.poolId ?? pool.binding }}</h2>
              <p class="text-xs text-gray-400 font-mono">{{ pool.binding }}</p>
            </div>
            <UBadge v-if="pool.error" color="error" variant="subtle">Can't reach it</UBadge>
            <UBadge v-else :color="releaseBadge(pool.status?.release ?? null).color" variant="subtle">
              {{ releaseBadge(pool.status?.release ?? null).label }}
            </UBadge>
          </div>
        </template>

        <UAlert v-if="pool.error" color="error" variant="soft" icon="i-lucide-circle-alert" :description="pool.error" />

        <div v-else-if="pool.status" class="space-y-4 text-sm">
          <dl class="grid sm:grid-cols-2 gap-x-6 gap-y-2">
            <div>
              <dt class="text-gray-400">Version</dt>
              <dd class="text-gray-700 dark:text-gray-200">{{ version(pool.status.release, pool.status.commit) }}</dd>
            </div>
            <div>
              <dt class="text-gray-400">Database</dt>
              <dd class="text-gray-700 dark:text-gray-200 font-mono text-xs">{{ pool.status.lastMigration ?? 'Not set up yet' }}</dd>
            </div>
            <div>
              <dt class="text-gray-400">Platform settings</dt>
              <dd :class="pool.status.settingsReceivedAt ? 'text-gray-700 dark:text-gray-200' : 'text-amber-600'">
                {{ pool.status.settingsReceivedAt ? `Received ${formatLocalDateTime(pool.status.settingsReceivedAt)}` : 'Never received: press Send platform settings' }}
              </dd>
            </div>
            <div>
              <dt class="text-gray-400">Sites</dt>
              <dd class="text-gray-700 dark:text-gray-200">{{ pool.status.siteCount }}</dd>
            </div>
            <div>
              <dt class="text-gray-400">Addresses routed here</dt>
              <dd class="text-gray-700 dark:text-gray-200">
                {{ data.routed[pool.status.poolId ?? ''] ?? 0 }}
                <span v-if="pool.status.siteCount && !data.routed[pool.status.poolId ?? '']" class="text-amber-600">: press Update routing</span>
              </dd>
            </div>
          </dl>

          <ul v-if="pool.sites.length" class="divide-y divide-gray-100 dark:divide-gray-800 border-t border-gray-100 dark:border-gray-800">
            <li v-for="site in pool.sites" :key="site.id" class="flex items-center justify-between gap-3 py-2">
              <span class="text-gray-700 dark:text-gray-200">{{ site.name }} <span class="text-gray-400">· {{ site.domain }}</span></span>
              <UBadge v-if="site.status !== 'active'" color="warning" variant="subtle">{{ site.status }}</UBadge>
            </li>
          </ul>
          <p v-else class="text-gray-400">No sites in this pool yet.</p>
        </div>
      </UCard>
    </template>
  </div>
</template>
