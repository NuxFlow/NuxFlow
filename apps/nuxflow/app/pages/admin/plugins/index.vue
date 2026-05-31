<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: ['auth'] })

const toast = useToast()

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
  publisherPublicKey: '',
  signature: '',
})
const installLoading = ref(false)

const jsonPayloadText = ref('')

function handlePasteJson() {
  try {
    const parsed = JSON.parse(jsonPayloadText.value)
    if (!parsed.id) {
      toast.add({ title: 'Invalid JSON: id is required', color: 'red' })
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
    installForm.publisherPublicKey = parsed.publisherPublicKey || ''
    installForm.signature = parsed.signature || ''
    toast.add({ title: 'Plugin payload parsed successfully!', color: 'green' })
  } catch {
    // Ignore typings and partial input
  }
}

async function dynInstall() {
  installLoading.value = true
  try {
    await $fetch('/api/v1/dynamic-plugins', {
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
      publisherPublicKey: '',
      signature: '',
    })
    jsonPayloadText.value = ''
    toast.add({ title: 'Plugin installed successfully!', color: 'green' })
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Install failed'
    toast.add({ title: msg, color: 'red' })
  } finally {
    installLoading.value = false
  }
}

async function dynToggle(id: string, isActive: boolean) {
  const action = isActive ? 'disable' : 'enable'
  try {
    await $fetch(`/api/v1/dynamic-plugins/${id}/${action}`, { method: 'POST' })
    await refreshDyn()
    toast.add({ title: isActive ? 'Plugin disabled' : 'Plugin enabled', color: 'green' })
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Action failed'
    toast.add({ title: msg, color: 'red' })
  }
}

async function dynUninstall(id: string, name: string) {
  if (!confirm(`Uninstall "${name}"? This will remove all stored plugin code.`)) return
  try {
    await $fetch(`/api/v1/dynamic-plugins/${id}`, { method: 'DELETE' })
    await refreshDyn()
    toast.add({ title: 'Plugin uninstalled', color: 'green' })
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Uninstall failed'
    toast.add({ title: msg, color: 'red' })
  }
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
                <UBadge :color="plugin.isActive ? 'green' : 'neutral'" variant="soft" size="xs">
                  {{ plugin.isActive ? 'Active' : 'Inactive' }}
                </UBadge>
                <UBadge color="blue" variant="soft" size="xs">Dynamic</UBadge>
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
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <UButton
                size="xs"
                :color="plugin.isActive ? 'neutral' : 'primary'"
                :icon="plugin.isActive ? 'i-lucide-pause' : 'i-lucide-play'"
                :variant="plugin.isActive ? 'outline' : 'solid'"
                @click="dynToggle(plugin.id, plugin.isActive)"
              >
                {{ plugin.isActive ? 'Disable' : 'Enable' }}
              </UButton>
              <UButton
                size="xs"
                color="red"
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

    <!-- Dynamic plugin install modal -->
    <UModal v-model:open="installModal" title="Upload dynamic plugin">
      <template #body>
        <div class="space-y-4 p-1 max-h-[80vh] overflow-y-auto pr-2">
          <UAlert
            icon="i-lucide-shield-alert"
            color="yellow"
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
              class="font-mono text-xs"
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

          <UFormField label="Server module (base64)" hint="Self-contained ES module exporting a fetch handler">
            <UTextarea v-model="installForm.serverModule" :rows="3" placeholder="base64-encoded server module..." class="font-mono text-xs" />
          </UFormField>

          <UFormField label="Client bundle (base64)" hint="ES module exporting register(app, registry)">
            <UTextarea v-model="installForm.clientBundle" :rows="3" placeholder="base64-encoded client bundle..." class="font-mono text-xs" />
          </UFormField>

          <div class="flex justify-end gap-2 border-t border-gray-100 dark:border-gray-800 pt-3">
            <UButton color="neutral" variant="ghost" @click="installModal = false">Cancel</UButton>
            <UButton :loading="installLoading" icon="i-lucide-upload" @click="dynInstall">Install plugin</UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
