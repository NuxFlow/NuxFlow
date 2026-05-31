<script setup lang="ts">
import MembershipsAdmin from '@nuxflow/plugin-payments/components/MembershipsAdmin'

definePageMeta({ layout: 'admin', middleware: ['auth'] })
</script>

<template>
  <MembershipsAdmin />
</template>
