<script setup lang="ts">
import type { CustomizerValues } from '~/types/theme-customizer'

const values = defineModel<CustomizerValues>('values', { required: true })

const colorModeOptions = [
  { value: 'auto' as const, label: 'Auto', icon: 'i-lucide-monitor' },
  { value: 'light' as const, label: 'Light', icon: 'i-lucide-sun' },
  { value: 'dark' as const, label: 'Dark', icon: 'i-lucide-moon' },
]

const colorSwatches = [
  '#00dc82', '#3b82f6', '#8b5cf6', '#f59e0b',
  '#ef4444', '#ec4899', '#06b6d4', '#14b8a6',
  '#f97316', '#84cc16', '#a855f7', '#64748b',
]

const bgLightSwatches = [
  '#ffffff', '#fafafa', '#f8fafc', '#f9fafb',
  '#fffbeb', '#fdf4ff', '#f0f9ff', '#f0fdf4',
]

const bgDarkSwatches = [
  '#030712', '#0a0a0a', '#0f172a', '#111827',
  '#09090b', '#020617', '#0c1445', '#0d1117',
]

const fontSizeOptions = [
  { value: 'xs' as const, label: 'XS' },
  { value: 'sm' as const, label: 'SM' },
  { value: 'base' as const, label: 'MD' },
  { value: 'lg' as const, label: 'LG' },
  { value: 'xl' as const, label: 'XL' },
]

const lineHeightOptions = [
  { value: 'tight' as const, label: 'Tight' },
  { value: 'normal' as const, label: 'Normal' },
  { value: 'relaxed' as const, label: 'Relaxed' },
]

const radiusOptions = [
  { value: 'none' as const, label: 'None', preview: '0px' },
  { value: 'sm' as const, label: 'Small', preview: '4px' },
  { value: 'md' as const, label: 'Medium', preview: '8px' },
  { value: 'lg' as const, label: 'Large', preview: '12px' },
  { value: 'xl' as const, label: 'XL', preview: '16px' },
  { value: 'full' as const, label: 'Pill', preview: '9999px' },
]

const spacingOptions = [
  { value: 'compact' as const, label: 'Compact' },
  { value: 'normal' as const, label: 'Normal' },
  { value: 'spacious' as const, label: 'Spacious' },
]

const contentWidthOptions = [
  { value: 'narrow' as const, label: 'Narrow', sub: '720px' },
  { value: 'default' as const, label: 'Default', sub: '960px' },
  { value: 'wide' as const, label: 'Wide', sub: '1200px' },
  { value: 'full' as const, label: 'Full', sub: '100%' },
]

// Shared select class (avoids long repetition in template)
const SELECT_CLS = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500'
const BTN_ACTIVE = 'bg-primary-500 text-white shadow-sm'
const BTN_INACTIVE = 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'
</script>

