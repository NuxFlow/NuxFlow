<script setup lang="ts">
// Shown when Better Auth refuses a sign-in-settings change because the sign-in is more than
// a day old (isSessionNotFresh()). Sends the person through the sign-in page and back here.
defineProps<{ action: string }>()

const route = useRoute()
const { reauthUrl } = useAccounts()
</script>

<template>
  <UAlert
    color="warning"
    variant="soft"
    icon="i-lucide-shield-alert"
    title="Confirm it's you"
    :description="`You signed in more than a day ago. To ${action}, sign in again — you'll come straight back here.`"
    :actions="[{ label: 'Sign in again', color: 'warning', variant: 'solid', to: reauthUrl(route.fullPath) }]"
  />
</template>
