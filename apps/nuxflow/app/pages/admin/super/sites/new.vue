<script setup lang="ts">
import { normalizeDomain } from '#shared/lib/domain'
import { browserTimeZone } from '#shared/lib/site-locale'

definePageMeta({ layout: 'admin', middleware: ['auth'] })

const router = useRouter()

// Member pools a site can be created in (a hosting platform's extra Workers — Super Admin → Pools).
const { data: sitesData } = await useFetch<{ pools: string[] }>('/api/v1/admin/sites')
const HERE = '__control_panel__'
const placeItems = computed(() => [
  { label: 'This control panel', value: HERE },
  ...(sitesData.value?.pools ?? []).map(id => ({ label: `Pool: ${id}`, value: id })),
])

const form = reactive({
  name: '',
  domain: '',
  locale: 'en',
  timezone: 'UTC',
  place: HERE,
  ownerName: '',
  ownerEmail: '',
})
const inPool = computed(() => form.place !== HERE)
onMounted(() => { form.timezone = browserTimeZone() })

// The address as it will be stored (a pasted "https://Example.com/" becomes example.com),
// shown under the field so what's created is never a surprise.
const domain = computed(() => normalizeDomain(form.domain))
const domainHelp = computed(() => {
  if (!form.domain.trim()) return 'Just the address, e.g. myblog.com or blog.example.com'
  if (!domain.value) return undefined
  return `The site will be at https://${domain.value}`
})
const domainError = computed(() => form.domain.trim() && !domain.value ? "That isn't a valid domain, e.g. myblog.com" : undefined)
function tidyDomain() {
  if (domain.value) form.domain = domain.value
}

const saving = ref(false)
const error = ref('')
const setupUrl = ref('')
const poolResult = ref<{ poolId: string; pending: boolean; emailDelivery: { sent: boolean; reason?: string } } | null>(null)
const copied = ref(false)

// Not useAdminAction(): the outcome (setup link, or the owner's email status) is shown on the page, not a toast.
async function create() {
  saving.value = true
  error.value = ''
  try {
    if (inPool.value) {
      // A pool has no passwords to set up: the site is created ready to use, and its owner
      // gets an email (a set-password link for a new account).
      const res = await $fetch<{ id: string; domain: string; poolId: string; pending: boolean; emailDelivery: { sent: boolean; reason?: string } }>('/api/v1/admin/sites', {
        method: 'POST',
        body: {
          name: form.name,
          domain: domain.value,
          locale: form.locale,
          timezone: form.timezone,
          poolId: form.place,
          owner: { name: form.ownerName, email: form.ownerEmail },
        },
      })
      form.domain = res.domain
      poolResult.value = res
      return
    }
    const res = await $fetch<{ id: string; domain: string; setupToken: string }>('/api/v1/admin/sites', {
      method: 'POST',
      body: {
        name: form.name,
        domain: domain.value,
        locale: form.locale,
        timezone: form.timezone,
      },
    })
    setupUrl.value = `https://${res.domain}/setup?token=${res.setupToken}`
  } catch (e: unknown) {
    error.value = getErrorMessage(e, 'Failed to create site')
  } finally {
    saving.value = false
  }
}

async function copySetupUrl() {
  await navigator.clipboard.writeText(setupUrl.value)
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}

function done() {
  router.push('/admin/super/sites')
}

const canCreate = computed(() => !!form.name.trim() && !!domain.value && (!inPool.value || (!!form.ownerName && !!form.ownerEmail)))
</script>

