<script setup lang="ts">
// Dictation button for AI prompt fields: records from the microphone and sends the audio
// to POST /api/v1/ai/transcribe (Workers AI Whisper), emitting the text. Resolved by name
// from @nuxflow/canvas's AiGenerateModal too, so keep the component name (AiVoiceInput)
// and its single `transcribed` event stable.
const emit = defineEmits<{ transcribed: [text: string] }>()

// Stops on its own well under the route's 20 MB limit.
const MAX_RECORDING_MS = 5 * 60_000

const toast = useToast()
const supported = ref(false)
const recording = ref(false)
const transcribing = ref(false)
let recorder: MediaRecorder | null = null
let chunks: Blob[] = []
let stopTimer: ReturnType<typeof setTimeout> | undefined

onMounted(() => {
  supported.value = typeof window.MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
})

onBeforeUnmount(() => {
  clearTimeout(stopTimer)
  if (recorder?.state === 'recording') {
    recorder.onstop = null
    recorder.stop()
  }
  recorder?.stream.getTracks().forEach(t => t.stop())
})

async function start() {
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  }
  catch {
    toast.add({ title: 'Microphone unavailable', description: 'Allow microphone access in your browser to dictate.', color: 'warning' })
    return
  }
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported(t))
  recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  chunks = []
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  recorder.onstop = () => {
    stream.getTracks().forEach(t => t.stop())
    void transcribe(new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' }))
  }
  recorder.start()
  recording.value = true
  stopTimer = setTimeout(stop, MAX_RECORDING_MS)
}

function stop() {
  clearTimeout(stopTimer)
  recording.value = false
  if (recorder?.state === 'recording') recorder.stop()
}

async function transcribe(audio: Blob) {
  if (!audio.size) return
  transcribing.value = true
  try {
    const form = new FormData()
    // The route checks for an audio/* type; strip codec parameters from the file type.
    const type = audio.type.split(';')[0] || 'audio/webm'
    form.append('file', new File([audio], `dictation.${type.split('/')[1] || 'webm'}`, { type }))
    const { text } = await $fetch<{ text: string }>('/api/v1/ai/transcribe', { method: 'POST', body: form })
    if (text.trim()) emit('transcribed', text.trim())
    else toast.add({ title: 'No speech detected', color: 'warning' })
  }
  catch (e: unknown) {
    toast.add({ title: 'Dictation failed', description: getErrorMessage(e, 'Voice-to-text needs the Workers AI binding.'), color: 'error' })
  }
  finally {
    transcribing.value = false
  }
}
</script>

<template>
  <UButton
    v-if="supported"
    size="xs"
    :color="recording ? 'error' : 'neutral'"
    :variant="recording ? 'soft' : 'ghost'"
    :icon="recording ? 'i-lucide-square' : 'i-lucide-mic'"
    :loading="transcribing"
    :aria-label="recording ? 'Stop dictation' : 'Dictate with your voice'"
    @click="recording ? stop() : start()"
  >
    {{ transcribing ? 'Transcribing…' : recording ? 'Stop' : 'Dictate' }}
  </UButton>
</template>
