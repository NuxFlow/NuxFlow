import type { InjectionKey } from 'vue'

/**
 * The id of the block being rendered on a public page. Provided by the app's public block
 * renderer (NuxBlockResolved.vue) and inject()ed by blocks that need to point back at
 * themselves — the Gallery's download links name their block so the server can find it.
 * Not provided inside the editor, so such features stay off there.
 */
export const blockIdKey: InjectionKey<string> = Symbol('nuxflow:block-id')
