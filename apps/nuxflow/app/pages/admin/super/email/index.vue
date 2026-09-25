<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Email' })

interface SiteUsage {
  siteId: string | null
  siteName: string | null
  domain: string | null
  sent30d: number
  failed30d: number
  sent24h: number
  cloudflare30d: number
}
interface Failure {
  id: string
  siteName: string | null
  toAddress: string
  subject: string
  category: string
  provider: string
  error: string | null
  createdAt: string
}
interface EmailUsage {
  sites: SiteUsage[]
  recentFailures: Failure[]
  sendingBindingPresent: boolean
  inboundEmailDomain: string | null
}

const { data, pending, error, refresh } = await useFetch<EmailUsage>('/api/v1/admin/email-usage')

const totals = computed(() => (data.value?.sites ?? []).reduce(
  (t, s) => ({ sent: t.sent + s.sent30d, failed: t.failed + s.failed30d, cloudflare: t.cloudflare + s.cloudflare30d }),
  { sent: 0, failed: 0, cloudflare: 0 },
))

const columns = [
  { accessorKey: 'siteName', header: 'Site' },
  { accessorKey: 'sent24h', header: 'Sent (24h)' },
  { accessorKey: 'sent30d', header: 'Sent (30d)' },
  { accessorKey: 'cloudflare30d', header: 'Via Cloudflare (30d)' },
  { accessorKey: 'failed30d', header: 'Failed (30d)' },
]
</script>

<template>
  <div class="max-w-5xl mx-auto space-y-6">
    <div class="flex items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Email</h1>
        <p class="text-sm text-gray-500 mt-0.5">Outbound email across every site, from NuxFlow's own send log</p>
      </div>
      <UButton variant="ghost" icon="i-lucide-refresh-cw" :loading="pending" @click="() => refresh()">Refresh</UButton>
    </div>

    <UAlert v-if="error" color="error" variant="soft" icon="i-lucide-circle-alert" :description="getErrorMessage(error, 'Could not load email usage')" />

    <template v-else-if="data">
      <div class="grid gap-4 sm:grid-cols-3">
        <UCard>
          <p class="text-xs text-gray-500">Sent, last 30 days</p>
          <p class="text-2xl font-semibold text-gray-900 dark:text-white mt-1">{{ totals.sent.toLocaleString() }}</p>
        </UCard>
        <UCard>
          <p class="text-xs text-gray-500">Through Cloudflare Email</p>
          <p class="text-2xl font-semibold text-gray-900 dark:text-white mt-1">{{ totals.cloudflare.toLocaleString() }}</p>
          <p class="text-xs text-gray-400 mt-1">3,000/month included per account, then $0.35 per 1,000</p>
        </UCard>
        <UCard>
          <p class="text-xs text-gray-500">Failed, last 30 days</p>
          <p class="text-2xl font-semibold mt-1" :class="totals.failed ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'">{{ totals.failed.toLocaleString() }}</p>
        </UCard>
      </div>

      <UAlert
        color="info"
        variant="soft"
        icon="i-lucide-info"
        description="Cloudflare's sending quota and daily limit are per Cloudflare account — shared by every site on this deployment. These counts are what NuxFlow attempted; Cloudflare's own figures are under Email Service → Analytics in the dashboard. Cloudflare Email is for transactional mail only (no newsletters or bulk sends)."
      />
      <UAlert
        v-if="!data.sendingBindingPresent"
        color="warning"
        variant="soft"
        icon="i-lucide-triangle-alert"
        description="No send_email binding named EMAIL is present, so sites set to the Cloudflare provider can't send. Add [[send_email]] name = &quot;EMAIL&quot; to wrangler.toml and redeploy."
      />

      <UCard>
        <template #header><p class="text-sm font-semibold text-gray-900 dark:text-white">By site</p></template>
        <UTable :data="data.sites" :columns="columns">
          <template #siteName-cell="{ row }">
            <p class="font-medium">{{ row.original.siteName ?? 'Deleted site' }}</p>
            <p class="text-xs text-gray-400">{{ row.original.domain }}</p>
          </template>
          <template #failed30d-cell="{ row }">
            <span :class="row.original.failed30d ? 'text-red-600 dark:text-red-400 font-medium' : ''">{{ row.original.failed30d }}</span>
          </template>
        </UTable>
        <p v-if="!data.sites.length" class="text-sm text-gray-400 py-4">No email sent in the last 30 days.</p>
      </UCard>

      <UCard>
        <template #header><p class="text-sm font-semibold text-gray-900 dark:text-white">Recent failures</p></template>
        <p v-if="!data.recentFailures.length" class="text-sm text-gray-400">None in the last 30 days.</p>
        <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
          <li v-for="f in data.recentFailures" :key="f.id" class="py-3 space-y-1">
            <div class="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <p class="font-medium text-gray-900 dark:text-white break-all">{{ f.subject }}</p>
              <span class="text-xs text-gray-400">{{ parseDbDate(f.createdAt).toLocaleString() }}</span>
            </div>
            <p class="text-xs text-gray-500 break-all">{{ f.siteName ?? 'Deleted site' }} · {{ f.category }} · {{ f.provider }} · to {{ f.toAddress }}</p>
            <p class="text-xs text-red-600 dark:text-red-400 break-words">{{ f.error }}</p>
          </li>
        </ul>
      </UCard>
    </template>
  </div>
</template>
