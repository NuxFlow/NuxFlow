<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import type { SpacingValue } from '../types'

declare const useState: <T>(key: string, init?: () => T) => { value: T }
declare const useRequestEvent: () => unknown

const props = withDefaults(defineProps<{
  text?: string
  acceptLabel?: string
  declineLabel?: string
  policyLabel?: string
  policyUrl?: string
  bgColor?: string
  textColor?: string
  btnColor?: string
  padding?: SpacingValue
  targeting?: 'everyone' | 'gdpr-only'
  showPreferences?: boolean
  preferencesLabel?: string
}>(), {
  text: 'We use cookies to improve your experience and analyze site traffic.',
  acceptLabel: 'Accept All',
  declineLabel: 'Decline Essential Only',
  policyLabel: 'Privacy Policy',
  policyUrl: '/privacy',
  bgColor: '#0f172a',
  textColor: '#ffffff',
  btnColor: '#00dc82',
  targeting: 'gdpr-only',
  showPreferences: true,
  preferencesLabel: 'Manage Preferences',
  padding: undefined,
})

const isVisible = ref(false)
const showDetails = ref(false)

const consentCategories = ref({
  necessary: true,
  analytics: false,
  marketing: false,
})

// Geolocation state serialized from server SSR to client hydration
const isGdprZone = useState('is-gdpr-zone', () => {
  if ((import.meta as any).server) {
    const event = useRequestEvent() as { node: { req: { headers: Record<string, string | string[] | undefined> } } } | null
    if (event) {
      const headers = event.node.req.headers
      const country = (headers['cf-ipcountry'] || headers['CF-IPCountry'] || 'US') as string
      const gdprCountries = [
        'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'GB', 'IS', 'LI', 'NO', 'CH'
      ]
      return gdprCountries.includes(country.toUpperCase())
    }
  }
  return true
})

onMounted(() => {
  const consent = localStorage.getItem('nuxflow-cookie-consent')
  if (consent) {
    try {
      const parsed = JSON.parse(consent)
      if (parsed && typeof parsed === 'object') {
        consentCategories.value = {
          necessary: true,
          analytics: !!parsed.analytics,
          marketing: !!parsed.marketing,
        }
        return // Already consented, keep hidden
      }
    } catch {
      // Invalid format, prompt again
    }
  }

  // Check geolocation targeting before showing the banner
  if (props.targeting === 'everyone' || isGdprZone.value) {
    isVisible.value = true
  }
})

function saveConsent(analytics: boolean, marketing: boolean) {
  const consentObj = {
    necessary: true,
    analytics,
    marketing,
    timestamp: new Date().toISOString(),
  }
  localStorage.setItem('nuxflow-cookie-consent', JSON.stringify(consentObj))
  
  // Save categories to cookies for cross-origin or server-side access
  document.cookie = `nuxflow-consent-analytics=${analytics ? '1' : '0'}; path=/; max-age=31536000; SameSite=Lax`
  document.cookie = `nuxflow-consent-marketing=${marketing ? '1' : '0'}; path=/; max-age=31536000; SameSite=Lax`
  
  // Emit custom event
  window.dispatchEvent(new CustomEvent('nuxflow-cookie-consent', { detail: consentObj }))
  
  isVisible.value = false
  showDetails.value = false
}

function accept() {
  saveConsent(true, true)
}

function decline() {
  saveConsent(false, false)
}

function savePreferences() {
  saveConsent(consentCategories.value.analytics, consentCategories.value.marketing)
}

const wrapperStyle = computed(() => {
  const p = props.padding
  return {
    backgroundColor: props.bgColor,
    color: props.textColor,
    padding: p ? `${p.top}${p.unit} ${p.right}${p.unit} ${p.bottom}${p.unit} ${p.left}${p.unit}` : '16px 24px',
  }
})
</script>

<template>
  <div v-if="isVisible" class="canvas-gdpr fixed bottom-0 left-0 right-0 z-50 shadow-2xl transition-transform duration-500 ease-out translate-y-0" :style="wrapperStyle">
    <div class="max-w-7xl mx-auto flex flex-col items-center justify-between gap-4">
      <div class="w-full flex flex-col sm:flex-row items-center justify-between gap-4">
        <div class="text-sm flex-1 opacity-90 leading-relaxed text-center sm:text-left">
          {{ text }}
          <a v-if="policyLabel" :href="policyUrl" class="underline underline-offset-2 opacity-80 hover:opacity-100 transition-opacity ml-1 whitespace-nowrap">
            {{ policyLabel }}
          </a>
        </div>
        <div class="flex items-center gap-3 w-full sm:w-auto shrink-0 justify-center flex-wrap sm:flex-nowrap">
          <button
            v-if="declineLabel"
            class="px-4 py-2 text-xs font-semibold rounded-lg border border-white/20 hover:bg-white/10 transition-colors whitespace-nowrap"
            :style="{ color: textColor }"
            @click="decline"
          >
            {{ declineLabel }}
          </button>
          <button
            v-if="showPreferences"
            class="px-4 py-2 text-xs font-semibold rounded-lg border border-white/20 hover:bg-white/10 transition-colors whitespace-nowrap"
            :style="{ color: textColor }"
            @click="showDetails = !showDetails"
          >
            {{ preferencesLabel || 'Manage Preferences' }}
          </button>
          <button
            class="px-5 py-2 text-xs font-bold rounded-lg shadow-lg hover:scale-105 transition-transform whitespace-nowrap"
            :style="{ backgroundColor: btnColor, color: '#030712' }"
            @click="accept"
          >
            {{ acceptLabel }}
          </button>
        </div>
      </div>

      <!-- Preferences settings tray -->
      <div v-if="showDetails" class="w-full mt-4 pt-4 border-t border-white/10 flex flex-col gap-4 text-xs">
        <p class="opacity-80">Choose which cookies you allow us to set. Necessary cookies are always enabled.</p>
        <div class="flex flex-wrap gap-4 items-center">
          <label class="flex items-center gap-2 cursor-not-allowed opacity-80">
            <input type="checkbox" checked disabled class="accent-primary-500 rounded">
            <span>Necessary (Required)</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer hover:opacity-100 transition-opacity">
            <input v-model="consentCategories.analytics" type="checkbox" class="accent-primary-500 rounded">
            <span>Analytics & Statistics</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer hover:opacity-100 transition-opacity">
            <input v-model="consentCategories.marketing" type="checkbox" class="accent-primary-500 rounded">
            <span>Marketing & Retargeting</span>
          </label>
        </div>
        <div class="flex justify-end gap-2">
          <button
            class="px-3 py-1.5 rounded border border-white/20 hover:bg-white/10 transition-colors"
            @click="showDetails = false"
          >
            Cancel
          </button>
          <button
            class="px-4 py-1.5 font-bold rounded shadow hover:scale-105 transition-transform"
            :style="{ backgroundColor: btnColor, color: '#030712' }"
            @click="savePreferences"
          >
            Save Choices
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
