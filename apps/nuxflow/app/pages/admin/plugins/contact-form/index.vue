<script setup lang="ts">
import ContactFormAdmin from '@nuxflow/plugin-contact-form/components/ContactFormAdmin'

definePageMeta({ layout: 'admin', middleware: ['auth'] })
</script>

<template>
  <ContactFormAdmin />
</template>