<template>
  <aside class="w-72 shrink-0 border-r border-gray-200 dark:border-gray-800 overflow-y-auto bg-gray-50/80 dark:bg-gray-900/50">

    <!-- Appearance (color mode) -->
    <section class="border-b border-gray-200 dark:border-gray-800 p-4 space-y-3">
      <p class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Appearance</p>
      <div class="flex gap-0.5 p-0.5 bg-gray-100 dark:bg-gray-800 rounded-xl">
        <button
          v-for="m in colorModeOptions"
          :key="m.value"
          class="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[10px] text-xs font-medium transition-colors"
          :class="values.colorMode === m.value
            ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white'
            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'"
          @click="values.colorMode = m.value"
        >
          <UIcon :name="m.icon" class="w-3.5 h-3.5" />
          {{ m.label }}
        </button>
      </div>
    </section>

    <!-- Colors -->
    <section class="border-b border-gray-200 dark:border-gray-800 p-4 space-y-5">
      <p class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Colors</p>

      <!-- Accent color -->
      <div class="space-y-2">
        <label class="text-xs font-medium text-gray-600 dark:text-gray-300">Accent color</label>
        <div class="flex items-center gap-2">
          <input
            v-model="values.primaryColor"
            type="color"
            class="w-9 h-9 rounded-lg cursor-pointer border border-gray-200 dark:border-gray-700 bg-transparent p-0.5 shrink-0"
          >
          <input
            v-model="values.primaryColor"
            type="text"
            placeholder="#00dc82"
            class="flex-1 px-2.5 py-1.5 text-xs font-mono rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
        </div>
        <!-- Quick swatches -->
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="sw in colorSwatches"
            :key="sw"
            :title="sw"
            class="w-5 h-5 rounded-md border-2 transition-transform hover:scale-110 focus:outline-none"
            :style="{ backgroundColor: sw, borderColor: values.primaryColor === sw ? '#000' : 'transparent' }"
            @click="values.primaryColor = sw"
          />
        </div>
      </div>

      <!-- Link color -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="text-xs font-medium text-gray-600 dark:text-gray-300">Link color</label>
          <button
            v-if="values.linkColor"
            class="text-[10px] text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
            @click="values.linkColor = ''"
          >
            Reset to accent
          </button>
          <span v-else class="text-[10px] text-gray-400 dark:text-gray-500">Using accent</span>
        </div>
        <div class="flex items-center gap-2">
          <input
            type="color"
            :value="values.linkColor || values.primaryColor"
            class="w-9 h-9 rounded-lg cursor-pointer border border-gray-200 dark:border-gray-700 bg-transparent p-0.5 shrink-0"
            @input="(e) => values.linkColor = (e.target as HTMLInputElement).value"
          >
          <input
            type="text"
            :value="values.linkColor || values.primaryColor"
            placeholder="Same as accent"
            class="flex-1 px-2.5 py-1.5 text-xs font-mono rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            @input="(e) => values.linkColor = (e.target as HTMLInputElement).value"
          >
        </div>
      </div>
    </section>

    <!-- Background -->
    <section class="border-b border-gray-200 dark:border-gray-800 p-4 space-y-5">
      <p class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Background</p>

      <!-- Light mode background -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="text-xs font-medium text-gray-600 dark:text-gray-300">
            <UIcon name="i-lucide-sun" class="w-3 h-3 inline-block mr-1 opacity-60" />
            Light background
          </label>
          <button
            v-if="values.bgLight"
            class="text-[10px] text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
            @click="values.bgLight = ''"
          >
            Reset to theme
          </button>
          <span v-else class="text-[10px] text-gray-400 dark:text-gray-500">Using theme default</span>
        </div>
        <div class="flex items-center gap-2">
          <input
            type="color"
            :value="values.bgLight || '#ffffff'"
            class="w-9 h-9 rounded-lg cursor-pointer border border-gray-200 dark:border-gray-700 bg-transparent p-0.5 shrink-0"
            @input="(e) => values.bgLight = (e.target as HTMLInputElement).value"
          >
          <input
            type="text"
            :value="values.bgLight"
            placeholder="e.g. #ffffff"
            class="flex-1 px-2.5 py-1.5 text-xs font-mono rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            @input="(e) => values.bgLight = (e.target as HTMLInputElement).value"
          >
        </div>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="sw in bgLightSwatches"
            :key="sw"
            :title="sw"
            class="w-5 h-5 rounded border-2 transition-transform hover:scale-110 focus:outline-none"
            :style="{ backgroundColor: sw, borderColor: values.bgLight === sw ? '#6366f1' : '#d1d5db' }"
            @click="values.bgLight = sw"
          />
        </div>
      </div>

      <!-- Dark mode background -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="text-xs font-medium text-gray-600 dark:text-gray-300">
            <UIcon name="i-lucide-moon" class="w-3 h-3 inline-block mr-1 opacity-60" />
            Dark background
          </label>
          <button
            v-if="values.bgDark"
            class="text-[10px] text-primary-500 hover:text-primary-600 dark:hover:text-primary-400"
            @click="values.bgDark = ''"
          >
            Reset to theme
          </button>
          <span v-else class="text-[10px] text-gray-400 dark:text-gray-500">Using theme default</span>
        </div>
        <div class="flex items-center gap-2">
          <input
            type="color"
            :value="values.bgDark || '#030712'"
            class="w-9 h-9 rounded-lg cursor-pointer border border-gray-200 dark:border-gray-700 bg-transparent p-0.5 shrink-0"
            @input="(e) => values.bgDark = (e.target as HTMLInputElement).value"
          >
          <input
            type="text"
            :value="values.bgDark"
            placeholder="e.g. #030712"
            class="flex-1 px-2.5 py-1.5 text-xs font-mono rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            @input="(e) => values.bgDark = (e.target as HTMLInputElement).value"
          >
        </div>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="sw in bgDarkSwatches"
            :key="sw"
            :title="sw"
            class="w-5 h-5 rounded border-2 transition-transform hover:scale-110 focus:outline-none"
            :style="{ backgroundColor: sw, borderColor: values.bgDark === sw ? '#6366f1' : '#374151' }"
            @click="values.bgDark = sw"
          />
        </div>
      </div>
    </section>

    <!-- Typography -->
    <section class="border-b border-gray-200 dark:border-gray-800 p-4 space-y-4">
      <p class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Typography</p>

      <!-- Body font -->
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-gray-600 dark:text-gray-300">Body font</label>
        <select v-model="values.bodyFont" :class="SELECT_CLS">
          <option value="system">System default</option>
          <optgroup label="Sans-serif">
            <option value="Inter">Inter</option>
            <option value="Geist">Geist</option>
            <option value="DM Sans">DM Sans</option>
            <option value="Outfit">Outfit</option>
            <option value="Plus Jakarta Sans">Plus Jakarta Sans</option>
            <option value="Nunito">Nunito</option>
            <option value="Poppins">Poppins</option>
            <option value="Raleway">Raleway</option>
            <option value="Open Sans">Open Sans</option>
            <option value="Work Sans">Work Sans</option>
          </optgroup>
          <optgroup label="Serif">
            <option value="Lora">Lora</option>
            <option value="Merriweather">Merriweather</option>
            <option value="Playfair Display">Playfair Display</option>
            <option value="EB Garamond">EB Garamond</option>
          </optgroup>
          <optgroup label="Monospace">
            <option value="JetBrains Mono">JetBrains Mono</option>
            <option value="Fira Code">Fira Code</option>
          </optgroup>
        </select>
      </div>

      <!-- Heading font -->
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-gray-600 dark:text-gray-300">Heading font</label>
        <select v-model="values.headingFont" :class="SELECT_CLS">
          <option value="same">Same as body</option>
          <option value="system">System default</option>
          <optgroup label="Sans-serif">
            <option value="Inter">Inter</option>
            <option value="Geist">Geist</option>
            <option value="DM Sans">DM Sans</option>
            <option value="Outfit">Outfit</option>
            <option value="Plus Jakarta Sans">Plus Jakarta Sans</option>
            <option value="Nunito">Nunito</option>
            <option value="Poppins">Poppins</option>
            <option value="Raleway">Raleway</option>
            <option value="Open Sans">Open Sans</option>
            <option value="Work Sans">Work Sans</option>
          </optgroup>
          <optgroup label="Serif">
            <option value="Lora">Lora</option>
            <option value="Merriweather">Merriweather</option>
            <option value="Playfair Display">Playfair Display</option>
            <option value="EB Garamond">EB Garamond</option>
          </optgroup>
          <optgroup label="Monospace">
            <option value="JetBrains Mono">JetBrains Mono</option>
            <option value="Fira Code">Fira Code</option>
          </optgroup>
        </select>
      </div>

      <!-- Font size -->
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-gray-600 dark:text-gray-300">Body size</label>
        <div class="grid grid-cols-5 gap-1">
          <button
            v-for="s in fontSizeOptions"
            :key="s.value"
            class="py-1.5 rounded-md text-[11px] font-medium transition-colors"
            :class="values.fontSize === s.value ? BTN_ACTIVE : BTN_INACTIVE"
            @click="values.fontSize = s.value"
          >{{ s.label }}</button>
        </div>
      </div>

      <!-- Heading weight -->
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-gray-600 dark:text-gray-300">Heading weight</label>
        <select v-model="values.headingWeight" :class="SELECT_CLS">
          <option value="300">Light</option>
          <option value="400">Regular</option>
          <option value="500">Medium</option>
          <option value="600">Semibold</option>
          <option value="700">Bold</option>
          <option value="800">Extra Bold</option>
        </select>
      </div>

      <!-- Line spacing -->
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-gray-600 dark:text-gray-300">Line spacing</label>
        <div class="grid grid-cols-3 gap-1">
          <button
            v-for="l in lineHeightOptions"
            :key="l.value"
            class="py-1.5 rounded-md text-[11px] font-medium transition-colors"
            :class="values.lineHeight === l.value ? BTN_ACTIVE : BTN_INACTIVE"
            @click="values.lineHeight = l.value"
          >{{ l.label }}</button>
        </div>
      </div>
    </section>

    <!-- Shape -->
    <section class="border-b border-gray-200 dark:border-gray-800 p-4 space-y-3">
      <p class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Shape</p>
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-gray-600 dark:text-gray-300">Corner radius</label>
        <div class="grid grid-cols-3 gap-1.5">
          <button
            v-for="r in radiusOptions"
            :key="r.value"
            class="flex flex-col items-center gap-1.5 py-2.5 rounded-lg text-[10px] font-medium transition-colors"
            :class="values.borderRadius === r.value
              ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 ring-1 ring-inset ring-primary-400'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'"
            @click="values.borderRadius = r.value"
          >
            <div
              class="w-7 h-5 bg-current opacity-40"
              :style="{ borderRadius: r.preview }"
            />
            {{ r.label }}
          </button>
        </div>
      </div>
    </section>

    <!-- Layout -->
    <section class="p-4 space-y-4">
      <p class="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Layout</p>

      <!-- Spacing density -->
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-gray-600 dark:text-gray-300">Section spacing</label>
        <div class="grid grid-cols-3 gap-1">
          <button
            v-for="s in spacingOptions"
            :key="s.value"
            class="py-1.5 rounded-md text-[11px] font-medium transition-colors"
            :class="values.spacing === s.value ? BTN_ACTIVE : BTN_INACTIVE"
            @click="values.spacing = s.value"
          >{{ s.label }}</button>
        </div>
      </div>

      <!-- Content width -->
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-gray-600 dark:text-gray-300">Content width</label>
        <div class="grid grid-cols-2 gap-1.5">
          <button
            v-for="w in contentWidthOptions"
            :key="w.value"
            class="flex flex-col items-center gap-0.5 py-2 rounded-md text-[11px] font-medium transition-colors"
            :class="values.contentWidth === w.value
              ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 ring-1 ring-inset ring-primary-400'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'"
            @click="values.contentWidth = w.value"
          >
            {{ w.label }}
            <span class="text-[9px] opacity-60 font-mono">{{ w.sub }}</span>
          </button>
        </div>
      </div>
    </section>
  </aside>
</template>
