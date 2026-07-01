<script setup lang="ts">
interface ChildItem {
  id: string; label: string; type: 'page' | 'url'
  url?: string; slug?: string; target: '_self' | '_blank'
}
interface MenuItem {
  id: string; label: string; type: 'page' | 'url'
  url?: string; slug?: string; target: '_self' | '_blank'
  children: ChildItem[]
}
interface SitePublic {
  name: string
  domain: string
  locale: string
  showHeader: boolean
  showSearch: boolean
  showStickyHeader: boolean
  logoSize: 'sm' | 'md' | 'lg'
  logoUrl: string | null
  canonicalBase: string
}

const logoHeightClass = computed(() => {
  const size = site.value?.logoSize ?? 'md'
  if (size === 'sm') return 'h-6'
  if (size === 'lg') return 'h-10'
  return 'h-8'
})

const { data: site } = await useFetch<SitePublic>('/api/public/site', {
  headers: useRequestHeaders(['host']),
})
const { data: menu } = await useFetch<{ items: unknown[] } | null>('/api/public/menus/header', {
  headers: useRequestHeaders(['host']),
})

const navItems = computed<MenuItem[]>(() => (menu.value?.items ?? []) as MenuItem[])

function href(item: MenuItem | ChildItem) {
  return item.type === 'url' ? (item.url ?? '/') : `/${item.slug ?? ''}`
}

const mobileOpen = ref(false)
const route = useRoute()
watch(() => route.path, () => { mobileOpen.value = false })

// ── Language Switcher State ──────────────────────────────────────────────────
const availableLocales = useState<Array<{ locale: string; slug: string; rawSlug?: string }>>('active-locales', () => [])
const showLangMenu = ref(false)
const langDropdown = ref<HTMLElement | null>(null)

const currentLocale = computed(() => {
  const pathParts = route.path.split('/').filter(Boolean)
  const firstPart = pathParts[0]
  if (firstPart && availableLocales.value.some(l => l.locale === firstPart)) {
    return firstPart
  }
  return site.value?.locale || 'en'
})

const LOCALE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  pt: 'Português',
  nl: 'Nederlands',
  pl: 'Polski',
  ja: '日本語',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  ko: '한국어',
  ar: 'العربية',
  ru: 'Русский',
  hi: 'हिन्दी'
}

function getLocaleName(code: string) {
  return LOCALE_NAMES[code] || code.toUpperCase()
}

function getLocalePath(item: { locale: string; slug: string }) {
  const defaultLocale = site.value?.locale || 'en'
  const slugPath = item.slug === 'home' ? '' : item.slug
  if (item.locale === defaultLocale) {
    return `/${slugPath}`
  }
  return `/${item.locale}/${slugPath}`
}

function handleClickOutside(e: MouseEvent) {
  if (langDropdown.value && !langDropdown.value.contains(e.target as Node)) {
    showLangMenu.value = false
  }
}

