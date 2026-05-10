<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

const route = useRoute()

// Build the full path including the /admin/plugins/ prefix so we can
// match it against the registry entries returned by the nav endpoint.
const currentPath = computed(() => `/admin/plugins/${(route.params.slug as string[]).join('/')}`)

const { data } = await useFetch('/api/v1/plugins/nav')
const navItems = computed(() => data.value?.navItems ?? [])

const page = computed(() => navItems.value.find(p => p.path === currentPath.value))

// resolveComponent is evaluated at render time — the component must be
// globally registered in nuxflow-plugin-components.client.ts for this to work.
const resolvedComponent = computed(() =>
  page.value ? resolveComponent(page.value.component) : undefined,
)
</script>

<template>
  <div v-if="!page">
    <UCard>
      <div class="text-center py-10 text-gray-400">
        <UIcon name="i-lucide-puzzle" class="w-10 h-10 mx-auto mb-2 opacity-50" />
        <p class="text-sm font-medium">Plugin page not found</p>
        <p class="text-xs mt-1">This plugin may not be active or the path is incorrect.</p>
        <UButton to="/admin/plugins" variant="outline" size="sm" class="mt-4">Back to Plugins</UButton>
      </div>
    </UCard>
  </div>

  <div v-else-if="resolvedComponent && typeof resolvedComponent !== 'string'">
    <component :is="resolvedComponent" />
  </div>

  <!-- Component declared but not yet registered in nuxflow-plugin-components.client.ts -->
  <div v-else>
    <UCard>
      <div class="text-center py-10 text-gray-400">
        <UIcon name="i-lucide-box" class="w-10 h-10 mx-auto mb-2 opacity-50" />
        <p class="text-sm font-medium">{{ page.label }}</p>
        <p class="text-xs mt-1">
          Component <code>{{ page.component }}</code> is not yet registered.
          Add it to <code>app/plugins/nuxflow-plugin-components.client.ts</code>.
        </p>
      </div>
    </UCard>
  </div>
</template>
