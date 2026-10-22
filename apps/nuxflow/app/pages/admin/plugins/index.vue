<script setup lang="ts">
import { describePermission } from '#shared/lib/plugin-permissions'

definePageMeta({ layout: 'admin', middleware: ['auth'] })

const { run, isRunning, toast } = useAdminAction()

// Dynamic plugins
interface DynamicPlugin {
  id: string
  name: string
  version: string
  description: string
  isActive: boolean
  hasServer: boolean
  hasClient: boolean
  installedAt: string
  permissions: string[]
  grantedPermissions: string[]
  hasSettings: boolean
  needsApproval: boolean
}

const { data: dynData, refresh: refreshDyn } = await useFetch<{ plugins: DynamicPlugin[] }>('/api/v1/dynamic-plugins')
const dynItems = computed(() => dynData.value?.plugins ?? [])

const installModal = ref(false)
const installForm = reactive({
  id: '',
  name: '',
  version: '',
  description: '',
  serverModule: '',
  serverChecksum: '',
  clientBundle: '',
  clientChecksum: '',
  blockDefinitions: '',
  definitionsChecksum: '',
  capabilities: '',
  capabilitiesChecksum: '',
  publisherPublicKey: '',
  signature: '',
})

const jsonPayloadText = ref('')

function handlePasteJson() {
  try {
    const parsed = JSON.parse(jsonPayloadText.value)
    if (!parsed.id) {
      toast.add({ title: 'Invalid JSON: id is required', color: 'error' })
      return
    }
    installForm.id = parsed.id || ''
    installForm.name = parsed.name || ''
    installForm.version = parsed.version || ''
    installForm.description = parsed.description || ''
    installForm.serverModule = parsed.serverModule || ''
    installForm.serverChecksum = parsed.serverChecksum || ''
    installForm.clientBundle = parsed.clientBundle || ''
    installForm.clientChecksum = parsed.clientChecksum || ''
    installForm.blockDefinitions = parsed.blockDefinitions || ''
    installForm.definitionsChecksum = parsed.definitionsChecksum || ''
    installForm.capabilities = parsed.capabilities || ''
    installForm.capabilitiesChecksum = parsed.capabilitiesChecksum || ''
    installForm.publisherPublicKey = parsed.publisherPublicKey || ''
    installForm.signature = parsed.signature || ''
    toast.add({ title: 'Plugin payload parsed successfully!', color: 'success' })
  } catch (e: unknown) {
    toast.add({
      title: 'Invalid JSON: could not parse plugin payload',
      description: e instanceof Error ? e.message : undefined,
      color: 'error',
    })
  }
}

async function dynInstall() {
  await run(async () => {
    await $fetch<unknown>('/api/v1/dynamic-plugins', {
      method: 'POST',
      body: {
        id: installForm.id,
        name: installForm.name,
        version: installForm.version,
        description: installForm.description,
        serverModule: installForm.serverModule || undefined,
        serverChecksum: installForm.serverChecksum || undefined,
        clientBundle: installForm.clientBundle || undefined,
        clientChecksum: installForm.clientChecksum || undefined,
        blockDefinitions: installForm.blockDefinitions || undefined,
        definitionsChecksum: installForm.definitionsChecksum || undefined,
        capabilities: installForm.capabilities || undefined,
        capabilitiesChecksum: installForm.capabilitiesChecksum || undefined,
        publisherPublicKey: installForm.publisherPublicKey || undefined,
        signature: installForm.signature || undefined,
      },
    })
    await refreshDyn()
    installModal.value = false
    Object.assign(installForm, {
      id: '',
      name: '',
      version: '',
      description: '',
      serverModule: '',
      serverChecksum: '',
      clientBundle: '',
      clientChecksum: '',
      blockDefinitions: '',
      definitionsChecksum: '',
      capabilities: '',
      capabilitiesChecksum: '',
      publisherPublicKey: '',
      signature: '',
    })
    jsonPayloadText.value = ''
  }, { successTitle: 'Plugin installed', errorTitle: "Couldn't install plugin", key: 'install' })
}

// Enabling a plugin that asks for permissions goes through the review modal first; the
// approved list is sent with the request (the server refuses a list that doesn't match).
const reviewPlugin = ref<DynamicPlugin | null>(null)
const reviewOpen = ref(false)
async function enablePlugin(plugin: DynamicPlugin, approvedPermissions: string[]) {
  const url: string = `/api/v1/dynamic-plugins/${plugin.id}/enable`
  await run(async () => {
    await $fetch<unknown>(url, { method: 'POST', body: { approvedPermissions } })
    await refreshDyn()
    reviewOpen.value = false
  }, { successTitle: `${plugin.name} enabled`, errorTitle: "Couldn't enable plugin", key: 'enable' })
}

async function dynToggle(plugin: DynamicPlugin) {
  if (!plugin.isActive) {
    if (plugin.permissions.length > 0) {
      reviewPlugin.value = plugin
      reviewOpen.value = true
      return
    }
    await enablePlugin(plugin, [])
    return
  }
  const url: string = `/api/v1/dynamic-plugins/${plugin.id}/disable`
  await run(async () => {
    await $fetch<unknown>(url, { method: 'POST' })
    await refreshDyn()
  }, { successTitle: 'Plugin disabled', errorTitle: "Couldn't disable plugin" })
}

