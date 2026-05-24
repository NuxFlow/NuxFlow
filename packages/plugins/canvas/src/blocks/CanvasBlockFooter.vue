<script setup lang="ts">
import { computed } from 'vue'
import type { SpacingValue } from '../types'

declare const useFetch: <T = any>(url: string | (() => string), options?: any) => any
declare const useRequestHeaders: any

const props = withDefaults(defineProps<{
  logoText?: string
  logoIcon?: string
  description?: string
  col1Title?: string
  col1Links?: string // JSON string array of links
  col2Title?: string
  col2Links?: string // JSON string array of links
  copyrightText?: string
  bgColor?: string
  textColor?: string
  padding?: SpacingValue
}>(), {
  logoText: 'My Site',
  logoIcon: 'i-lucide-globe',
  description: 'A beautiful website built on our custom block platform.',
  col1Title: 'Links',
  col1Links: '[{"label":"Home","url":"/"},{"label":"About","url":"/about"}]',
  col2Title: 'Support',
  col2Links: '[{"label":"Contact","url":"/contact"},{"label":"Privacy","url":"/privacy"}]',
  copyrightText: '© 2026 My Site. All rights reserved.',
  bgColor: '#0f172a',
  textColor: '#9ca3af',
})

interface SitePublic {
  name: string
  domain: string
}

const { data: site } = await useFetch<SitePublic>('/api/public/site', {
  headers: useRequestHeaders(['host']),
})

const displayLogoText = computed(() => {
  if (props.logoText && props.logoText !== 'My Site') {
    return props.logoText
  }
  return site.value?.name ?? 'My Site'
})

const displayCopyright = computed(() => {
  if (props.copyrightText && props.copyrightText !== '© 2026 My Site. All rights reserved.') {
    return props.copyrightText
  }
  const year = new Date().getFullYear()
  const siteName = site.value?.name ?? 'My Site'
  return `© ${year} ${siteName}. All rights reserved.`
})

const parsedCol1 = computed(() => {
  try { return JSON.parse(props.col1Links) } catch { return [] }
})
const parsedCol2 = computed(() => {
  try { return JSON.parse(props.col2Links) } catch { return [] }
})

const wrapperStyle = computed(() => {
  const p = props.padding
  return {
    backgroundColor: props.bgColor,
    color: props.textColor,
    padding: p ? `${p.top}${p.unit} ${p.right}${p.unit} ${p.bottom}${p.unit} ${p.left}${p.unit}` : '48px 24px 24px 24px',
  }
})
</script>

<template>
  <footer class="canvas-footer border-t border-white/5" :style="wrapperStyle">
    <div class="footer-container">
      <div class="footer-main">
        <div class="brand-section">
          <div class="logo-wrap">
            <div v-if="logoIcon" class="logo-icon-bg">
              <span :class="logoIcon" class="logo-icon"></span>
            </div>
            <span class="logo-text">{{ displayLogoText }}</span>
          </div>
          <p class="brand-desc">{{ description }}</p>
        </div>
        
        <div class="links-section">
          <div class="links-column">
            <h4 class="column-title">{{ col1Title }}</h4>
            <ul class="links-list">
              <li v-for="(link, i) in parsedCol1" :key="i">
                <a :href="link.url" class="footer-link">{{ link.label }}</a>
              </li>
            </ul>
          </div>

          <div class="links-column">
            <h4 class="column-title">{{ col2Title }}</h4>
            <ul class="links-list">
              <li v-for="(link, i) in parsedCol2" :key="i">
                <a :href="link.url" class="footer-link">{{ link.label }}</a>
              </li>
            </ul>
          </div>
        </div>
      </div>
      
      <div class="footer-bottom">
        <div class="copyright">{{ displayCopyright }}</div>
        <div class="attribution">
          <span class="i-lucide-zap attribution-icon"></span>
          Built on NuxFlow CMS
        </div>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.footer-container {
  max-width: 80rem; /* 1280px */
  margin-left: auto;
  margin-right: auto;
}

.footer-main {
  display: flex;
  flex-direction: column;
  gap: 3rem;
  margin-bottom: 2.5rem; /* mb-10 equivalent */
}

.brand-section {
  flex: 1;
  max-width: 24rem; /* max-w-sm equivalent */
}

.logo-wrap {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.logo-icon-bg {
  width: 2rem;
  height: 2rem;
  border-radius: 0.5rem;
  background-color: rgba(0, 220, 130, 0.15); /* primary-500/20 equivalent */
  display: flex;
  align-items: center;
  justify-content: center;
}

.logo-icon {
  width: 1.25rem;
  height: 1.25rem;
  color: #00dc82; /* primary-500 equivalent */
}

.logo-text {
  font-size: 1.25rem;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: -0.025em;
}

.brand-desc {
  font-size: 0.875rem;
  line-height: 1.625;
  opacity: 0.8;
}

.links-section {
  display: flex;
  gap: 4rem; /* gap-16 equivalent */
}

.links-column {
  min-width: 8rem;
}

.column-title {
  color: #ffffff;
  font-weight: 600;
  margin-bottom: 1rem;
}

.links-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.footer-link {
  font-size: 0.875rem;
  color: inherit;
  text-decoration: none;
  transition: color 0.2s ease;
  opacity: 0.85;
}

.footer-link:hover {
  color: #ffffff;
  opacity: 1;
}

.footer-bottom {
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding-top: 1.5rem; /* pt-6 equivalent */
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.copyright {
  font-size: 0.875rem;
  opacity: 0.6;
}

.attribution {
  font-size: 0.75rem;
  opacity: 0.6;
  display: flex;
  align-items: center;
  gap: 0.375rem;
  background-color: rgba(255, 255, 255, 0.05);
  padding: 0.375rem 0.75rem;
  border-radius: 9999px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.attribution-icon {
  width: 0.75rem;
  height: 0.75rem;
  color: #00dc82;
}

@media (min-width: 768px) {
  .footer-main {
    flex-direction: row;
    justify-content: space-between;
    gap: 2rem;
  }
  
  .links-section {
    gap: 6rem; /* gap-24 equivalent */
  }
  
  .footer-bottom {
    flex-direction: row;
    gap: 1rem;
  }
}
</style>
