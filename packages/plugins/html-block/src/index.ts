import { definePlugin } from '@nuxflow/plugin-sdk'
import type { CanvasBlockDefinition } from '@nuxflow/plugin-canvas'

export { default as HtmlBlock } from './HtmlBlock.vue'

export const htmlBlockDefinition: CanvasBlockDefinition = {
  id: 'html-block/html',
  name: 'HTML',
  description: 'Raw HTML block — paste any HTML snippet directly onto the page',
  icon: 'i-lucide-code-xml',
  category: 'plugin',
  component: 'HtmlBlock',
  thumbnailColor: '#fef3c7',
  fields: [
    {
      key: 'html',
      label: 'HTML',
      type: 'textarea',
      rows: 10,
      placeholder: '<div class="my-widget">\n  <!-- your HTML here -->\n</div>',
    },
    { key: 'padding', label: 'Padding', type: 'spacing' },
  ],
  defaultProps: {
    html: '',
    padding: { top: 16, right: 16, bottom: 16, left: 16, unit: 'px' },
  },
}

export default definePlugin({
  id: 'html-block',
  name: 'HTML Block',
  version: '0.1.0',
  description: 'Raw HTML canvas block for embedding custom markup.',
})
