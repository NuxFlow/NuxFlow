import type { Component } from 'vue'

import CanvasBlockHero from './CanvasBlockHero.vue'
import CanvasBlockText from './CanvasBlockText.vue'
import CanvasBlockImage from './CanvasBlockImage.vue'
import CanvasBlockColumns from './CanvasBlockColumns.vue'
import CanvasBlockContainer from './CanvasBlockContainer.vue'
import CanvasBlockCta from './CanvasBlockCta.vue'
import CanvasBlockSpacer from './CanvasBlockSpacer.vue'
import CanvasBlockVideo from './CanvasBlockVideo.vue'
import CanvasBlockTestimonial from './CanvasBlockTestimonial.vue'
import CanvasBlockFeatures from './CanvasBlockFeatures.vue'
import CanvasBlockButton from './CanvasBlockButton.vue'
import CanvasBlockAccordion from './CanvasBlockAccordion.vue'
import CanvasBlockPricing from './CanvasBlockPricing.vue'
import CanvasBlockCalendar from './CanvasBlockCalendar.vue'
import CanvasBlockGdpr from './CanvasBlockGdpr.vue'
import CanvasBlockFooter from './CanvasBlockFooter.vue'
import CanvasBlockGallery from './CanvasBlockGallery.vue'
import CanvasBlockCarousel from './CanvasBlockCarousel.vue'
import HtmlBlock from './HtmlBlock.vue'

/**
 * Single source of truth mapping every *built-in* block's `CanvasBlockDefinition.id`
 * (see `CANVAS_BLOCKS` in `./definitions.ts`) to its real Vue component. "Built-in"
 * means the component ships inside this package — it does NOT cover the handful of
 * app-owned built-ins that live in `apps/nuxflow` (ContactFormBlock, DynamicFormBlock,
 * MembershipsBlock) or genuine dynamic-plugin blocks. Both of those continue to resolve
 * exclusively through the host app's own registry (`useBlockRegistry.ts`, injected as
 * `'nuxflow:blockRegistry'`) — never through this map — which preserves the metadata
 * vs. rendering split CLAUDE.md documents: a dynamic plugin's block metadata
 * (`src/blocks.json`) is readable synchronously with no live component required, and
 * its actual component only has to exist once an instance of it is rendered.
 *
 * Previously this id -> component association was hand-duplicated in independent
 * places (this package's own `CanvasBlock.vue` editor renderer, and the host app's
 * `nuxflow-plugin-components.ts` SSR registration) that had to be kept in sync by
 * hand. Both now read from this single map — see `getBuiltinComponentIds()`/its
 * consumers if a future built-in needs excluding from one of those without a second
 * hand-maintained list.
 */
export const BUILTIN_BLOCK_COMPONENTS: Record<string, Component> = {
  'canvas-hero': CanvasBlockHero,
  'canvas-text': CanvasBlockText,
  'canvas-image': CanvasBlockImage,
  'canvas-columns': CanvasBlockColumns,
  'canvas-container': CanvasBlockContainer,
  'canvas-cta': CanvasBlockCta,
  'canvas-spacer': CanvasBlockSpacer,
  'canvas-video': CanvasBlockVideo,
  'canvas-testimonial': CanvasBlockTestimonial,
  'canvas-features': CanvasBlockFeatures,
  'canvas-button': CanvasBlockButton,
  'canvas-accordion': CanvasBlockAccordion,
  'canvas-pricing': CanvasBlockPricing,
  'canvas-calendar': CanvasBlockCalendar,
  'canvas-gdpr': CanvasBlockGdpr,
  'canvas-footer': CanvasBlockFooter,
  'canvas-gallery': CanvasBlockGallery,
  'canvas-carousel': CanvasBlockCarousel,
  'html-block/html': HtmlBlock,
}
