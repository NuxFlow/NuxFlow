import { definePlugin } from '@nuxflow/plugin-sdk'

export { default as ContactFormBlock } from './components/ContactFormBlock.vue'
export { default as ContactFormAdmin } from './components/ContactFormAdmin.vue'

export default definePlugin({
  id: 'contact-form',
  name: 'Contact Form',
  version: '0.1.0',
  description: 'Embed contact forms on any page with spam protection via Cloudflare Turnstile.',
  hooks: {
    async onInstall(ctx) {
      console.log(`[contact-form] Installed on site ${ctx.siteId}`)
    },
  },
  adminPages: [
    { path: '/admin/plugins/contact-form', component: 'ContactFormAdmin', label: 'Contact Forms', icon: 'i-lucide-mail' },
  ],
})
