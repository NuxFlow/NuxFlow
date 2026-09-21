import type { Editor } from '@tiptap/vue-3'

/**
 * State/logic for the toolbar's inline link-insert panel. Replaces `window.prompt()`
 * (blocking, no validation, doesn't match the rest of the toolbar's chrome) with an inline
 * panel — same pattern as the grammar-check panel in `ContentEditor.client.vue`. Extracted
 * from that component so the TipTap setup/toolbar core isn't also carrying this panel's
 * own state machine.
 */
export function useLinkPanel(editor: Ref<Editor | undefined>) {
  const showLinkPanel = ref(false)
  const linkUrlDraft = ref('')
  const linkUrlError = ref('')
  const linkUrlInputRef = ref<HTMLInputElement | null>(null)

  function setLink() {
    if (!editor.value) return
    const previousUrl = editor.value.getAttributes('link').href as string | undefined
    linkUrlDraft.value = previousUrl || ''
    linkUrlError.value = ''
    showLinkPanel.value = true
    nextTick(() => linkUrlInputRef.value?.focus())
  }

  function confirmLink() {
    if (!editor.value) return
    const url = linkUrlDraft.value.trim()

    if (!url) {
      editor.value.chain().focus().extendMarkRange('link').unsetLink().run()
      showLinkPanel.value = false
      return
    }

    // Rejected here rather than silently stored — the previous window.prompt() version had
    // no such check.
    try {
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol')
    } catch {
      linkUrlError.value = 'Enter a valid http(s) URL'
      return
    }

    editor.value.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    showLinkPanel.value = false
  }

  function cancelLink() {
    showLinkPanel.value = false
    editor.value?.chain().focus().run()
  }

  return {
    showLinkPanel,
    linkUrlDraft,
    linkUrlError,
    linkUrlInputRef,
    setLink,
    confirmLink,
    cancelLink,
  }
}