const settingsPlugin = ref<DynamicPlugin | null>(null)
const settingsOpen = ref(false)
function openSettings(plugin: DynamicPlugin) {
  settingsPlugin.value = plugin
  settingsOpen.value = true
}

async function dynUninstall(id: string, name: string) {
  const ok = await useConfirm().confirm({
    title: `Uninstall "${name}"?`,
    description: 'This removes the plugin’s code, its settings and all data it has stored.',
    confirmLabel: 'Uninstall',
  })
  if (!ok) return
  await run(async () => {
    await $fetch<unknown>(`/api/v1/dynamic-plugins/${id}`, { method: 'DELETE' })
    await refreshDyn()
  }, { successTitle: 'Plugin uninstalled', errorTitle: "Couldn't uninstall plugin" })
}

</script>

<template>
  <div class="space-y-6">
    <h1 class="text-xl font-bold text-gray-900 dark:text-white">Plugins</h1>

    <!-- Dynamic plugins -->
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Dynamic plugins</h2>
        <UButton size="xs" icon="i-lucide-upload" @click="installModal = true">Upload plugin</UButton>
      </div>

      <div v-if="dynItems.length > 0" class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <UCard v-for="plugin in dynItems" :key="plugin.id">
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="flex items-center gap-2 mb-0.5">
                <p class="font-semibold text-gray-900 dark:text-white">{{ plugin.name }}</p>
                <UBadge :color="plugin.isActive ? 'success' : 'neutral'" variant="soft" size="xs">
                  {{ plugin.isActive ? 'Active' : 'Inactive' }}
                </UBadge>
                <UBadge color="info" variant="soft" size="xs">Dynamic</UBadge>
                <UBadge v-if="!plugin.isActive && plugin.needsApproval && plugin.grantedPermissions.length > 0" color="warning" variant="soft" size="xs">Needs approval</UBadge>
              </div>
              <p class="text-xs text-gray-500 dark:text-gray-400 truncate">{{ plugin.id }} @ {{ plugin.version }}</p>
              <p v-if="plugin.description" class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ plugin.description }}</p>
              <div class="flex gap-2 mt-1.5">
                <span v-if="plugin.hasServer" class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                  <UIcon name="i-lucide-server" class="w-3 h-3" /> Server
                </span>
                <span v-if="plugin.hasClient" class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                  <UIcon name="i-lucide-monitor" class="w-3 h-3" /> Client
                </span>
              </div>
              <div v-if="plugin.permissions.length" class="flex flex-wrap gap-1 mt-2">
                <!-- A plain title attribute rather than <UTooltip> (which needs the <UApp> root in app.vue). -->
                <UBadge
                  v-for="perm in plugin.permissions"
                  :key="perm"
                  :title="perm"
                  :color="plugin.isActive && plugin.grantedPermissions.includes(perm) ? 'primary' : 'neutral'"
                  variant="outline"
                  size="xs"
                >
                  {{ describePermission(perm).title }}
                </UBadge>
              </div>
              <p v-else-if="plugin.hasServer" class="text-xs text-gray-400 dark:text-gray-500 mt-2">No permissions — runs fully sandboxed.</p>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <UButton
                v-if="plugin.hasSettings"
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-settings"
                :aria-label="`${plugin.name} settings`"
                @click="openSettings(plugin)"
              />
              <UButton
                size="xs"
                :color="plugin.isActive ? 'neutral' : 'primary'"
                :icon="plugin.isActive ? 'i-lucide-pause' : 'i-lucide-play'"
                :variant="plugin.isActive ? 'outline' : 'solid'"
                @click="dynToggle(plugin)"
              >
                {{ plugin.isActive ? 'Disable' : 'Enable' }}
              </UButton>
              <UButton
                size="xs"
                color="error"
                variant="ghost"
                icon="i-lucide-trash-2"
                @click="dynUninstall(plugin.id, plugin.name)"
              />
            </div>
          </div>
        </UCard>
      </div>

      <UCard v-else>
        <div class="flex gap-3 items-start">
          <div class="shrink-0 w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
            <UIcon name="i-lucide-zap" class="w-4 h-4 text-blue-500" />
          </div>
          <div class="space-y-1">
            <p class="text-sm font-medium text-gray-900 dark:text-white">No dynamic plugins installed</p>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              Dynamic plugins run as isolated Cloudflare Workers. Upload a pre-built plugin bundle to install one without redeploying your site.
            </p>
          </div>
        </div>
      </UCard>
    </div>

    <!-- About dynamic plugins -->
    <div class="space-y-3">
      <h2 class="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">About dynamic plugins</h2>

      <UCard>
        <div class="space-y-4">
          <div class="flex gap-3">
            <div class="shrink-0 w-8 h-8 rounded-lg bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center">
              <UIcon name="i-lucide-info" class="w-4 h-4 text-primary-500" />
            </div>
            <div class="space-y-1">
              <p class="text-sm font-medium text-gray-900 dark:text-white">Dynamic plugins run as isolated Cloudflare Workers</p>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                Upload a pre-built plugin bundle to add new blocks and server-side functionality without redeploying your site.
                Each plugin runs in its own sandbox with no access to your database, accounts or the internet. It can only do what it asks for and you approve when enabling it, such as storing its own data, reading published content or connecting to a named service.
              </p>
            </div>
          </div>

          <div class="border-t border-gray-100 dark:border-gray-800 pt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <UIcon name="i-lucide-package-search" class="w-3.5 h-3.5 shrink-0" />
            Find community plugins by searching npm for <span class="font-mono bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">nuxflow-plugin</span>
          </div>
        </div>
      </UCard>
    </div>

    <AdminPluginsPermissionReview
      v-if="reviewPlugin"
      v-model:open="reviewOpen"
      :plugin-name="reviewPlugin.name"
      :permissions="reviewPlugin.permissions"
      :loading="isRunning('enable')"
      @approve="enablePlugin(reviewPlugin!, $event)"
    />

    <AdminPluginsSettingsModal
      v-if="settingsPlugin"
      v-model:open="settingsOpen"
      :plugin-id="settingsPlugin.id"
      :plugin-name="settingsPlugin.name"
    />

    <!-- Dynamic plugin install modal -->
    <UModal v-model:open="installModal" title="Upload dynamic plugin">
      <template #body>
        <div class="space-y-4 p-1 max-h-[80vh] overflow-y-auto pr-2">
          <UAlert
            icon="i-lucide-shield-alert"
            color="warning"
            variant="soft"
            title="Cryptographic Signature Required"
            description="Dynamic plugins must be signed with an Ed25519 publisher key. Paste the signed JSON bundle from your build output to auto-fill, or manually fill all fields."
          />

          <!-- JSON Paste Shortcut -->
          <div class="border border-gray-200 dark:border-gray-800 rounded-xl p-3 bg-gray-50/50 dark:bg-gray-900/30 space-y-2">
            <span class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider flex items-center gap-1">
              <UIcon name="i-lucide-paste" class="w-3.5 h-3.5" /> Auto-fill from signed plugin JSON
            </span>
            <UTextarea
              v-model="jsonPayloadText"
              :rows="3"
              placeholder='Paste fully signed plugin JSON payload here...'
              class="font-mono text-xs w-full"
              @input="handlePasteJson"
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Plugin ID" required>
              <UInput v-model="installForm.id" placeholder="my-plugin" class="font-mono" />
            </UFormField>
            <UFormField label="Version" required>
              <UInput v-model="installForm.version" placeholder="1.0.0" class="font-mono" />
            </UFormField>
          </div>

          <UFormField label="Display name" required>
            <UInput v-model="installForm.name" placeholder="My Plugin" />
          </UFormField>

          <UFormField label="Description">
            <UInput v-model="installForm.description" placeholder="What does this plugin do?" />
          </UFormField>

          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Publisher Public Key" required>
              <UInput v-model="installForm.publisherPublicKey" placeholder="publisher key..." class="font-mono text-xs" />
            </UFormField>
            <UFormField label="Signature" required>
              <UInput v-model="installForm.signature" placeholder="signature..." class="font-mono text-xs" />
            </UFormField>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Server Checksum (SHA-256)">
              <UInput v-model="installForm.serverChecksum" placeholder="server checksum..." class="font-mono text-xs" />
            </UFormField>
            <UFormField label="Client Checksum (SHA-256)">
              <UInput v-model="installForm.clientChecksum" placeholder="client checksum..." class="font-mono text-xs" />
            </UFormField>
          </div>

          <UFormField label="Block Definitions Checksum (SHA-256)">
            <UInput v-model="installForm.definitionsChecksum" placeholder="definitions checksum..." class="font-mono text-xs" />
          </UFormField>

          <UFormField label="Server module (base64)" hint="Self-contained ES module exporting a fetch handler">
            <UTextarea v-model="installForm.serverModule" :rows="3" placeholder="base64-encoded server module..." class="font-mono text-xs w-full" />
          </UFormField>

          <UFormField label="Client bundle (base64)" hint="ES module exporting renderBlock(blockId, vue) — runs sandboxed in an iframe, never in this app">
            <UTextarea v-model="installForm.clientBundle" :rows="3" placeholder="base64-encoded client bundle..." class="font-mono text-xs w-full" />
          </UFormField>

          <UFormField label="Block definitions (base64)" hint="Raw text of src/blocks.json — plain data, never executed">
            <UTextarea v-model="installForm.blockDefinitions" :rows="3" placeholder="base64-encoded blocks.json..." class="font-mono text-xs w-full" />
          </UFormField>

          <div class="flex justify-end gap-2 border-t border-gray-100 dark:border-gray-800 pt-3">
            <UButton color="neutral" variant="ghost" @click="installModal = false">Cancel</UButton>
            <UButton :loading="isRunning('install')" icon="i-lucide-upload" @click="dynInstall">Install plugin</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
