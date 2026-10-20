<script setup lang="ts">
// Admin → Contact Forms was merged into Admin → Forms: the built-in contact form is a
// form like any other, and its messages are in its Submissions inbox. This page only
// keeps old links and bookmarks working.
definePageMeta({ layout: 'admin', middleware: ['auth'] })

// useRequestFetch forwards the admin's cookies when this runs during SSR.
const forms = await useRequestFetch()<{ forms: Array<{ id: string; slug: string }> }>('/api/v1/forms').catch(() => null)
const contact = forms?.forms.find(f => f.slug === 'contact')
await navigateTo(contact ? `/admin/forms/${contact.id}/submissions` : '/admin/forms', { replace: true })
</script>

<template>
  <div />
</template>
