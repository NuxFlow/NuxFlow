// Populate the module-level D1 singleton on every request, including auth routes
// that multi-site.ts skips. This ensures auth.config.ts can access D1 via getD1()
// before the auth instance is created and cached.
export default defineEventHandler((event) => {
  useDb(event)
})
