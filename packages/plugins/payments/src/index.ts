import { definePlugin } from '@nuxflow/plugin-sdk'

export { default as Paywall } from './components/Paywall.vue'
export { default as MembershipsAdmin } from './components/MembershipsAdmin.vue'

export default definePlugin({
  id: 'payments',
  name: 'Payments & Memberships',
  version: '0.1.0',
  description: 'Accept payments and gate content via Stripe, Lemon Squeezy, or Paddle.',
  hooks: {
    async onInstall(ctx) {
      console.log(`[payments] Installed on site ${ctx.siteId}`)
    },
  },
  adminPages: [
    { path: '/admin/memberships', component: 'MembershipsAdmin', label: 'Memberships', icon: 'i-lucide-credit-card' },
  ],
})
