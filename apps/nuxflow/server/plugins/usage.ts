import { countUsage } from '../utils/usage'

// Counts server renders per site (server/utils/usage.ts) — every page Nuxt builds on the
// server, which is a page-cache miss or a page that's never cached (admin, signed-in
// visitors). Rendering is most of a request's CPU time, which a Worker can't measure
// itself, so this is the stand-in for it.
export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('render:response', (_response, { event }) => {
    countUsage(event, 'renders')
  })
})
