<script setup lang="ts">
import { computed } from 'vue'
import type { SpacingValue } from '../types'

const props = withDefaults(defineProps<{
  quote?: string
  author?: string
  role?: string
  company?: string
  avatar?: string
  rating?: number
  style?: 'simple' | 'card' | 'large'
  align?: 'left' | 'center'
  bgColor?: string
  textColor?: string
  padding?: SpacingValue
}>(), {
  quote: 'This product completely changed how our team works.',
  author: 'Jane Smith',
  role: 'Product Manager',
  company: '',
  avatar: '',
  rating: 5,
  style: 'card',
  align: 'center',
  bgColor: '#ffffff',
  textColor: '#111827',
})

const containerStyle = computed(() => {
  const p = props.padding
  return {
    backgroundColor: props.bgColor,
    color: props.textColor,
    padding: p ? `${p.top}${p.unit} ${p.right}${p.unit} ${p.bottom}${p.unit} ${p.left}${p.unit}` : '48px 24px',
  }
})

const stars = computed(() => Math.min(5, Math.max(0, props.rating ?? 0)))
</script>

<template>
  <section :style="containerStyle">
    <div
      class="mx-auto max-w-2xl"
      :class="align === 'center' ? 'text-center' : 'text-left'"
    >
      <div
        class="relative"
        :class="{
          'bg-white dark:bg-gray-900 rounded-2xl p-8 shadow-sm border border-gray-100 dark:border-gray-800': style === 'card',
          'py-8': style === 'simple',
        }"
      >
        <!-- Large quote mark -->
        <svg
          v-if="style !== 'simple'"
          class="absolute top-4 left-6 w-10 h-10 opacity-10"
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
        </svg>

        <!-- Stars -->
        <div v-if="stars > 0" class="flex gap-0.5 mb-4" :class="align === 'center' ? 'justify-center' : ''">
          <svg
            v-for="i in 5"
            :key="i"
            class="w-4 h-4"
            :class="i <= stars ? 'text-yellow-400' : 'text-gray-300'"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        </div>

        <!-- Quote -->
        <blockquote
          class="text-lg leading-relaxed mb-6"
          :class="style === 'large' ? 'text-2xl font-medium' : ''"
        >
          "{{ quote }}"
        </blockquote>

        <!-- Author -->
        <div
          class="flex items-center gap-3"
          :class="align === 'center' ? 'justify-center' : ''"
        >
          <img
            v-if="avatar"
            :src="avatar"
            :alt="author"
            class="w-10 h-10 rounded-full object-cover border-2 border-gray-100 dark:border-gray-700"
          />
          <div
            v-else
            class="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-sm font-semibold text-gray-500"
          >
            {{ (author ?? 'A')[0]?.toUpperCase() }}
          </div>
          <div :class="align === 'center' ? 'text-left' : ''">
            <p class="text-sm font-semibold">{{ author }}</p>
            <p v-if="role || company" class="text-xs opacity-60">
              {{ [role, company].filter(Boolean).join(' · ') }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
