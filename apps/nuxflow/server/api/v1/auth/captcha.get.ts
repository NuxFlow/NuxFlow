import { getSignInCaptcha } from '../../../utils/sign-in-captcha'

// The Turnstile site key the sign-in and forgot-password pages must show, or null when
// sign-in Turnstile is off (see sign-in-captcha.ts). Public: a site key is public by design.
export default defineEventHandler(async (event) => {
  const captcha = await getSignInCaptcha(event).catch(() => null)
  return { siteKey: captcha?.siteKey ?? null }
})
