export default defineEventHandler((event) => {
  const query = getQuery(event)
  const themeId = query.__theme_id as string | undefined

  if (themeId) {
    // Set preview cookie for this session
    setCookie(event, '__nuxflow_theme_preview', themeId, {
      httpOnly: false,
      maxAge: 3600,
      path: '/',
    })
    event.context.themePreviewId = themeId
  } else {
    const preview = getCookie(event, '__nuxflow_theme_preview')
    if (preview) event.context.themePreviewId = preview
  }
})
