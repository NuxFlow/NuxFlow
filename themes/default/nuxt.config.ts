import { defineNuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({
  // NuxFlow Default Theme
  // Provides block renderers, default layouts, and base styles.
  // Extends the host NuxFlow app — does not run standalone.
  components: [{ path: './components', pathPrefix: false }],
  css: ['./assets/css/theme.css'],
})
