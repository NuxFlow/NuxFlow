<script setup lang="ts">
const { form, saving, save } = inject(SEO_FORM_KEY)!

interface CrawlerRow { bot: string; category: string; hits: number; lastSeenAt: string; lastPath: string | null; blocked: boolean }
interface RegistryRow { token: string; owner: string; category: string; legacy: boolean; blocked: boolean }

const days = ref(30)
const { data: activity, pending: activityPending, refresh: refreshActivity } = await useFetch<{
  days: number
  bots: CrawlerRow[]
  registry: RegistryRow[]
}>('/api/v1/seo/crawlers', { query: { days } })

const modes = [
  {
    value: 'allow',
    label: 'Allow all AI crawlers',
    description: 'Training, AI search, and live assistant fetches are all allowed.',
  },
  {
    value: 'block-training',
    label: 'Block AI training, allow AI search (recommended)',
    description: 'Model-training crawlers (GPTBot, ClaudeBot, Google-Extended, CCBot…) are blocked; AI search and answer crawlers (OAI-SearchBot, Claude-SearchBot, PerplexityBot, ChatGPT-User…) can still read and cite your pages.',
  },
  {
    value: 'disallow',
    label: 'Block all AI crawlers',
    description: 'Also blocks AI search and assistant fetches — the site won\'t be cited in ChatGPT, Claude, or Perplexity answers. llms.txt and Markdown alternates are turned off.',
  },
] as const

// Mirrors contentSignal() in server/utils/seo.ts.
const contentSignal = computed(() => {
  if (form.robots === 'noindex') return 'search=no, ai-input=no, ai-train=no'
  if (form.aiCrawlers === 'disallow') return 'search=yes, ai-input=no, ai-train=no'
  if (form.aiCrawlers === 'block-training') return 'search=yes, ai-input=yes, ai-train=no'
  return 'search=yes, ai-input=yes, ai-train=yes'
})

const CATEGORY_LABELS: Record<string, string> = {
  'ai-training': 'AI training',
  'ai-search': 'AI search',
  'ai-user': 'AI assistant (live fetch)',
  'search': 'Search engine',
}

// Which bots the *unsaved* selection would block — the registry's `blocked` reflects saved settings.
function wouldBlock(category: string): boolean {
  if (form.aiCrawlers === 'allow' || category === 'search') return false
  if (form.aiCrawlers === 'block-training') return category === 'ai-training'
  return true
}

const registryByCategory = computed(() => {
  const groups: Record<string, RegistryRow[]> = {}
  for (const r of activity.value?.registry ?? []) {
    if (r.category === 'search') continue
    ;(groups[r.category] ??= []).push(r)
  }
  return groups
})

const totalHits = computed(() => (activity.value?.bots ?? []).reduce((n, b) => n + b.hits, 0))

