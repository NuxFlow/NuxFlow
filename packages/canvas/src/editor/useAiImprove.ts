import { ref } from 'vue'
import { useCanvasHost } from '../host'

export type AiInstruction = 'improve' | 'shorten' | 'expand' | 'simplify'

export interface AiImproveAction {
  label: string
  value: AiInstruction
  icon: string
}

export const AI_IMPROVE_ACTIONS: AiImproveAction[] = [
  { label: 'Improve', value: 'improve', icon: '✨' },
  { label: 'Shorten', value: 'shorten', icon: '✂️' },
  { label: 'Expand', value: 'expand', icon: '↔' },
  { label: 'Simplify', value: 'simplify', icon: '⚡' },
]

/**
 * Shared "Improve with AI" state/fetch logic used by RichTextInput.vue and
 * FieldRenderer.vue's text/textarea fields. Deliberately does not own how the source
 * text is read or how a chosen alternative gets applied — those differ per caller
 * (TipTap HTML vs plain string inputs) — this only owns the request (through the
 * CanvasHost) and results list.
 */
export function useAiImprove() {
  const host = useCanvasHost()
  const aiLoading = ref(false)
  const aiAlternatives = ref<string[]>([])
  const aiError = ref<string | null>(null)
  const showAiMenu = ref(false)

  async function triggerAi(instruction: AiInstruction, sourceText: string) {
    showAiMenu.value = false
    const text = sourceText.trim()
    if (!text || aiLoading.value) return
    aiLoading.value = true
    aiAlternatives.value = []
    aiError.value = null
    try {
      aiAlternatives.value = await host.improveText(text, instruction)
      if (!aiAlternatives.value.length) {
        aiError.value = 'AI returned no suggestions. Try again or rephrase the text.'
      }
    } catch (e: unknown) {
      aiError.value = (e instanceof Error && e.message) || 'Could not reach the AI service. Check your connection and try again.'
    } finally {
      aiLoading.value = false
    }
  }

  function dismissAlternatives() {
    aiAlternatives.value = []
    aiError.value = null
  }

  return {
    aiLoading,
    aiAlternatives,
    aiError,
    showAiMenu,
    triggerAi,
    dismissAlternatives,
  }
}
