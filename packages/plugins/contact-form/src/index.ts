import { definePlugin } from '@nuxflow/plugin-sdk'
import type { CanvasBlockDefinition } from '@nuxflow/plugin-canvas'

export { default as ContactFormBlock } from './components/ContactFormBlock.vue'
export { default as ContactFormAdmin } from './components/ContactFormAdmin.vue'

export const contactFormBlockDefinition: CanvasBlockDefinition = {
  id: 'contact-form/form',
  name: 'Contact Form',
  description: 'Embed a contact form with customisable title, description, and button text.',
  icon: 'i-lucide-mail',
  category: 'plugin',
  component: 'ContactFormBlock',
  thumbnailColor: '#ecfdf5',
  fields: [
    { key: 'title', label: 'Form Title', type: 'text', placeholder: 'Get in touch' },
    { key: 'description', label: 'Description', type: 'textarea', placeholder: 'Send us a message and we\'ll get back to you.' },
    { key: 'submitLabel', label: 'Submit button label', type: 'text', placeholder: 'Send message' },
    { key: 'bgColor', label: 'Background colour', type: 'color' },
    { key: 'textColor', label: 'Text colour', type: 'color' },
    { key: 'padding', label: 'Padding', type: 'spacing' },
  ],
  defaultProps: {
    title: 'Get in touch',
    description: 'Send us a message and we\'ll get back to you.',
    submitLabel: 'Send message',
    padding: { top: 48, right: 24, bottom: 48, left: 24, unit: 'px' },
  },
}

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
