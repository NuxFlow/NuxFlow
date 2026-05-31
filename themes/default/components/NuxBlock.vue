<script setup lang="ts">
const props = defineProps<{ type: string; data: Record<string, unknown> }>()

const componentMap: Record<string, ReturnType<typeof defineAsyncComponent>> = {
  heading: defineAsyncComponent(() => import('./blocks/Heading.vue')),
  paragraph: defineAsyncComponent(() => import('./blocks/Paragraph.vue')),
  image: defineAsyncComponent(() => import('./blocks/Image.vue')),
  button: defineAsyncComponent(() => import('./blocks/Button.vue')),
  quote: defineAsyncComponent(() => import('./blocks/Quote.vue')),
  code: defineAsyncComponent(() => import('./blocks/Code.vue')),
  divider: defineAsyncComponent(() => import('./blocks/Divider.vue')),
}

const component = computed(() => componentMap[props.type])
</script>

<template>
  <component :is="component" v-if="component" :data="data" />
  <div v-else class="text-xs text-gray-300 py-1">[unknown block: {{ type }}]</div>
</template>
