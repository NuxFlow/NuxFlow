// Populate the module-level D1 singleton on every request, including auth routes
// that multi-site.ts skips. This ensures better-auth.ts can access D1 via useDb()
// before the auth instance is created and cached.
export default defineEventHandler((event) => {
  useDb(event)
})
