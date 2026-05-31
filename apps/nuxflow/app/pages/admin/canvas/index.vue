<script setup lang="ts">
import { CanvasAdmin } from '@nuxflow/plugin-canvas'

definePageMeta({ layout: 'admin', middleware: ['auth'] })
</script>

<template>
  <CanvasAdmin />
</template>
