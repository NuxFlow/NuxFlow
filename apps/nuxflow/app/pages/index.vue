<script setup lang="ts">
const { data: page } = await useFetch('/api/public/pages/home')

const hasCustomContent = computed(() =>
  page.value !== null && page.value?.content !== null && page.value?.content !== undefined,
)

const isCanvasPage = computed(() => {
  const c = page.value?.content
  return typeof c === 'object' && c !== null && (c as { type: string }).type === 'canvas'
})

useSeoMeta({
  title: page.value?.seoTitle || page.value?.title || 'NuxFlow',
  description: page.value?.seoDescription || 'A modern, edge-deployed headless CMS built on Nuxt, Cloudflare Workers, and Turso.',
})

const features = [
  {
    icon: 'i-lucide-zap',
    title: 'Edge-first performance',
    description: 'Runs on Cloudflare Workers at the edge — zero cold starts, global by default, no server to manage.',
    color: 'text-yellow-500',
    bg: 'bg-yellow-500/10',
  },
  {
    icon: 'i-lucide-layout-panel-top',
    title: 'Canvas page builder',
    description: 'Drag-and-drop visual editor with hero sections, feature grids, testimonials, and more — no code required.',
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
  },
  {
    icon: 'i-lucide-puzzle',
    title: 'Hot-loading plugins & themes',
    description: 'Install plugins and upload CSS themes without redeploying. Dynamic plugins run as isolated Cloudflare Workers; CSS themes inject instantly at the edge.',
    color: 'text-purple-500',
    bg: 'bg-purple-500/10',
  },
  {
    icon: 'i-lucide-sparkles',
    title: 'AI writing assistant',
    description: 'Improve your writing, generate SEO metadata, and produce image alt text with built-in AI tools.',
    color: 'text-primary-500',
    bg: 'bg-primary-500/10',
  },
  {
    icon: 'i-lucide-globe',
    title: 'Multi-site ready',
    description: 'Manage multiple websites from a single deployment — each with its own content, users, and settings.',
    color: 'text-teal-500',
    bg: 'bg-teal-500/10',
  },
  {
    icon: 'i-lucide-credit-card',
    title: 'Payments & memberships',
    description: 'Accept subscriptions via Stripe, Lemon Squeezy, or Paddle and gate content behind membership tiers.',
    color: 'text-green-500',
    bg: 'bg-green-500/10',
  },
]

const stack = [
  { label: 'Nuxt 4', icon: 'i-simple-icons-nuxtdotjs' },
  { label: 'Vue 3', icon: 'i-simple-icons-vuedotjs' },
  { label: 'Cloudflare Workers', icon: 'i-simple-icons-cloudflare' },
  { label: 'Turso · libSQL', icon: 'i-lucide-database' },
  { label: 'Drizzle ORM', icon: 'i-lucide-layers' },
  { label: 'TypeScript', icon: 'i-simple-icons-typescript' },
]
</script>