onMounted(() => {
  window.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  window.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <header v-if="site?.showHeader !== false" :class="['glass z-50', site?.showStickyHeader !== false ? 'sticky top-0' : '']" style="border-bottom: 1px solid var(--glass-border);">
    <div class="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-6">
      <!-- Logo -->
      <NuxtLink to="/" class="shrink-0 flex items-center hover:opacity-80 transition-opacity">
        <img
          v-if="site?.logoUrl"
          :src="site.logoUrl"
          :alt="site.name ?? 'Logo'"
          :class="[logoHeightClass, 'w-auto max-w-[160px] object-contain']"
        >
        <span v-else class="font-bold text-lg text-gray-900 dark:text-white">
          {{ site?.name ?? 'NuxFlow' }}
        </span>
      </NuxtLink>

      <!-- Desktop nav -->
      <nav v-if="navItems.length" class="hidden lg:flex items-center gap-1 flex-1">
        <template v-for="item in navItems" :key="item.id">
          <!-- Item with dropdown -->
          <div v-if="item.children && item.children.length > 0" class="relative group">
            <NuxtLink
              :to="href(item)"
              :target="item.target"
              class="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              {{ item.label }}
              <UIcon name="i-lucide-chevron-down" class="w-3 h-3 transition-transform group-hover:rotate-180" />
            </NuxtLink>
            <!-- Dropdown -->
            <div class="absolute left-0 top-full mt-1 w-48 glass rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 z-50">
              <NuxtLink
                v-for="child in item.children"
                :key="child.id"
                :to="href(child)"
                :target="child.target"
                class="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5 hover:text-primary-600 transition-colors"
              >
                {{ child.label }}
                <UIcon v-if="child.target === '_blank'" name="i-lucide-external-link" class="w-3 h-3 ml-auto text-gray-400" />
              </NuxtLink>
            </div>
          </div>

          <!-- Simple link -->
          <NuxtLink
            v-else
            :to="href(item)"
            :target="item.target"
            class="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            {{ item.label }}
            <UIcon v-if="item.target === '_blank'" name="i-lucide-external-link" class="w-3 h-3 text-gray-400" />
          </NuxtLink>
        </template>
      </nav>

      <div class="flex items-center gap-2 ml-auto">
        <!-- Language Switcher -->
        <div v-if="availableLocales && availableLocales.length > 1" ref="langDropdown" class="relative">
          <button
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white transition-colors cursor-pointer select-none"
            @click.stop="showLangMenu = !showLangMenu"
          >
            <UIcon name="i-lucide-globe" class="w-4 h-4" />
            <span class="uppercase tracking-wider font-mono">{{ currentLocale }}</span>
            <UIcon name="i-lucide-chevron-down" class="w-3.5 h-3.5 transition-transform duration-200" :class="showLangMenu ? 'rotate-180' : ''" />
          </button>
          
          <div
            v-if="showLangMenu"
            class="absolute right-0 top-full mt-2 w-44 glass rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden z-50 py-1"
          >
            <NuxtLink
              v-for="loc in availableLocales"
              :key="loc.locale"
              :to="getLocalePath(loc)"
              class="flex items-center gap-2.5 px-4 py-2.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5 hover:text-primary-500 transition-colors font-medium cursor-pointer"
              @click="showLangMenu = false"
            >
              <span class="font-mono uppercase text-gray-400 dark:text-gray-500 font-semibold">{{ loc.locale }}</span>
              <span class="truncate">{{ getLocaleName(loc.locale) }}</span>
            </NuxtLink>
          </div>
        </div>

        <NuxtLink
          v-if="site?.showSearch !== false"
          to="/search"
          class="flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          aria-label="Search"
        >
          <UIcon name="i-lucide-search" class="w-4 h-4" />
        </NuxtLink>
        <!-- Mobile hamburger -->
        <button
          v-if="navItems.length"
          class="lg:hidden flex items-center justify-center w-8 h-8 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-gray-600 dark:text-gray-400"
          :aria-label="mobileOpen ? 'Close menu' : 'Open menu'"
          @click="mobileOpen = !mobileOpen"
        >
          <UIcon :name="mobileOpen ? 'i-lucide-x' : 'i-lucide-menu'" class="w-5 h-5" />
        </button>
      </div>
    </div>

    <!-- Mobile nav dropdown -->
    <Transition
      enter-active-class="transition-all duration-200 overflow-hidden"
      enter-from-class="max-h-0 opacity-0"
      enter-to-class="max-h-96 opacity-100"
      leave-active-class="transition-all duration-200 overflow-hidden"
      leave-from-class="max-h-96 opacity-100"
      leave-to-class="max-h-0 opacity-0"
    >
      <nav v-if="mobileOpen" class="lg:hidden border-t border-gray-200 dark:border-gray-700 px-4 py-3 space-y-1">
        <template v-for="item in navItems" :key="item.id">
          <NuxtLink
            :to="href(item)"
            :target="item.target"
            class="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            {{ item.label }}
            <UIcon v-if="item.target === '_blank'" name="i-lucide-external-link" class="w-3 h-3 text-gray-400 ml-auto" />
          </NuxtLink>
          <NuxtLink
            v-for="child in item.children"
            :key="child.id"
            :to="href(child)"
            :target="child.target"
            class="flex items-center gap-2 pl-7 pr-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            {{ child.label }}
          </NuxtLink>
        </template>
      </nav>
    </Transition>
  </header>
</template>
