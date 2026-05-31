<script setup lang="ts">
const templateModel = defineModel<string>({ default: 'landing' })

defineProps<{ loading?: boolean; error?: string }>()
defineEmits<{ next: []; back: [] }>()

const templates = [
  {
    id: 'landing',
    name: 'SaaS / Business Landing',
    desc: 'High-conversion page with hero, feature grids, and contact forms.',
    icon: 'i-lucide-rocket',
    gradient: 'from-blue-500 to-indigo-600',
    tag: 'Popular'
  },
  {
    id: 'blog',
    name: 'Publisher Blog',
    desc: 'Content-first layout listing post categories, tags, and comment features.',
    icon: 'i-lucide-book-open',
    gradient: 'from-emerald-400 to-teal-600',
    tag: 'Writers'
  },
  {
    id: 'portfolio',
    name: 'Creative Portfolio',
    desc: 'Designed for developers and designers with project showcases.',
    icon: 'i-lucide-folder-open',
    gradient: 'from-amber-400 to-orange-500',
    tag: 'Creatives'
  },
  {
    id: 'blank',
    name: 'Blank Canvas',
    desc: 'Completely empty template containing only a simple title header.',
    icon: 'i-lucide-drafting-compass',
    gradient: 'from-gray-400 to-gray-600',
    tag: 'Minimal'
  }
]
</script>

<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-xl font-bold text-gray-900 dark:text-white">Choose a Starter Template</h2>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
        Select a structured layout to pre-seed your website. You can customize, delete, or change everything later.
      </p>
    </div>

    <!-- Template List -->
    <div class="grid grid-cols-1 gap-3">
      <div
        v-for="t in templates"
        :key="t.id"
        class="relative group rounded-xl border p-4 transition-all duration-300 hover:scale-[1.01] hover:shadow-md cursor-pointer flex flex-col justify-between overflow-hidden bg-white dark:bg-gray-900"
        :class="templateModel === t.id
          ? 'border-primary-500 ring-2 ring-primary-500 bg-primary-50/20 dark:bg-primary-950/10'
          : 'border-gray-200 dark:border-gray-800 hover:border-primary-400 dark:hover:border-primary-600'"
        @click="templateModel = t.id"
      >
        <!-- Gradient card preview -->
        <div class="flex items-start gap-4 z-10">
          <div
            class="flex items-center justify-center w-12 h-12 rounded-xl text-white shadow-md bg-gradient-to-br flex-shrink-0"
            :class="t.gradient"
          >
            <UIcon :name="t.icon" class="w-6 h-6 animate-pulse-slow" />
          </div>
          <div class="space-y-1 pr-6">
            <div class="flex items-center gap-2">
              <span class="font-bold text-gray-900 dark:text-white text-base group-hover:text-primary-500 dark:group-hover:text-primary-400 transition-colors">
                {{ t.name }}
              </span>
              <UBadge
                v-if="t.tag"
                size="xs"
                :color="templateModel === t.id ? 'primary' : 'gray'"
                variant="subtle"
                class="rounded-full font-medium"
              >
                {{ t.tag }}
              </UBadge>
            </div>
            <p class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              {{ t.desc }}
            </p>
          </div>
        </div>

        <!-- Selected badge / checkmark -->
        <div
          class="absolute top-4 right-4 flex items-center justify-center w-6 h-6 rounded-full transition-transform duration-300"
          :class="templateModel === t.id
            ? 'bg-primary-500 text-white scale-100'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-400 scale-0 group-hover:scale-75'"
        >
          <UIcon name="i-lucide-check" class="w-4 h-4 font-bold" />
        </div>
      </div>
    </div>

    <UAlert v-if="error" color="red" variant="soft" :description="error" />

    <div class="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-gray-800">
      <UButton variant="ghost" @click="$emit('back')">
        <UIcon name="i-lucide-arrow-left" class="mr-1 w-4 h-4" />
        Back
      </UButton>
      <UButton :loading="loading" size="lg" class="px-6" @click="$emit('next')">
        Finish setup
        <UIcon name="i-lucide-rocket" class="ml-1 w-4 h-4" />
      </UButton>
    </div>
  </div>
</template>
