/**
 * A single block instance stored in page content when using the page-builder format.
 * The `type` maps to a PluginBlock.id registered via useBlockRegistry.
 */
export interface NuxBlockData {
  /** Unique instance ID (ulid) — stable across edits */
  id: string
  /** Block type identifier, e.g. 'page-builder/hero' or 'contact-form/form' */
  type: string
  /** Block-specific configuration props passed directly to the block component */
  props: Record<string, unknown>
}

/**
 * Top-level content structure used by the page builder.
 * Distinguishable from TipTap JSON by `type === 'blocks'`.
 */
export interface NuxBlocksContent {
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
