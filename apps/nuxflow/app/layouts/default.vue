<template>
  <div class="mesh-bg min-h-screen">
    <PublicSiteHeader />
    <main>
      <slot />
    </main>
    <ClientOnly><PublicCookieConsent /></ClientOnly>
  </div>
</template>
