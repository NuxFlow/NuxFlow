import type { CanvasBlockData } from '@nuxflow/canvas'

/**
 * A single block instance stored in page content when using the page-builder format.
 * Same shape as CanvasBlockData — the page-builder and canvas content formats
 * share one block model, differing only in the top-level `type` discriminator
 * ('blocks' vs 'canvas'). The `type` field on the block itself maps to a
 * PluginBlock.id registered via useBlockRegistry.
 */
export type NuxBlockData = CanvasBlockData

/**
 * Top-level content structure used by the page builder.
 * Distinguishable from TipTap JSON by `type === 'blocks'`.
 */
interface NuxBlocksContent {
  type: 'blocks'
  blocks: NuxBlockData[]
}

export function isBlocksContent(content: unknown): content is NuxBlocksContent {
  return (
    typeof content === 'object'
    && content !== null
    && (content as NuxBlocksContent).type === 'blocks'
    && Array.isArray((content as NuxBlocksContent).blocks)
  )
}
