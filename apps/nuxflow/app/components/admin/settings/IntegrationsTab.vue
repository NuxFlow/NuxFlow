<script setup lang="ts">
import type { IntegrationsState, SocialState } from '~/types/admin-settings'

const integrations = defineModel<IntegrationsState>('integrations', { required: true })
const social = defineModel<SocialState>('social', { required: true })
defineProps<{
  domain: string
  saving: boolean
  onSave: () => Promise<void>
}>()
</script>

<template>
  <UCard>
    <template #header><p class="text-sm font-semibold text-gray-900 dark:text-white">Cloudflare Turnstile</p></template>
    <div class="space-y-4">
      <UFormField label="Site key" hint="Public key shown to visitors">
        <UInput v-model="integrations.turnstileSiteKey" placeholder="0x4AAA…" />
      </UFormField>
      <p class="text-xs text-gray-400">
        Secret key must be set via <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">CLOUDFLARE_TURNSTILE_SECRET_KEY</code> environment variable.
      </p>
    </div>
    <template #footer>
      <div class="flex justify-end">
        <UButton :loading="saving" @click="onSave">Save changes</UButton>
      </div>
    </template>
  </UCard>

  <UCard class="mt-6">
    <template #header><p class="text-sm font-semibold text-gray-900 dark:text-white">Social Login</p></template>
    <div class="space-y-6">
      <p class="text-sm text-gray-500 dark:text-gray-400">
        Bring your own Google/GitHub OAuth app for this site instead of the deployment-wide default. Leave blank to keep using the environment-variable default (if one is configured).
      </p>

      <div class="space-y-3">
        <p class="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-2">
          <UIcon name="i-simple-icons-google" class="w-4 h-4" /> Google
        </p>
        <UFormField label="Client ID">
          <UInput v-model="social.googleClientId" placeholder="xxxxx.apps.googleusercontent.com" />
        </UFormField>
        <UFormField label="Client secret">
          <UInput v-model="social.googleClientSecret" type="password" placeholder="GOCSPX-…" />
        </UFormField>
        <p class="text-xs text-gray-400">
          Authorized redirect URI: <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">https://{{ domain || 'yourdomain.com' }}/api/auth/callback/google</code>
        </p>
      </div>

      <div class="space-y-3 border-t border-gray-100 dark:border-gray-800 pt-6">
        <p class="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-2">
          <UIcon name="i-simple-icons-github" class="w-4 h-4" /> GitHub
        </p>
        <UFormField label="Client ID">
          <UInput v-model="social.githubClientId" placeholder="Iv1.xxxxxxxxxxxx" />
        </UFormField>
        <UFormField label="Client secret">
          <UInput v-model="social.githubClientSecret" type="password" placeholder="••••••••" />
        </UFormField>
        <p class="text-xs text-gray-400">
          Authorization callback URL: <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">https://{{ domain || 'yourdomain.com' }}/api/auth/callback/github</code>. GitHub OAuth Apps only support one callback URL each, so a secondary site needs its own GitHub OAuth App — this is exactly what these fields are for.
        </p>
      </div>
    </div>
    <template #footer>
      <div class="flex items-center justify-between">
        <p class="text-xs text-gray-400">Client secrets are encrypted at rest using AES-GCM.</p>
        <UButton :loading="saving" @click="onSave">Save changes</UButton>
      </div>
    </template>
  </UCard>
</template>
