import { h } from 'vue'

/**
 * Header for a UTable column of row action buttons: "Actions" for screen readers,
 * visually hidden. Use it instead of an empty-string header — Nuxt UI renders one
 * differently on the server and the client, which caused a hydration mismatch
 * on every admin table page, and a nameless column is unlabelled for assistive tech.
 */
export const actionsHeader = () => h('span', { class: 'sr-only' }, 'Actions')
