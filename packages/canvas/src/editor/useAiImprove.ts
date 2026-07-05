import { ref } from 'vue'

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
 * (TipTap HTML vs plain string inputs) — this only owns the fetch and results list.
 */
export function useAiImprove() {
  const aiLoading = ref(false)
  const aiAlternatives = ref<string[]>([])
  const showAiMenu = ref(false)

  async function triggerAi(instruction: AiInstruction, sourceText: string) {
    showAiMenu.value = false
    const text = sourceText.trim()
    if (!text || aiLoading.value) return
    aiLoading.value = true
    aiAlternatives.value = []
    try {
      const res = await fetch('/api/v1/ai/improve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, instruction }),
      })
      if (res.ok) {
        const data = await res.json() as { alternatives?: string[] }
        aiAlternatives.value = data.alternatives ?? []
      }
    } finally {
      aiLoading.value = false
    }
  }

  function dismissAlternatives() {
    aiAlternatives.value = []
  }

  return {
    aiLoading,
    aiAlternatives,
    showAiMenu,
    triggerAi,
    dismissAlternatives,
  }
}
