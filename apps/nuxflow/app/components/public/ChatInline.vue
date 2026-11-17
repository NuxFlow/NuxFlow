<script setup lang="ts">
// The Chat Canvas block's conversation (CanvasHost.chatPanel): the website chatbot in the
// page instead of the floating bubble, which hides while this is mounted.
defineProps<{ heading?: string }>()

const inlineChats = useInlineChatCount()
onMounted(() => { inlineChats.value++ })
onBeforeUnmount(() => { inlineChats.value = Math.max(0, inlineChats.value - 1) })
</script>

<template>
  <ClientOnly>
    <PublicChatPanel inline :heading="heading" />
  </ClientOnly>
</template>
