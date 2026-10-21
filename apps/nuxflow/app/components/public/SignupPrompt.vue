<script setup lang="ts">
import { CONSENT_EVENT, readConsentCookie } from '@nuxflow/canvas/consent'
import {
  isBuiltInExcludedPath,
  isExcludedPath,
  isSuppressed,
  SIGNUP_SESSION_KEY,
  SIGNUP_STORAGE_KEY,
  type PublicSignupSettings,
  type SignupVisitorState,
} from '#shared/lib/signup-prompt'

// The mailing-list signup popup (Admin → Mailing list → Signup popup). Rendered inside
// <ClientOnly> by layouts/default.vue, so cached page HTML never contains it and every
// visitor gets the same cached page. Visitor memory lives in localStorage/sessionStorage
// rather than a cookie, because any cookie turns the page cache off (page-cache.ts).
//
// The rules that keep it from being the usual nuisance:
// - never for signed-in visitors, people who already signed up, or on excluded pages
// - not until the cookie banner has been answered, so the two never stack
// - "engaged" trigger by default: half-way down a page, or on the second page viewed
// - on phones it's always a small bar at the bottom, never a full-screen takeover
// - closing it keeps it away for `hideDays`

const { data: site } = useFetch<{
  signup?: PublicSignupSettings
  turnstileSiteKey?: string | null
}>('/api/public/site', {
  key: 'nuxflow-public-site',
  headers: useRequestHeaders(['host']),
})

const { loggedIn } = useUserSession()
const route = useRoute()

const settings = computed(() => site.value?.signup)
const open = ref(false)
const subscribed = ref(false)
const isMobile = ref(false)
const headingId = useId()

let cleanupTrigger: (() => void) | null = null

function readState(): SignupVisitorState {
  try {
    const raw = localStorage.getItem(SIGNUP_STORAGE_KEY)
    return raw ? JSON.parse(raw) as SignupVisitorState : {}
  }
  catch {
    return {}
  }
}

function writeState(patch: Partial<SignupVisitorState>) {
  try {
    localStorage.setItem(SIGNUP_STORAGE_KEY, JSON.stringify({ ...readState(), ...patch }))
  }
  catch {
    // Storage blocked — nothing to remember with.
  }
}

interface SessionState { pageViews: number; counted: boolean }

function readSession(): SessionState {
  try {
    const raw = sessionStorage.getItem(SIGNUP_SESSION_KEY)
    return raw ? { pageViews: 0, counted: false, ...JSON.parse(raw) } : { pageViews: 0, counted: false }
  }
  catch {
    return { pageViews: 0, counted: false }
  }
}

function writeSession(state: SessionState) {
  try {
    sessionStorage.setItem(SIGNUP_SESSION_KEY, JSON.stringify(state))
  }
  catch {
    // Storage blocked.
  }
}

function track(type: 'shown' | 'dismissed') {
  $fetch('/api/public/mailing-list/event', { method: 'POST', body: { type } }).catch(() => {})
}

function eligible(): boolean {
  const s = settings.value
  if (!s?.popupEnabled || loggedIn.value || open.value) return false
  if (isBuiltInExcludedPath(route.path) || isExcludedPath(route.path, s.excludePaths)) return false
  if (isMobile.value && !s.showOnMobile) return false
  return !isSuppressed(readState(), s.hideDays)
}

function show() {
  stopTrigger()
  if (!eligible()) return
  open.value = true
  const session = readSession()
  if (!session.counted) {
    writeSession({ ...session, counted: true })
    track('shown')
  }
}

function close() {
  if (!open.value) return
  open.value = false
  if (subscribed.value) return
  writeState({ dismissedAt: Date.now() })
  track('dismissed')
}

function stopTrigger() {
  cleanupTrigger?.()
  cleanupTrigger = null
}