<template>
  <div class="max-w-2xl space-y-6">
    <div class="flex items-center gap-3">
      <UButton to="/admin/super/sites" variant="ghost" icon="i-lucide-arrow-left" size="sm" />
      <h1 class="text-xl font-bold text-gray-900 dark:text-white">New Site</h1>
    </div>

    <template v-if="setupUrl">
      <UCard>
        <template #header>
          <p class="text-sm font-semibold text-gray-900 dark:text-white">Site created</p>
        </template>
        <div class="space-y-3">
          <p class="text-sm text-gray-500">
            Send this one-time setup link to whoever will configure the site. It only works once, and it's shown here only this one time — it can't be retrieved again if lost.
          </p>
          <div class="flex items-center gap-2">
            <UInput :model-value="setupUrl" readonly class="flex-1 font-mono text-xs" />
            <UButton :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'" variant="soft" @click="copySetupUrl">
              {{ copied ? 'Copied' : 'Copy' }}
            </UButton>
          </div>
        </div>
      </UCard>
      <div class="flex justify-end">
        <UButton @click="done">Done</UButton>
      </div>
    </template>

    <template v-else-if="poolResult">
      <UCard>
        <template #header>
          <p class="text-sm font-semibold text-gray-900 dark:text-white">Site created in pool {{ poolResult.poolId }}</p>
        </template>
        <div class="space-y-3 text-sm text-gray-500">
          <p>
            <strong class="text-gray-900 dark:text-white">{{ form.name }}</strong> is ready at {{ form.domain }}, with {{ form.ownerEmail }}
            {{ poolResult.pending ? 'invited as its admin (they become admin once they confirm their email address)' : 'as its admin' }}.
            Visitors reach it within about a minute, once the front-door router routes nuxflow.site addresses.
          </p>
          <UAlert
            v-if="!poolResult.emailDelivery.sent"
            color="warning"
            variant="soft"
            icon="i-lucide-mail-warning"
            :description="`The email to the owner wasn't sent: ${poolResult.emailDelivery.reason ?? 'unknown reason'}`"
          />
          <p v-else>The owner has been emailed.</p>
        </div>
      </UCard>
      <div class="flex justify-end">
        <UButton @click="done">Done</UButton>
      </div>
    </template>

    <template v-else>
      <UCard>
        <template #header>
          <p class="text-sm font-semibold text-gray-900 dark:text-white">Site details</p>
        </template>
        <div class="space-y-4">
          <UFormField label="Site name" required>
            <UInput v-model="form.name" placeholder="My Blog" class="w-full" />
          </UFormField>
          <UFormField label="Domain" required :help="domainHelp" :error="domainError">
            <UInput
              v-model="form.domain"
              placeholder="myblog.com"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              class="w-full"
              @blur="tidyDomain"
            />
          </UFormField>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UFormField label="Default language" help="The language the site's pages are written in">
              <SiteLanguageSelect v-model="form.locale" />
            </UFormField>
            <UFormField label="Timezone">
              <SiteTimezoneSelect v-model="form.timezone" />
            </UFormField>
          </div>
          <UFormField
            v-if="placeItems.length > 1"
            label="Where"
            help="A pool keeps a client's site on its own Worker and database (Super Admin → Pools)."
          >
            <USelect v-model="form.place" :items="placeItems" class="w-full" />
          </UFormField>
        </div>
      </UCard>

      <UCard v-if="inPool">
        <template #header>
          <p class="text-sm font-semibold text-gray-900 dark:text-white">Owner</p>
        </template>
        <div class="space-y-4">
          <p class="text-sm text-gray-500">
            The site is created ready to use, with this person as its admin. A new account gets an email to set a password;
            an existing one gets a "your site is ready" email.
          </p>
          <div class="grid grid-cols-2 gap-4">
            <UFormField label="Name" required>
              <UInput v-model="form.ownerName" />
            </UFormField>
            <UFormField label="Email" required>
              <UInput v-model="form.ownerEmail" type="email" />
            </UFormField>
          </div>
        </div>
      </UCard>

      <UAlert v-if="error" color="error" variant="soft" :description="error" />

      <div class="flex justify-end">
        <UButton :loading="saving" :disabled="!canCreate" @click="create">
          Create site
        </UButton>
      </div>
    </template>
  </div>
</template>
