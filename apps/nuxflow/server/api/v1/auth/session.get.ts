// Narrow SSR-hydration bridge for app/middleware/session.global.ts. Deliberately
// outside /api/auth/** so server/middleware/04.auth-override.ts never intercepts
// it — this returns a small { user } contract we control, backed by the same
// getAuthSession(event) every other server route already uses, rather than
// round-tripping through Better Auth's own HTTP handler for a same-process call.
export default defineEventHandler(async (event) => {
  const session = await getAuthSession(event)
  return { user: session?.user ?? null }
})