function armEngaged(s: PublicSignupSettings): () => void {
  // Second page this session: give the visitor a moment to start reading first.
  if (readSession().pageViews >= 2) {
    const t = window.setTimeout(show, 4000)
    return () => window.clearTimeout(t)
  }
  const onScroll = () => {
    const doc = document.documentElement
    const scrollable = doc.scrollHeight - window.innerHeight
    if (scrollable <= 0) return
    if ((window.scrollY / scrollable) * 100 >= s.scrollPercent) show()
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  return () => window.removeEventListener('scroll', onScroll)
}

function armExit(s: PublicSignupSettings): () => void {
  // Exit intent needs a mouse; touch screens fall back to the engaged trigger.
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return armEngaged(s)
  const onLeave = (e: MouseEvent) => {
    if (!e.relatedTarget && e.clientY <= 0) show()
  }
  document.addEventListener('mouseout', onLeave)
  return () => document.removeEventListener('mouseout', onLeave)
}

function arm() {
  stopTrigger()
  const s = settings.value
  if (!s || !eligible()) return
  if (s.trigger === 'exit') cleanupTrigger = armExit(s)
  else if (s.trigger === 'delay') {
    const t = window.setTimeout(show, s.delaySeconds * 1000)
    cleanupTrigger = () => window.clearTimeout(t)
  }
  else cleanupTrigger = armEngaged(s)
}

function onPage() {
  const session = readSession()
  writeSession({ ...session, pageViews: session.pageViews + 1 })
  // Moving to an excluded page (checkout, say) hides an open popup without counting it as closed.
  if (open.value && settings.value && (isBuiltInExcludedPath(route.path) || isExcludedPath(route.path, settings.value.excludePaths))) {
    open.value = false
  }
  waitForConsent(arm)
}

let consentListener: (() => void) | null = null

function waitForConsent(then: () => void) {
  if (readConsentCookie()) {
    then()
    return
  }
  if (consentListener) window.removeEventListener(CONSENT_EVENT, consentListener)
  consentListener = () => {
    window.removeEventListener(CONSENT_EVENT, consentListener!)
    consentListener = null
    then()
  }
  window.addEventListener(CONSENT_EVENT, consentListener)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value && !useModal.value) close()
}

let mobileQuery: MediaQueryList | null = null
const onMobileChange = () => { isMobile.value = !!mobileQuery?.matches }

onMounted(() => {
  mobileQuery = window.matchMedia('(max-width: 640px)')
  onMobileChange()
  mobileQuery.addEventListener('change', onMobileChange)
  window.addEventListener('keydown', onKeydown)
  onPage()
})

watch(() => route.path, () => onPage())
watch(settings, () => waitForConsent(arm))

onBeforeUnmount(() => {
  stopTrigger()
  mobileQuery?.removeEventListener('change', onMobileChange)
  window.removeEventListener('keydown', onKeydown)
  if (consentListener) window.removeEventListener(CONSENT_EVENT, consentListener)
})

// Phones always get the small bottom bar, whatever style is chosen.
const useModal = computed(() => settings.value?.style === 'modal' && !isMobile.value)

const modalOpen = computed({
  get: () => open.value && useModal.value,
  set: (v: boolean) => { if (!v) close() },
})

function onSubscribed() {
  subscribed.value = true
}
</script>

<template>
  <template v-if="settings">
    <UModal
      v-if="useModal"
      v-model:open="modalOpen"
      :title="settings.heading"
      :description="settings.body || undefined"
      class="nuxflow-signup nuxflow-signup--modal"
    >
      <template #body>
        <div class="space-y-4">
          <img v-if="settings.imageUrl" :src="settings.imageUrl" alt="" class="w-full max-h-48 object-cover rounded-lg">
          <SignupForm
            :settings="settings"
            source="popup"
            :turnstile-site-key="site?.turnstileSiteKey"
            @subscribed="onSubscribed"
          />
        </div>
      </template>
    </UModal>

    <Transition
      v-else
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="translate-y-6 opacity-0"
      leave-active-class="transition duration-200 ease-in"
      leave-to-class="translate-y-6 opacity-0"
    >
      <div
        v-if="open"
        role="dialog"
        aria-modal="false"
        :aria-labelledby="headingId"
        class="nuxflow-signup nuxflow-signup--slide-in fixed z-50 bottom-0 inset-x-0 sm:bottom-4 sm:right-4 sm:left-auto sm:w-96 bg-white dark:bg-gray-900 text-gray-900 dark:text-white border-t sm:border border-gray-200 dark:border-gray-700 sm:rounded-xl shadow-xl"
      >
        <img v-if="settings.imageUrl && !isMobile" :src="settings.imageUrl" alt="" class="w-full h-32 object-cover sm:rounded-t-xl">
        <div class="p-4 space-y-3">
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <p :id="headingId" class="font-semibold">{{ settings.heading }}</p>
              <p v-if="settings.body" class="text-sm text-gray-600 dark:text-gray-400 mt-1">{{ settings.body }}</p>
            </div>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="sm"
              aria-label="Close"
              @click="close"
            />
          </div>
          <SignupForm
            :settings="settings"
            source="popup"
            :turnstile-site-key="site?.turnstileSiteKey"
            @subscribed="onSubscribed"
          />
        </div>
      </div>
    </Transition>
  </template>
</template>
