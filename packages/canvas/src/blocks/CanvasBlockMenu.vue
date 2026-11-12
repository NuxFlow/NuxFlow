<script setup lang="ts">
import { computed } from 'vue'
import type { SpacingValue } from '../types'
import { spacingToCss } from '../utils/spacing'
import { dietaryLabel, menuSections, parseMenuItems, usedDietaryCodes } from '../utils/menu'

// Theme hooks: .canvas-menu, .canvas-menu-section, .canvas-menu-item, .canvas-menu-price,
// .canvas-menu-diet[data-code], .canvas-menu-key, .canvas-menu-note.
// The menu is also given to search engines as schema.org Menu data (app/utils/seo.ts).

const props = withDefaults(defineProps<{
  title?: string
  intro?: string
  itemsJson?: string
  currency?: string
  columns?: string
  showKey?: boolean
  note?: string
  bgColor?: string
  textColor?: string
  padding?: SpacingValue
}>(), {
  title: 'Menu',
  intro: '',
  itemsJson: '[]',
  currency: 'GBP',
  columns: '1',
  showKey: true,
  note: '',
  bgColor: '',
  textColor: '',
  padding: undefined,
})

const items = computed(() => parseMenuItems(props.itemsJson))
const sections = computed(() => menuSections(items.value))
const key = computed(() => (props.showKey ? usedDietaryCodes(items.value) : []))

const containerStyle = computed(() => ({
  backgroundColor: props.bgColor || undefined,
  color: props.textColor || undefined,
  padding: spacingToCss(props.padding, '48px 24px'),
}))
</script>

<template>
  <section class="canvas-menu" :style="containerStyle">
    <div class="mx-auto" :class="columns === '2' ? 'max-w-5xl' : 'max-w-2xl'">
      <div v-if="title || intro" class="mb-8 text-center">
        <h2 v-if="title" class="text-3xl font-bold">{{ title }}</h2>
        <p v-if="intro" class="mt-2 opacity-80 whitespace-pre-line">{{ intro }}</p>
      </div>

      <p v-if="!items.length" class="text-center text-sm opacity-60">Add dishes in the block settings.</p>

      <div :class="columns === '2' ? 'grid gap-x-12 gap-y-10 md:grid-cols-2' : 'space-y-10'">
        <section v-for="(s, si) in sections" :key="si" class="canvas-menu-section">
          <h3 v-if="s.title" class="mb-4 border-b border-current/20 pb-2 text-xl font-semibold">{{ s.title }}</h3>
          <ul class="space-y-4">
            <li v-for="(item, ii) in s.items" :key="ii" class="canvas-menu-item">
              <div class="flex items-baseline gap-2">
                <span class="font-semibold">{{ item.name }}</span>
                <span v-if="item.dietary.length" class="flex gap-1">
                  <abbr
                    v-for="code in item.dietary"
                    :key="code"
                    :title="dietaryLabel(code)"
                    :data-code="code"
                    class="canvas-menu-diet rounded border border-current/30 px-1 text-[0.7rem] font-semibold leading-4 no-underline"
                  >{{ code }}</abbr>
                </span>
                <span class="flex-1 translate-y-[-0.2em] border-b border-dotted border-current/30" aria-hidden="true" />
                <span v-if="item.price" class="canvas-menu-price font-semibold whitespace-nowrap">{{ item.price }}</span>
              </div>
              <p v-if="item.description" class="mt-0.5 text-sm opacity-75">{{ item.description }}</p>
            </li>
          </ul>
        </section>
      </div>

      <div v-if="key.length || note" class="mt-10 space-y-2 text-sm opacity-80">
        <p v-if="key.length" class="canvas-menu-key">
          <template v-for="(d, i) in key" :key="d.code">
            <strong>{{ d.code }}</strong> {{ d.label }}<template v-if="i < key.length - 1"> · </template>
          </template>
        </p>
        <p v-if="note" class="canvas-menu-note whitespace-pre-line">{{ note }}</p>
      </div>
    </div>
  </section>
</template>