function formatDate(d: string) {
  const iso = d.includes('T') ? d : `${d.replace(' ', 'T')}Z`
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
</script>

<template>
  <UCard>
    <template #header>
      <p class="text-sm font-semibold text-gray-900 dark:text-white">AI crawler access (GEO)</p>
      <p class="text-xs text-gray-400 mt-0.5">Generative Engine Optimization — whether AI assistants can learn from, search, and cite this site</p>
    </template>

    <div class="space-y-5">
      <URadioGroup
        v-model="form.aiCrawlers"
        :items="modes.map(m => ({ value: m.value, label: m.label, description: m.description }))"
      />

      <div class="rounded-lg bg-gray-50 dark:bg-gray-900 p-3 text-xs space-y-1">
        <p class="font-medium text-gray-700 dark:text-gray-300">Content signal sent to crawlers</p>
        <code class="block text-primary-600 dark:text-primary-400">Content-Signal: {{ contentSignal }}</code>
        <p class="text-gray-500">Written into robots.txt and sent as a response header on every page (<a href="https://contentsignals.org" target="_blank" rel="noopener" class="underline">contentsignals.org</a>). Cloudflare's Markdown for Agents would otherwise stamp <code>ai-train=yes</code> on converted pages.</p>
      </div>

      <div v-for="(rows, category) in registryByCategory" :key="category" class="space-y-1.5">
        <p class="text-xs font-medium text-gray-700 dark:text-gray-300">{{ CATEGORY_LABELS[category] ?? category }}</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
          <div v-for="bot in rows" :key="bot.token" class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <UIcon
              :name="wouldBlock(bot.category) ? 'i-lucide-x-circle' : 'i-lucide-check-circle'"
              class="w-3.5 h-3.5 shrink-0"
              :class="wouldBlock(bot.category) ? 'text-red-400' : 'text-green-500'"
            />
            <span class="font-mono">{{ bot.token }}</span>
            <span class="text-gray-400">({{ bot.owner }}{{ bot.legacy ? ', legacy' : '' }})</span>
          </div>
        </div>
      </div>
    </div>
  </UCard>

  <UCard>
    <template #header>
      <p class="text-sm font-semibold text-gray-900 dark:text-white">Content for AI agents</p>
      <p class="text-xs text-gray-400 mt-0.5">Machine-friendly versions of your content — off automatically when all AI crawlers are blocked</p>
    </template>
    <div class="space-y-4">
      <USwitch v-model="form.llmsEnabled" label="Serve /llms.txt and /llms-full.txt" description="A curated index of your pages for LLMs (llmstxt.org), plus every page's full text in one file." />
      <UFormField v-if="form.llmsEnabled" label="llms.txt introduction" hint="Optional Markdown shown under the site description — what the site is, who it's for, what to read first">
        <UTextarea v-model="form.llmsIntro" :rows="4" class="w-full font-mono text-xs" placeholder="We publish independent reviews of… Start with the Guides section." />
      </UFormField>
      <USwitch v-model="form.markdownEnabled" label="Markdown version of every page" description="Agents can fetch /any-page.md, or send Accept: text/markdown, and get clean Markdown (≈80% fewer tokens than HTML). Pages advertise it with a <link rel=&quot;alternate&quot;>." />
      <div class="flex flex-wrap gap-2 text-xs">
        <UButton size="xs" variant="soft" to="/llms.txt" target="_blank" external icon="i-lucide-external-link">llms.txt</UButton>
        <UButton size="xs" variant="soft" to="/llms-full.txt" target="_blank" external icon="i-lucide-external-link">llms-full.txt</UButton>
        <UButton size="xs" variant="soft" to="/index.md" target="_blank" external icon="i-lucide-external-link">Homepage as Markdown</UButton>
      </div>
    </div>
    <template #footer>
      <div class="flex justify-end">
        <UButton :loading="saving" @click="save">Save changes</UButton>
      </div>
    </template>
  </UCard>

  <UCard>
    <template #header>
      <p class="text-sm font-semibold text-gray-900 dark:text-white">Cloudflare settings that override this page</p>
    </template>
    <div class="space-y-3 text-xs text-gray-600 dark:text-gray-400">
      <p>These live in the Cloudflare dashboard, apply to the whole <em>zone</em> (every site on that domain's zone, not just this one), and take effect before a request reaches NuxFlow:</p>
      <ul class="list-disc pl-5 space-y-1.5">
        <li><strong>AI Crawl Control → Block AI bots</strong> (formerly Security → Bots → "Block AI Scrapers and Crawlers"): blocks AI crawlers at the edge regardless of the choice above. Turn it off if you want AI search visibility.</li>
        <li><strong>AI Crawl Control → Managed robots.txt</strong>: Cloudflare <em>prepends</em> its own rules (disallowing GPTBot, ClaudeBot, Google-Extended, and others, with <code>ai-train=no</code>) above this site's robots.txt. If you chose "Allow all" here, turn the managed file off.</li>
        <li><strong>Markdown for Agents</strong> (Pro plan and up): Cloudflare converts HTML to Markdown for agents itself. It respects the <code>Content-Signal</code> header this site sends, so either way the signals match.</li>
        <li><strong>Pay per crawl</strong> (closed beta): charges AI crawlers per request at the zone level. Configure it in AI Crawl Control if you've joined — it works alongside the settings here.</li>
      </ul>
    </div>
  </UCard>

  <UCard>
    <template #header>
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-sm font-semibold text-gray-900 dark:text-white">Crawler activity</p>
          <p class="text-xs text-gray-400 mt-0.5">Requests from known search and AI crawlers, identified by User-Agent — {{ totalHits.toLocaleString() }} in the last {{ days }} days</p>
        </div>
        <div class="flex items-center gap-2">
          <USelect v-model="days" :items="[{ label: '7 days', value: 7 }, { label: '30 days', value: 30 }, { label: '90 days', value: 90 }]" size="sm" class="w-28" />
          <UButton size="sm" variant="ghost" icon="i-lucide-refresh-cw" :loading="activityPending" aria-label="Refresh" @click="refreshActivity()" />
        </div>
      </div>
    </template>

    <div v-if="!activity?.bots.length" class="text-center py-8 text-gray-400">
      <UIcon name="i-lucide-bot" class="w-8 h-8 mx-auto mb-2 opacity-40" />
      <p class="text-sm">No crawler visits recorded yet</p>
    </div>
    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs text-gray-400 border-b border-gray-100 dark:border-gray-800">
            <th class="py-2 pr-3 font-medium">Crawler</th>
            <th class="py-2 pr-3 font-medium">Type</th>
            <th class="py-2 pr-3 font-medium text-right">Requests</th>
            <th class="py-2 pr-3 font-medium">Last seen</th>
            <th class="py-2 font-medium">Last page</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in activity.bots" :key="b.bot" class="border-b border-gray-50 dark:border-gray-900 last:border-0">
            <td class="py-2 pr-3 font-mono text-xs">
              {{ b.bot }}
              <UBadge v-if="b.blocked" color="error" variant="soft" size="sm" class="ml-1">blocked</UBadge>
            </td>
            <td class="py-2 pr-3 text-xs text-gray-500">{{ CATEGORY_LABELS[b.category] ?? b.category }}</td>
            <td class="py-2 pr-3 text-right tabular-nums">{{ b.hits.toLocaleString() }}</td>
            <td class="py-2 pr-3 text-xs text-gray-500 whitespace-nowrap">{{ formatDate(b.lastSeenAt) }}</td>
            <td class="py-2 text-xs text-gray-500 font-mono truncate max-w-[16rem]">{{ b.lastPath }}</td>
          </tr>
        </tbody>
      </table>
      <p class="mt-3 text-xs text-gray-400">A blocked crawler that honors robots.txt only fetches <code>/robots.txt</code> — continued page requests from one suggests it's ignoring the rule (or is a scraper using its name). Block those at the edge with Cloudflare's AI Crawl Control.</p>
    </div>
  </UCard>
</template>
