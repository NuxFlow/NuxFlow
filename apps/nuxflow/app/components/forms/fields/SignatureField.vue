<script setup lang="ts">
defineProps<{ field: { label: string; required?: boolean; helpText?: string }; modelValue?: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: string] }>()

const canvas = ref<HTMLCanvasElement>()
const drawing = ref(false)

function start(e: MouseEvent | TouchEvent) {
  drawing.value = true
  const ctx = canvas.value?.getContext('2d')
  if (!ctx) return
  const pt = 'touches' in e ? e.touches[0] : e
  if (!pt) return
  const rect = canvas.value!.getBoundingClientRect()
  ctx.beginPath()
  ctx.moveTo(pt.clientX - rect.left, pt.clientY - rect.top)
}

function draw(e: MouseEvent | TouchEvent) {
  if (!drawing.value) return
  e.preventDefault()
  const ctx = canvas.value?.getContext('2d')
  if (!ctx) return
  const pt = 'touches' in e ? e.touches[0] : e
  if (!pt) return
  const rect = canvas.value!.getBoundingClientRect()
  ctx.lineTo(pt.clientX - rect.left, pt.clientY - rect.top)
  ctx.strokeStyle = '#111'
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.stroke()
}

function end() {
  drawing.value = false
  emit('update:modelValue', canvas.value?.toDataURL() ?? '')
}

function clear() {
  const ctx = canvas.value?.getContext('2d')
  if (!ctx || !canvas.value) return
  ctx.clearRect(0, 0, canvas.value.width, canvas.value.height)
  emit('update:modelValue', '')
}
</script>
<template>
  <UFormField :label="field.label" :required="field.required" :hint="field.helpText">
    <div class="relative border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-900">
      <canvas
        ref="canvas"
        width="400"
        height="120"
        class="w-full cursor-crosshair touch-none"
        @mousedown="start"
        @mousemove="draw"
        @mouseup="end"
        @mouseleave="end"
        @touchstart="start"
        @touchmove="draw"
        @touchend="end"
      />
      <UButton class="absolute bottom-2 right-2" size="xs" variant="ghost" @click="clear">Clear</UButton>
    </div>
  </UFormField>
</template>
