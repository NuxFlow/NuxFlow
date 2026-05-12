import { ref, computed, inject } from 'vue'
import type { CanvasContent, CanvasBlockData, CanvasBlockDefinition } from '../types'
import { emptyCanvas } from '../types'
import { getBlockDefinition } from '../blocks/definitions'

interface BlockRegistryLike {
  meta(id: string): { name: string; icon?: string; description?: string } | undefined
  resolve(id: string): object | undefined
  getDefinition(id: string): unknown
  all(): Array<{ id: string; name: string; icon?: string }>
  dynamicBlocks(): Array<{ id: string; name: string; icon?: string }>
}

function uuid(): string {
  return crypto.randomUUID()
}

export function useCanvas(initial?: CanvasContent) {
  const registry = inject<BlockRegistryLike | null>('nuxflow:blockRegistry', null)

  const canvas = ref<CanvasContent>(
    initial ? JSON.parse(JSON.stringify(initial)) : emptyCanvas(),
  )

  const selectedId = ref<string | null>(null)

  const selectedBlock = computed(() =>
    canvas.value.blocks.find(b => b.id === selectedId.value) ?? null,
  )

  const selectedDefinition = computed((): CanvasBlockDefinition | null => {
    if (!selectedBlock.value) return null
    const def = getBlockDefinition(selectedBlock.value.type)
    if (def) return def
    // Dynamic plugin block — check if the plugin registered a full definition
    // (with fields) so the settings panel renders proper field editors.
    const regDef = registry?.getDefinition(selectedBlock.value.type)
    if (regDef) return regDef as CanvasBlockDefinition
    // Fall back to a minimal shell using registry metadata (name + icon only)
    // so the settings panel at least renders with move/delete controls.
    const regMeta = registry?.meta(selectedBlock.value.type)
    if (regMeta) {
      return {
        id: selectedBlock.value.type,
        name: regMeta.name,
        description: regMeta.description,
        icon: regMeta.icon ?? 'i-lucide-box',
        category: 'plugin',
        component: '',
        fields: [],
        defaultProps: {},
      }
    }
    return null
  })

  // ── Mutations ─────────────────────────────────────────────────────────────

  function addBlock(typeId: string, atIndex?: number) {
    const def = getBlockDefinition(typeId)
    // For dynamic plugin blocks: use the registered definition's defaultProps if
    // available so the block renders with sensible initial values.
    const regDef = !def ? registry?.getDefinition(typeId) as CanvasBlockDefinition | undefined : undefined
    const block: CanvasBlockData = {
      id: uuid(),
      type: typeId,
      props: def ? { ...def.defaultProps } : regDef ? { ...regDef.defaultProps } : {},
    }
    const idx = atIndex ?? canvas.value.blocks.length
    canvas.value.blocks.splice(idx, 0, block)
    selectedId.value = block.id
  }

  function removeBlock(id: string) {
    const idx = canvas.value.blocks.findIndex(b => b.id === id)
    if (idx === -1) return
    canvas.value.blocks.splice(idx, 1)
    if (selectedId.value === id) selectedId.value = null
  }

  function updateBlockProp(id: string, key: string, value: unknown) {
    const block = canvas.value.blocks.find(b => b.id === id)
    if (!block) return
    block.props = { ...block.props, [key]: value }
  }

  function moveBlock(id: string, direction: 'up' | 'down') {
    const blocks = canvas.value.blocks
    const idx = blocks.findIndex(b => b.id === id)
    if (idx === -1) return
    const target = direction === 'up' ? idx - 1 : idx + 1
    if (target < 0 || target >= blocks.length) return
    const block = blocks.splice(idx, 1)[0]
    if (!block) return
    blocks.splice(target, 0, block)
  }

  function reorderBlock(fromIndex: number, toIndex: number) {
    const blocks = canvas.value.blocks
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return
    if (fromIndex >= blocks.length || toIndex >= blocks.length) return
    const block = blocks.splice(fromIndex, 1)[0]
    if (!block) return
    // After removing fromIndex, positions after it shift left by 1
    const adjusted = toIndex > fromIndex ? toIndex - 1 : toIndex
    blocks.splice(adjusted, 0, block)
  }

  function duplicateBlock(id: string) {
    const idx = canvas.value.blocks.findIndex(b => b.id === id)
    if (idx === -1) return
    const orig = canvas.value.blocks[idx]
    if (!orig) return
    const clone: CanvasBlockData = {
      id: uuid(),
      type: orig.type,
      props: JSON.parse(JSON.stringify(orig.props)),
    }
    canvas.value.blocks.splice(idx + 1, 0, clone)
    selectedId.value = clone.id
  }

  function selectBlock(id: string | null) {
    selectedId.value = id
  }

  function reset(content: CanvasContent) {
    canvas.value = JSON.parse(JSON.stringify(content))
    selectedId.value = null
  }

  // ── Serialise ─────────────────────────────────────────────────────────────

  function toJSON(): CanvasContent {
    return JSON.parse(JSON.stringify(canvas.value))
  }

  return {
    canvas,
    selectedId,
    selectedBlock,
    selectedDefinition,
    addBlock,
    removeBlock,
    updateBlockProp,
    moveBlock,
    reorderBlock,
    duplicateBlock,
    selectBlock,
    reset,
    toJSON,
  }
}
