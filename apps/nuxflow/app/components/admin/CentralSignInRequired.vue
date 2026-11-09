<script setup lang="ts">
// Shown on Super Admin → Sites while NUXT_PUBLIC_ACCOUNTS_URL isn't set: POST /api/v1/admin/sites
// refuses a second site until sign-in has its own domain (server/utils/accounts-origin.ts),
// hosting switch on or off.
</script>

<template>
  <UAlert
    color="warning"
    variant="soft"
    icon="i-lucide-key-round"
    title="Set up a sign-in domain before adding sites"
  >
    <template #description>
      <p>
        Every site's admins can add their own code to their pages, so once there's more than one site,
        people must sign in on a separate domain that runs no site's code (for example
        <code>accounts.yourdomain.com</code>). Set <code>NUXT_PUBLIC_ACCOUNTS_URL</code> in
        <code>wrangler.toml</code>, route that address to this Worker, and redeploy.
      </p>
      <p class="mt-1">
        Step by step: "Hosting several sites" in <code>docs/installation.md</code>.
      </p>
    </template>
  </UAlert>
</template>
