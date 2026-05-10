<script setup lang="ts">
const sidebarOpen = ref(false)
const sidebarCollapsed = ref(false)

const route = useRoute()
// Close mobile drawer on navigation
watch(() => route.path, () => { sidebarOpen.value = false })
</script>

<template>
  <div class="mesh-bg relative flex h-screen overflow-hidden">
    <!-- Mobile backdrop -->
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-200"
      leave-to-class="opacity-0"
    >
      <div
        v-if="sidebarOpen"
        class="fixed inset-0 bg-black/50 z-30 md:hidden"
        @click="sidebarOpen = false"
      />
    </Transition>

    <!-- Desktop sidebar -->
    <aside
      class="glass-xl shrink-0 relative z-20 overflow-hidden transition-[width] duration-200 hidden md:block"
      :class="sidebarCollapsed ? 'w-[60px]' : 'w-64'"
      style="border-right: 1px solid var(--glass-xl-border);"
    >
      <AdminSidebar
        :collapsed="sidebarCollapsed"
        @toggle-collapse="sidebarCollapsed = !sidebarCollapsed"
      />
    </aside>

    <!-- Mobile sidebar drawer -->
    <Transition
      enter-active-class="transition-transform duration-200"
      enter-from-class="-translate-x-full"
      enter-to-class="translate-x-0"
      leave-active-class="transition-transform duration-200"
      leave-from-class="translate-x-0"
      leave-to-class="-translate-x-full"
    >
      <aside
        v-if="sidebarOpen"
        class="glass-xl fixed inset-y-0 left-0 w-64 z-40 overflow-hidden md:hidden"
        style="border-right: 1px solid var(--glass-xl-border);"
      >
        <AdminSidebar :collapsed="false" @toggle-collapse="sidebarOpen = false" />
      </aside>
    </Transition>

    <!-- Main content area -->
    <div class="flex flex-col flex-1 min-w-0 overflow-auto">
      <!-- Glass header -->
      <header
        class="glass h-16 shrink-0 px-4 md:px-6 flex items-center justify-between sticky top-0 z-10"
        style="border-bottom: 1px solid var(--glass-border);"
      >
        <div class="flex items-center gap-3">
          <UButton
            class="md:hidden"
            variant="ghost"
            size="sm"
            icon="i-lucide-menu"
            aria-label="Open navigation"
            @click="sidebarOpen = true"
          />
          <slot name="header">
            <h1 class="text-base font-semibold text-gray-900 dark:text-white">
              <slot name="title" />
            </h1>
          </slot>
        </div>
        <div class="flex items-center gap-3">
          <slot name="actions" />
          <ClientOnly>
            <AdminNotificationBell />
          </ClientOnly>
          <ClientOnly>
            <UColorModeButton />
          </ClientOnly>
        </div>
      </header>

      <main class="flex-1 p-4 md:p-6 overflow-auto">
        <slot />
      </main>
    </div>
  </div>
</template>
