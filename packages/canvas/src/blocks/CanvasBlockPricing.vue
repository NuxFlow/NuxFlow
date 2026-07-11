<script setup lang="ts">
import { computed } from 'vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import type { SpacingValue } from '../types'

const props = withDefaults(defineProps<{
  title?: string
  description?: string
  numPlans?: '2' | '3'
  // Plan 1
  plan1Name?: string
  plan1Price?: string
  plan1Period?: string
  plan1Features?: string
  plan1BtnLabel?: string
  plan1BtnUrl?: string
  plan1Popular?: boolean
  // Plan 2
  plan2Name?: string
  plan2Price?: string
  plan2Period?: string
  plan2Features?: string
  plan2BtnLabel?: string
  plan2BtnUrl?: string
  plan2Popular?: boolean
  // Plan 3
  plan3Name?: string
  plan3Price?: string
  plan3Period?: string
  plan3Features?: string
  plan3BtnLabel?: string
  plan3BtnUrl?: string
  plan3Popular?: boolean
  // Style config
  bgColor?: string
  textColor?: string
  padding?: SpacingValue
}>(), {
  title: 'Simple, transparent pricing',
  description: 'Choose the plan that is right for you.',
  numPlans: '3',
  // Plan 1
  plan1Name: 'Hobby',
  plan1Price: '0',
  plan1Period: '/mo',
  plan1Features: '["1 site", "Basic analytics", "Community support"]',
  plan1BtnLabel: 'Start free',
  plan1BtnUrl: '#',
  plan1Popular: false,
  // Plan 2
  plan2Name: 'Pro',
  plan2Price: '29',
  plan2Period: '/mo',
  plan2Features: '["Unlimited sites", "Detailed metrics", "Priority email support", "Custom domains"]',
  plan2BtnLabel: 'Get started',
  plan2BtnUrl: '#',
  plan2Popular: true,
  // Plan 3
  plan3Name: 'Enterprise',
  plan3Price: '99',
  plan3Period: '/mo',
  plan3Features: '["Dedicated instance", "SLA guarantee", "24/7 phone support", "Custom contracts"]',
  plan3BtnLabel: 'Contact sales',
  plan3BtnUrl: '#',
  plan3Popular: false,
})

function parseFeatures(val?: string) {
  if (!val) return []
  try {
    const parsed = JSON.parse(val)
    if (Array.isArray(parsed)) return parsed
  } catch {
    // skip
  }
  return val.split('\n').map(s => s.trim()).filter(Boolean)
}

const plans = computed(() => {
  const pList = [
    {
      name: props.plan1Name,
      price: props.plan1Price,
      period: props.plan1Period,
      features: parseFeatures(props.plan1Features),
      btnLabel: props.plan1BtnLabel,
      btnUrl: props.plan1BtnUrl,
      popular: props.plan1Popular,
    },
    {
      name: props.plan2Name,
      price: props.plan2Price,
      period: props.plan2Period,
      features: parseFeatures(props.plan2Features),
      btnLabel: props.plan2BtnLabel,
      btnUrl: props.plan2BtnUrl,
      popular: props.plan2Popular,
    },
  ]
  if (props.numPlans === '3') {
    pList.push({
      name: props.plan3Name,
      price: props.plan3Price,
      period: props.plan3Period,
      features: parseFeatures(props.plan3Features),
      btnLabel: props.plan3BtnLabel,
      btnUrl: props.plan3BtnUrl,
      popular: props.plan3Popular,
    })
  }
  return pList
})

const containerStyle = computed(() => {
  const p = props.padding
  return {
    backgroundColor: props.bgColor || 'transparent',
    color: props.textColor || 'inherit',
    padding: p ? `${p.top}${p.unit} ${p.right}${p.unit} ${p.bottom}${p.unit} ${p.left}${p.unit}` : '60px 24px',
  }
})
</script>

<template>
  <section class="canvas-pricing w-full" :style="containerStyle">
    <div class="mx-auto max-w-6xl px-6">
      <div v-if="title || description" class="text-center mb-12 space-y-2">
        <h2 v-if="title" class="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight">{{ title }}</h2>
        <p v-if="description" class="text-lg opacity-80 whitespace-pre-wrap max-w-2xl mx-auto">{{ description }}</p>
      </div>

      <div
        class="grid gap-8 items-stretch"
        :class="{
          'grid-cols-1 md:grid-cols-2 max-w-3xl mx-auto': plans.length === 2,
          'grid-cols-1 md:grid-cols-3': plans.length === 3,
        }"
      >
        <div
          v-for="(plan, idx) in plans"
          :key="idx"
          class="relative flex flex-col justify-between rounded-2xl border p-8 bg-white dark:bg-gray-900 shadow-sm transition-all duration-300 hover:shadow-lg"
          :class="[
            plan.popular
              ? 'border-primary-500 ring-2 ring-primary-500 scale-100 md:scale-[1.03] z-10'
              : 'border-gray-200 dark:border-gray-800'
          ]"
        >
          <!-- Popular badge -->
          <div
            v-if="plan.popular"
            class="absolute top-0 right-1/2 translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-500 px-4 py-1 text-xs font-bold text-gray-950 uppercase tracking-wider"
          >
            Popular
          </div>

          <div>
            <h3 class="text-xl font-bold text-gray-900 dark:text-white mb-2">{{ plan.name }}</h3>
            <div class="flex items-baseline gap-1 my-4">
              <span class="text-4xl font-extrabold text-gray-900 dark:text-white font-sans">${{ plan.price }}</span>
              <span class="text-sm opacity-60 font-semibold">{{ plan.period }}</span>
            </div>
            
            <ul class="space-y-3 border-t border-gray-100 dark:border-gray-800 pt-6 mt-6">
              <li
                v-for="(feat, fIdx) in plan.features"
                :key="fIdx"
                class="flex items-start gap-3 text-sm text-gray-600 dark:text-gray-300"
              >
                <UIcon name="i-lucide-check" mode="svg" class="w-4 h-4 text-primary-500 shrink-0 mt-0.5" />
                <span>{{ feat }}</span>
              </li>
            </ul>
          </div>

          <div class="mt-8 pt-4">
            <a
              v-if="plan.btnLabel"
              :href="plan.btnUrl"
              class="block w-full text-center font-bold px-6 py-3 rounded-xl transition-all duration-200 text-sm active:scale-[0.98]"
              :class="[
                plan.popular
                  ? 'bg-primary-500 text-gray-950 hover:bg-primary-400 shadow-md shadow-primary-500/20'
                  : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-900 dark:text-white'
              ]"
            >
              {{ plan.btnLabel }}
            </a>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
