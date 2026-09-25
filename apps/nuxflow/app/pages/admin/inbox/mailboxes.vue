<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })
useHead({ title: 'Inbox addresses' })

interface Mailbox {
  id: string
  localPart: string
  name: string
  forwardTo: string | null
  notify: boolean
  enabled: boolean
  siteAddress: string
  platformAddress: string | null
}
interface MailboxResponse {
  mailboxes: Mailbox[]
  setup: {
    siteDomain: string
    platformDomain: string | null
    handle: string | null
    emailProvider: string
    sendingBindingPresent: boolean
  }
}

const toast = useToast()
const { confirm } = useConfirm()

const { data, refresh } = await useFetch<MailboxResponse>('/api/v1/mailboxes')

const form = reactive({ localPart: '', name: '', forwardTo: '', notify: true })
const creating = ref(false)
const busyId = ref<string | null>(null)

const suggestions = [
  { localPart: 'contact', name: 'Contact' },
  { localPart: 'leads', name: 'Sales leads' },
  { localPart: 'support', name: 'Support' },
  { localPart: '*', name: 'Everything else (catch-all)' },
]
const unusedSuggestions = computed(() => suggestions.filter(s => !data.value?.mailboxes.some(m => m.localPart === s.localPart)))

function useSuggestion(s: { localPart: string; name: string }) {
  form.localPart = s.localPart
  form.name = s.name
}

async function create() {
  creating.value = true
  try {
    await $fetch('/api/v1/mailboxes', {
      method: 'POST',
      body: { localPart: form.localPart, name: form.name, forwardTo: form.forwardTo || null, notify: form.notify },
    })
    Object.assign(form, { localPart: '', name: '', forwardTo: '', notify: true })
    await refresh()
  }
  catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'Could not create the address'), color: 'error' })
  }
  finally {
    creating.value = false
  }
}

async function update(m: Mailbox, patch: Partial<Pick<Mailbox, 'name' | 'forwardTo' | 'notify' | 'enabled'>>) {
  busyId.value = m.id
  try {
    const url: string = `/api/v1/mailboxes/${m.id}`
    await $fetch(url, { method: 'PATCH', body: patch })
    await refresh()
  }
  catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'Update failed'), color: 'error' })
  }
  finally {
    busyId.value = null
  }
}

const editingForwardId = ref<string | null>(null)
const forwardDraft = ref('')

function startForwardEdit(m: Mailbox) {
  editingForwardId.value = m.id
  forwardDraft.value = m.forwardTo ?? ''
}

async function saveForward(m: Mailbox) {
  await update(m, { forwardTo: forwardDraft.value.trim() || null })
  editingForwardId.value = null
}

async function remove(m: Mailbox) {
  const ok = await confirm({
    title: `Delete ${m.siteAddress}?`,
    description: 'Mail sent to this address will stop arriving. Messages already received are kept but no longer shown under this address. To pause it instead, turn it off.',
    confirmLabel: 'Delete',
  })
  if (!ok) return
  busyId.value = m.id
  try {
    const url: string = `/api/v1/mailboxes/${m.id}`
    await $fetch(url, { method: 'DELETE' })
    await refresh()
  }
  catch (e: unknown) {
    toast.add({ title: getErrorMessage(e, 'Delete failed'), color: 'error' })
  }
  finally {
    busyId.value = null
  }
}

