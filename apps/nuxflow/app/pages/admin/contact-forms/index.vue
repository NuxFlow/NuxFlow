<script setup lang="ts">
import ContactFormAdmin from '~/components/forms/ContactFormAdmin.vue'

definePageMeta({ layout: 'admin', middleware: ['auth'] })
</script>

<template>
  <ContactFormAdmin />
</template>
