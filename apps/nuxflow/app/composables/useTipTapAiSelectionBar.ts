import type { Editor as CoreEditor } from '@tiptap/core'
import type { Editor } from '@tiptap/vue-3'

/**
 * Tracks the current text selection inside a TipTap editor and drives the floating
 * "AI selection toolbar" that appears above it — selection coordinates, the debounced
 * show/hide timing (so a click landing inside the bar doesn't immediately close it), and
 * the "replace selection with AI output" action. Extracted from `ContentEditor.client.vue`,
 * which wires `handleSelectionUpdate` into TipTap's own `onSelectionUpdate` editor option.
 */
export function useTipTapAiSelectionBar(editor: Ref<Editor | undefined>) {
  const aiSelectionText = ref('')
  const aiSelectionFrom = ref(0)
  const aiSelectionTo = ref(0)
  const showAiSelectionBar = ref(false)
  const aiBarX = ref(0)
  const aiBarY = ref(0)
  let selectionDebounce: ReturnType<typeof setTimeout>

  const aiBarStyle = computed(() => ({
    position: 'fixed' as const,
    top: `${aiBarY.value}px`,
    left: `${Math.min(aiBarX.value, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 310)}px`,
    transform: 'translateY(-100%) translateY(-8px)',
    zIndex: 9999,
  }))

  // Typed against @tiptap/core's Editor (not @tiptap/vue-3's) because that's the actual
  // type useEditor()'s `onSelectionUpdate` callback hands back — vue-3's Editor is a
  // subclass with Vue-reactivity-specific private members the callback's value doesn't
  // have, so typing this parameter with the vue-3 Editor rejects that real argument.
  // Everything this function touches (`.state`, `.view`) is a base @tiptap/core member.
  function handleSelectionUpdate(e: CoreEditor) {
    clearTimeout(selectionDebounce)
    const { from, to, empty } = e.state.selection
    if (!empty) {
      const text = e.state.doc.textBetween(from, to, ' ').trim()
      if (text.length > 3) {
        aiSelectionFrom.value = from
        aiSelectionTo.value = to
        aiSelectionText.value = text
        const coords = e.view.coordsAtPos(from)
        aiBarX.value = coords.left
        aiBarY.value = coords.top
        selectionDebounce = setTimeout(() => { showAiSelectionBar.value = true }, 350)
        return
      }
    }
    // Selection cleared or too short — hide bar (debounced so clicks inside bar don't close it)
    selectionDebounce = setTimeout(() => {
      if (!showAiSelectionBar.value) aiSelectionText.value = ''
    }, 200)
  }

  function onAiReplace(text: string) {
    editor.value?.chain()
      .focus()
      .setTextSelection({ from: aiSelectionFrom.value, to: aiSelectionTo.value })
      .insertContent(text)
      .run()
    showAiSelectionBar.value = false
    aiSelectionText.value = ''
  }

  function onDocMouseDown(e: MouseEvent) {
    const target = e.target as Element
    if (!target.closest('.ai-selection-bar')) {
      showAiSelectionBar.value = false
    }
  }

  onMounted(() => {
    document.addEventListener('mousedown', onDocMouseDown)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onDocMouseDown)
    clearTimeout(selectionDebounce)
  })

  return {
    aiSelectionText,
    showAiSelectionBar,
    aiBarStyle,
    handleSelectionUpdate,
    onAiReplace,
  }
}