async function copy(text: string) {
  await navigator.clipboard.writeText(text)
  toast.add({ title: 'Copied', color: 'success' })
}
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6">
    <div>
      <UButton to="/admin/inbox" size="xs" variant="ghost" icon="i-lucide-arrow-left" class="mb-2">Inbox</UButton>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">Inbox addresses</h1>
      <p class="text-sm text-gray-500 mt-0.5">Addresses this site receives email at. New addresses work immediately — no DNS change per address.</p>
    </div>

    <UCard>
      <template #header><p class="text-sm font-semibold text-gray-900 dark:text-white">Addresses</p></template>
      <div v-if="!data?.mailboxes.length" class="text-sm text-gray-400 py-4">No addresses yet — add one below.</div>
      <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
        <li v-for="m in data.mailboxes" :key="m.id" class="py-3 flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 space-y-0.5">
            <p class="text-sm font-medium text-gray-900 dark:text-white">{{ m.name }}</p>
            <button class="text-sm text-primary-600 dark:text-primary-400 break-all text-left" @click="copy(m.siteAddress)">{{ m.siteAddress }}</button>
            <p v-if="m.platformAddress" class="text-xs text-gray-400 break-all">
              or <button class="underline decoration-dotted" @click="copy(m.platformAddress)">{{ m.platformAddress }}</button>
            </p>
            <div v-if="editingForwardId === m.id" class="flex flex-wrap items-center gap-2 pt-1">
              <UInput v-model="forwardDraft" type="email" size="xs" placeholder="you@gmail.com (empty = none)" class="w-64" />
              <UButton size="xs" :loading="busyId === m.id" @click="saveForward(m)">Save</UButton>
              <UButton size="xs" variant="ghost" @click="editingForwardId = null">Cancel</UButton>
            </div>
            <p v-else class="text-xs text-gray-400">
              <template v-if="m.forwardTo">Also forwarded to {{ m.forwardTo }} · </template>
              <button class="underline decoration-dotted" @click="startForwardEdit(m)">{{ m.forwardTo ? 'Change forwarding' : 'Add forwarding' }}</button>
            </p>
          </div>
          <div class="flex items-center gap-4 shrink-0">
            <USwitch :model-value="m.notify" label="Notify team" :disabled="busyId === m.id" @update:model-value="update(m, { notify: $event })" />
            <USwitch :model-value="m.enabled" label="On" :disabled="busyId === m.id" @update:model-value="update(m, { enabled: $event })" />
            <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :loading="busyId === m.id" @click="remove(m)" />
          </div>
        </li>
      </ul>
    </UCard>

    <UCard>
      <template #header><p class="text-sm font-semibold text-gray-900 dark:text-white">Add an address</p></template>
      <div class="space-y-4">
        <div v-if="unusedSuggestions.length" class="flex flex-wrap gap-2">
          <UButton v-for="s in unusedSuggestions" :key="s.localPart" size="xs" variant="soft" @click="useSuggestion(s)">
            {{ s.localPart === '*' ? 'Catch-all' : `${s.localPart}@` }}
          </UButton>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Address" hint="Use * to catch everything not matched by another address">
            <UInput v-model="form.localPart" placeholder="contact">
              <template #trailing><span class="text-xs text-gray-400">@{{ data?.setup.siteDomain }}</span></template>
            </UInput>
          </UFormField>
          <UFormField label="Label">
            <UInput v-model="form.name" placeholder="Contact" />
          </UFormField>
        </div>
        <UFormField label="Also forward to (optional)" hint="Must be a verified destination address in Cloudflare Email Routing">
          <UInput v-model="form.forwardTo" type="email" placeholder="you@gmail.com" />
        </UFormField>
        <UCheckbox v-model="form.notify" label="Notify editors and admins when mail arrives (email + push, per their notification settings)" />
      </div>
      <template #footer>
        <div class="flex justify-end">
          <UButton :loading="creating" :disabled="!form.localPart || !form.name" icon="i-lucide-plus" @click="create">Add address</UButton>
        </div>
      </template>
    </UCard>

    <UCard v-if="data">
      <template #header><p class="text-sm font-semibold text-gray-900 dark:text-white">Connecting your domain</p></template>
      <div class="space-y-5 text-sm text-gray-600 dark:text-gray-300">
        <div class="space-y-2">
          <p class="font-medium text-gray-900 dark:text-white">Receive at @{{ data.setup.siteDomain }}</p>
          <p>Needs {{ data.setup.siteDomain }} to be a domain in the same Cloudflare account as this site. It's a one-time step, done by whoever manages that account:</p>
          <ol class="list-decimal pl-5 space-y-1">
            <li>In the Cloudflare dashboard, open the domain → <strong>Email</strong> → <strong>Email Routing</strong> and enable it. Cloudflare adds the MX and SPF records.</li>
            <li>Under <strong>Routing rules</strong>, edit the <strong>Catch-all address</strong> rule: action <strong>Send to a Worker</strong>, destination <strong>this site's Worker</strong>, and enable it.</li>
          </ol>
          <UAlert color="warning" variant="soft" icon="i-lucide-triangle-alert" description="Email Routing takes over the domain's incoming mail (its MX records). If the domain already receives mail through Google Workspace, Microsoft 365 or similar, don't enable it — use the forwarding address below instead." />
        </div>

        <div v-if="data.setup.platformDomain && data.setup.handle" class="space-y-2">
          <p class="font-medium text-gray-900 dark:text-white">Or forward from your existing mailbox</p>
          <p>
            Every address also works as <code class="text-xs">{{ data.setup.handle }}+<em>address</em>@{{ data.setup.platformDomain }}</code>
            (the catch-all is <code class="text-xs">{{ data.setup.handle }}@{{ data.setup.platformDomain }}</code>). Set up a forward in your current email provider to that address — no DNS changes needed.
          </p>
        </div>

        <div class="space-y-2">
          <p class="font-medium text-gray-900 dark:text-white">Replying</p>
          <p v-if="data.setup.emailProvider === 'cloudflare'">
            Replies go out through Cloudflare Email from the address the message was sent to. That needs sending enabled for the domain too:
            <code class="text-xs">wrangler email sending enable {{ data.setup.siteDomain }}</code> (or Email Service → Email Sending → Onboard domain in the dashboard).
          </p>
          <p v-else-if="data.setup.emailProvider === 'console'">
            No email provider is configured, so replies can't be delivered yet. Choose one under <NuxtLink to="/admin/settings" class="text-primary-600 hover:underline">Settings → Email</NuxtLink>.
          </p>
          <p v-else>
            Replies go out through your configured email provider ({{ data.setup.emailProvider }}), which must be allowed to send from @{{ data.setup.siteDomain }}.
          </p>
        </div>
      </div>
    </UCard>
  </div>
</template>
