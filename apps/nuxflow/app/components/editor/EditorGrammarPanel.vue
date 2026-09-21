<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

const props = defineProps<{ editor: Editor | undefined }>()
const emit = defineEmits<{ close: [] }>()

const toast = useToast()

interface Correction {
  original: string
  corrected: string
  reason: string
}

/**
 * `/api/v1/ai/grammar` (server/api/v1/ai/grammar.post.ts) returns corrections as plain
 * `{ original, corrected, reason }` triples with no document position or character offset —
 * the model only ever sees the editor's flattened plain text, not its ProseMirror positions.
 * When the same `original` phrase occurs more than once in the document, there is no way to
 * know from the API response alone which occurrence a given correction was meant for.
 * `occurrenceIndex` is our own best-effort disambiguator: for corrections that share the same
 * `original` text, we number them in the order the model returned them (0, 1, 2, …) and assume
 * that matches the order the phrase actually appears in the document — reasonable since the
 * model reads the text top-to-bottom, but not guaranteed. `applyCorrection` below then targets
 * the Nth occurrence of `original` in the live document instead of always the first, which is
 * what let this silently correct the wrong occurrence before. If the API is ever extended to
 * return a real offset, prefer that over this heuristic.
 */
interface IndexedCorrection extends Correction {
  occurrenceIndex: number
}

const grammarLoading = ref(false)
const corrections = ref<IndexedCorrection[]>([])
const grammarChecked = ref(false)

function extractPlainText(): string {
  if (!props.editor) return ''
  return props.editor.getText()
}

function withOccurrenceIndex(list: Correction[]): IndexedCorrection[] {
  const seen = new Map<string, number>()
  return list.map((c) => {
    const occurrenceIndex = seen.get(c.original) ?? 0
    seen.set(c.original, occurrenceIndex + 1)
    return { ...c, occurrenceIndex }
  })
}

async function checkGrammar() {
  const text = extractPlainText()
  if (!text.trim()) return
  grammarLoading.value = true
  corrections.value = []
  grammarChecked.value = false
  try {
    const res = await $fetch<{ corrections: Correction[] }>('/api/v1/ai/grammar', {
      method: 'POST',
      body: { text },
    })
    corrections.value = withOccurrenceIndex(res.corrections)
    grammarChecked.value = true
  } catch (e: unknown) {
    const msg = getErrorMessage(e, 'Grammar check failed')
    toast.add({ title: msg, color: 'error' })
  } finally {
    grammarLoading.value = false
  }
}

// Extracted to a plain function (rather than a `let` reassigned from inside the
// `descendants` callback) so the result has a real declared return type — TypeScript
// doesn't carry control-flow narrowing for a variable mutated only inside a nested
// closure, which otherwise flow-narrows the outer read to `never`.
function findOccurrenceRange(doc: ProseMirrorNode, original: string, occurrenceIndex: number): { from: number, to: number } | null {
  let occurrencesSeen = 0
  let target: { from: number, to: number } | null = null

  doc.descendants((node, pos) => {
    if (target || node.type.name !== 'text' || !node.text) return
    let searchFrom = 0
    for (;;) {
      const idx = node.text.indexOf(original, searchFrom)
      if (idx === -1) break
      if (occurrencesSeen === occurrenceIndex) {
        target = { from: pos + idx, to: pos + idx + original.length }
        return false
      }
      occurrencesSeen++
      searchFrom = idx + original.length
    }
  })

  return target
}

function applyCorrection(c: IndexedCorrection) {
  if (!props.editor) return
  const { state, dispatch } = props.editor.view
  const target = findOccurrenceRange(state.doc, c.original, c.occurrenceIndex)

  if (target) {
    dispatch(state.tr.replaceWith(target.from, target.to, state.schema.text(c.corrected)))
  }
  corrections.value = corrections.value.filter(x => x !== c)
}

onMounted(() => {
  checkGrammar()
})
</script>

<template>
  <div class="border-b border-gray-200 dark:border-gray-800 bg-amber-50/50 dark:bg-amber-950/20 px-4 py-3">
    <div class="flex items-center justify-between mb-2">
      <p class="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
        <UIcon name="i-lucide-spell-check" class="w-3.5 h-3.5" />
        Grammar &amp; Style
      </p>
      <div class="flex items-center gap-2">
        <UButton size="xs" variant="ghost" :loading="grammarLoading" icon="i-lucide-refresh-cw" @click="checkGrammar">
          Re-check
        </UButton>
        <UButton size="xs" variant="ghost" icon="i-lucide-x" aria-label="Close grammar panel" @click="emit('close')" />
      </div>
    </div>
    <div v-if="grammarLoading" class="text-xs text-gray-400 flex items-center gap-1.5 py-1">
      <UIcon name="i-lucide-loader-2" class="w-3.5 h-3.5 animate-spin" />
      Checking…
    </div>
    <div v-else-if="grammarChecked && corrections.length === 0" class="text-xs text-green-600 dark:text-green-400 flex items-center gap-1.5 py-1">
      <UIcon name="i-lucide-check-circle" class="w-3.5 h-3.5" />
      No issues found.
    </div>
    <div v-else class="space-y-1.5 max-h-40 overflow-y-auto">
      <div
        v-for="(c, i) in corrections"
        :key="i"
        class="flex items-start gap-2 rounded-lg bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs"
      >
        <div class="flex-1 min-w-0">
          <span class="text-red-500 line-through">{{ c.original }}</span>
          <span class="mx-1 text-gray-400">→</span>
          <span class="text-green-600 dark:text-green-400 font-medium">{{ c.corrected }}</span>
          <span class="ml-2 text-gray-400">{{ c.reason }}</span>
        </div>
        <UButton size="xs" variant="ghost" color="success" @click="applyCorrection(c)">Apply</UButton>
      </div>
    </div>
  </div>
</template>
