import type { Page } from '@playwright/test'

/**
 * Waits until Nuxt has hydrated the page. Until then the server-rendered HTML is on
 * screen but inert: a click on a plain `@click` button does nothing, and text typed into
 * a `v-model` input shows up in the box but never reaches the component's state (it's
 * dropped when Vue takes over). `goto()` resolving on the `load` event is no guarantee —
 * a page with async `setup()` hydrates after it — so a test that types or clicks straight
 * away fails only when the machine is slow. Nuxt sets `isHydrating` to false once the
 * whole page, async parts included, is live.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const app = (document.querySelector('#__nuxt') as { __vue_app__?: { $nuxt?: { isHydrating?: boolean } } } | null)?.__vue_app__
    return app?.$nuxt?.isHydrating === false
  })
}

/** `page.goto()`, then wait until the page is interactive. */
export async function gotoHydrated(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await waitForHydration(page)
}