<template>
  <!-- Canvas pages: full-width, no container — blocks handle their own layout -->
  <NuxBlock v-if="hasCustomContent && isCanvasPage" :content="page!.content" />

  <!-- Rich-text / other content: contained with title -->
  <div v-else-if="hasCustomContent" class="max-w-4xl mx-auto px-6 py-12">
    <h1 class="text-4xl font-bold text-gray-900 dark:text-white mb-8">
      {{ page!.title }}
    </h1>
    <NuxBlock :content="page!.content" />
  </div>

  <!-- Default NuxFlow marketing page -->
  <div v-else>
    <!-- Hero -->
    <section class="relative overflow-hidden bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white">
      <!-- Subtle grid overlay -->
      <div class="absolute inset-0 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:40px_40px]" />
      <!-- Glow -->
      <div class="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary-500/20 rounded-full blur-3xl" />

      <div class="relative max-w-5xl mx-auto px-6 py-24 text-center space-y-8">
        <!-- Logo mark -->
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary-500 shadow-xl shadow-primary-500/30 mb-2">
          <UIcon name="i-lucide-layers" class="w-8 h-8 text-white" />
        </div>

        <!-- Headline -->
        <div class="space-y-4">
          <h1 class="text-5xl sm:text-6xl font-extrabold tracking-tight">
            The CMS built for
            <span class="text-primary-400"> the edge</span>
          </h1>
          <p class="text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto leading-relaxed">
            NuxFlow is an open-source headless CMS powered by Nuxt 4 and Cloudflare Workers.
            Fast, flexible, and fully self-hosted — no subscriptions, no lock-in.
          </p>
        </div>

        <!-- CTAs -->
        <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
          <UButton to="/admin" size="xl" icon="i-lucide-layout-dashboard" class="shadow-lg shadow-primary-500/20">
            Go to dashboard
          </UButton>
          <UButton
            href="https://github.com/mattmacmillan76/Nuxflow"
            target="_blank"
            rel="noopener"
            size="xl"
            variant="outline"
            color="neutral"
            icon="i-simple-icons-github"
            class="border-white/20 text-white hover:bg-white/10"
          >
            View on GitHub
          </UButton>
        </div>

        <!-- Stack badges -->
        <div class="flex flex-wrap items-center justify-center gap-3 pt-4">
          <div
            v-for="item in stack"
            :key="item.label"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs text-gray-400"
          >
            <UIcon :name="item.icon" class="w-3.5 h-3.5" />
            {{ item.label }}
          </div>
        </div>
      </div>
    </section>

    <!-- Features -->
    <section class="max-w-5xl mx-auto px-6 py-20">
      <div class="text-center mb-12 space-y-3">
        <p class="text-xs font-semibold uppercase tracking-widest text-primary-500">Everything you need</p>
        <h2 class="text-3xl font-bold text-gray-900 dark:text-white">Built for real projects</h2>
        <p class="text-gray-500 dark:text-gray-400 max-w-xl mx-auto">
          From a simple blog to a multi-site platform with payments and visual page building — NuxFlow handles it all from a single deployment.
        </p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        <div
          v-for="feat in features"
          :key="feat.title"
          class="group relative rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 space-y-3 hover:border-primary-500/40 hover:shadow-lg hover:shadow-primary-500/5 transition-all duration-200"
        >
          <div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" :class="feat.bg">
            <UIcon :name="feat.icon" class="w-5 h-5" :class="feat.color" />
          </div>
          <div>
            <p class="font-semibold text-gray-900 dark:text-white">{{ feat.title }}</p>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{{ feat.description }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- CTA -->
    <section class="bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-800">
      <div class="max-w-3xl mx-auto px-6 py-16 text-center space-y-6">
        <h2 class="text-3xl font-bold text-gray-900 dark:text-white">Ready to build?</h2>
        <p class="text-gray-500 dark:text-gray-400">
          Your site is running. Head to the dashboard to create content, manage media, and configure your plugins.
        </p>
        <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
          <UButton to="/admin" size="lg" icon="i-lucide-layout-dashboard">
            Open dashboard
          </UButton>
          <UButton to="/admin/content" size="lg" variant="outline" icon="i-lucide-file-plus">
            Create first page
          </UButton>
        </div>
      </div>
    </section>

    <!-- Footer -->
    <footer class="border-t border-gray-200 dark:border-gray-800">
      <div class="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-400">
        <div class="flex items-center gap-2">
          <div class="w-5 h-5 rounded-md bg-primary-500 flex items-center justify-center">
            <UIcon name="i-lucide-layers" class="w-3 h-3 text-white" />
          </div>
          <span class="font-medium text-gray-600 dark:text-gray-300">NuxFlow</span>
          <span>·</span>
          <span>Open-source CMS · MIT License</span>
        </div>
        <div class="flex items-center gap-5">
          <NuxtLink to="/admin" class="hover:text-gray-600 dark:hover:text-gray-200 transition-colors">Dashboard</NuxtLink>
          <a href="https://github.com/mattmacmillan76/Nuxflow" target="_blank" rel="noopener" class="hover:text-gray-600 dark:hover:text-gray-200 transition-colors">GitHub</a>
        </div>
      </div>
    </footer>
  </div>
</template>
