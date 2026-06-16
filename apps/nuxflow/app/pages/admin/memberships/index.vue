<script setup lang="ts">
import MembershipsAdmin from '~/components/memberships/MembershipsAdmin.vue'

definePageMeta({ layout: 'admin', middleware: ['auth'] })
</script>

<template>
  <MembershipsAdmin />
</template>
