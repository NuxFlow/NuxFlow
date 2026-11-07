<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const props = defineProps<{ collapsed?: boolean }>()
const emit = defineEmits<{ toggleCollapse: [] }>()

const { user, signOutAndLeave } = useUserSession()
const route = useRoute()

await fetchAdminAccess()
// Read through the shared state, not the fetched value, so the menu follows changes made
// on another admin page (e.g. Super Admin → Platform showing or hiding Plans/Usage).
const accessState = useAdminAccessState()
const access = computed(() => accessState.value ?? null)

// Filtered against the same rule table 02.admin-role-guard.global.ts enforces navigation
// against — see app/utils/admin-nav.ts. A user only ever sees links to sections their role
// can actually use.
function visibleEntries(items: AdminNavItem[]) {
  return groupNavItems(items.filter(item => !item.hidden && canAccessNavItem(item, access.value)))
}

// The editor reports what it's editing; the list says so in its URL.
const editingType = useEditingContentType()
const contentType = computed(() => (route.path === '/admin/content' ? route.query.type : editingType.value))
const activeTo = computed(() => activeNavTo(route.path, contentType.value))
const activeGroup = computed(() => navGroupOf(activeTo.value))

// ── Which groups are open ────────────────────────────────────────────────────
// The server can't see this browser's choice, so the first render uses the default and the
// remembered groups follow once mounted (the same render on both sides, so no hydration mismatch).
const OPEN_GROUPS_KEY = 'nuxflow:admin-nav-open'

function withActiveGroup(groups: string[]) {
  return activeGroup.value && !groups.includes(activeGroup.value) ? [...groups, activeGroup.value] : groups
}

const openGroups = ref<string[]>(withActiveGroup([DEFAULT_OPEN_NAV_GROUP]))

onMounted(() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(OPEN_GROUPS_KEY) ?? 'null')
    if (Array.isArray(saved)) openGroups.value = withActiveGroup(saved.filter(g => typeof g === 'string'))
  }
  catch { /* Nothing readable remembered: keep the default. */ }
})

function setOpenGroups(groups: string | string[] | undefined) {
  openGroups.value = Array.isArray(groups) ? groups : []
  try {
    localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(openGroups.value))
  }
  catch { /* Storage blocked: the menu still works, it just won't be remembered. */ }
}

// Arriving at a page opens its group. Only on arrival, so its group can still be closed.
watch(activeGroup, () => { openGroups.value = withActiveGroup(openGroups.value) })

// ── What the menu component draws ────────────────────────────────────────────
function linkClass(active: boolean) {
  return active ? 'nav-active' : 'text-gray-600 hover:bg-black/5 dark:text-gray-400 dark:hover:bg-white/5'
}

function toMenuItem(entry: AdminNavEntry): NavigationMenuItem {
  if (entry.kind === 'link') {
    // `active` is always set, so exactly one link is lit: left to itself the component would
    // also light every link whose path is a prefix of this page's.
    const active = entry.item.to === activeTo.value
    return { label: entry.item.label, icon: entry.item.icon, to: entry.item.to, active, class: linkClass(active) }
  }
  // A group is only lit when the link it holds can't be seen.
  const holdsActive = entry.items.some(item => item.to === activeTo.value)
  const active = holdsActive && (props.collapsed || !openGroups.value.includes(entry.group))
  return {
    label: entry.label,
    icon: entry.icon,
    value: entry.group,
    active,
    class: linkClass(active),
    children: entry.items.map((item) => {
      const childActive = item.to === activeTo.value
      return { label: item.label, icon: item.icon, to: item.to, active: childActive, class: linkClass(childActive) }
    }),
  }
}

// Two lists, so the menu draws a line between this site and the platform as a whole.
const menuItems = computed(() => [ADMIN_NAV, SUPER_ADMIN_NAV]
  .map(items => visibleEntries(items).map(toMenuItem))
  .filter(list => list.length > 0))

const menuUi = {
  link: 'gap-3 px-3 py-2 rounded-xl',
  linkLeadingIcon: 'size-4 text-current group-hover:text-current',
  linkTrailingIcon: 'size-4 text-current group-hover:text-current',
  list: 'space-y-0.5',
  childList: 'mt-0.5 space-y-0.5',
  childLink: 'gap-3 items-center px-3 py-2 rounded-xl font-medium',
  childLinkIcon: 'size-4 text-current group-hover:text-current',
}
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Logo + collapse toggle -->
    <div
      class="h-16 flex items-center shrink-0 gap-2"
      :class="collapsed ? 'px-2' : 'px-5'"
      style="border-bottom: 1px solid var(--glass-xl-border);"
    >
      <div class="flex items-center gap-2.5 flex-1 min-w-0">
        <div class="w-8 h-8 rounded-xl bg-primary-500 flex items-center justify-center shadow-md shadow-primary-500/30 shrink-0">
          <UIcon name="i-lucide-layers" class="w-4 h-4 text-white" />
        </div>
        <span v-if="!collapsed" class="font-bold text-gray-900 dark:text-white tracking-tight">NuxFlow</span>
      </div>
      <button
        class="flex items-center justify-center w-7 h-7 rounded-lg text-gray-400 hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0"
        :class="{ 'hidden md:flex': true }"
        :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="emit('toggleCollapse')"
      >
        <UIcon :name="collapsed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-left'" class="w-4 h-4" />
      </button>
    </div>

    <!-- Nav -->
    <div class="flex-1 overflow-y-auto py-4" :class="collapsed ? 'px-2' : 'px-3'">
      <UNavigationMenu
        :model-value="openGroups"
        :items="menuItems"
        :collapsed="collapsed"
        :ui="menuUi"
        orientation="vertical"
        color="neutral"
        variant="link"
        tooltip
        popover
        @update:model-value="setOpenGroups"
      />
    </div>

    <!-- User footer -->
    <div class="shrink-0 p-3" style="border-top: 1px solid var(--glass-xl-border);">
      <div v-if="collapsed" class="flex flex-col items-center gap-2">
        <UAvatar :alt="user?.name" size="sm" />
        <UButton variant="ghost" size="xs" icon="i-lucide-log-out" aria-label="Sign out" @click="signOutAndLeave()" />
      </div>
      <div v-else class="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
        <UAvatar :alt="user?.name" size="sm" />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ user?.name }}</p>
          <p class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ user?.email }}</p>
        </div>
        <UButton variant="ghost" size="xs" icon="i-lucide-log-out" aria-label="Sign out" @click="signOutAndLeave()" />
      </div>
    </div>
  </div>
</template>
