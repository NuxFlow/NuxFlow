import { inject, type Component, type InjectionKey } from 'vue'
import type { CanvasContent } from './types'
import type { AiInstruction } from './editor/useAiImprove'

/** A post as the Posts block lists it (GET /api/public/posts in NuxFlow). */
export interface CanvasPostItem {
  id: string
  title: string
  path: string
  excerpt: string | null
  ogImage: string | null
  publishedAt: string | null
}

/** An event as the Calendar block shows it (GET /api/public/events in NuxFlow). */
export interface CanvasEventItem {
  id: string
  slug?: string
  title: string
  /** The event's own page. */
  path?: string
  excerpt?: string | null
  eventStartAt: string
  eventEndAt?: string | null
  eventAllDay?: boolean | null
  eventLocation?: string | null
  eventUrl?: string | null
  /** Its "Add to calendar" file. */
  icsUrl?: string
  /** Visitors can RSVP on its page. */
  rsvp?: boolean
  /** Which date of a repeating event this is. */
  date?: string | null
  /** Per place, when it's paid. */
  price?: number | null
  currency?: string | null
  /** Its terms in the taxonomy asked for. */
  terms?: Array<{ slug: string; name: string }>
}

export interface CanvasClassPass {
  id: string
  name: string
  description?: string | null
  credits: number
  price: number
  currency: string
  validDays?: number | null
}

export interface CanvasEventsQuery {
  limit: number
  /** Overlapping this window, as ISO 8601. Without one: what's coming up, or `past`. */
  from?: string
  to?: string
  past?: boolean
  /** Adds each event's terms in this taxonomy. */
  taxonomy?: string
}

export interface CanvasEventList {
  events: CanvasEventItem[]
  /** The site's time zone, which every time is shown in. */
  timeZone: string
  /** The site's calendar subscription address. */
  feedUrl?: string
}

export interface CanvasPostsQuery {
  limit: number
  type?: string
  taxonomy?: string
  term?: string
}

export interface CanvasPageRequest {
  description: string
  tone: string
  pageGoal: string
}

/**
 * Everything this package needs from the app it runs in: data for the blocks that list
 * site content, the editor's AI actions, and two app components. The app provides one
 * instance at its root (`provide(canvasHostKey, …)`, NuxFlow's app/plugins/canvas-host.ts),
 * so no block or editor component knows an API path. Methods throw an `Error` whose
 * message is fit to show the user.
 */
export interface CanvasHost {
  listPosts(query: CanvasPostsQuery): Promise<CanvasPostItem[]>
  listEvents(query: CanvasEventsQuery): Promise<CanvasEventList>
  /** The class passes on sale, and where to go to buy one. */
  listClassPasses?(): Promise<{ passes: CanvasClassPass[]; canBuy: boolean }>
  /** Alternative wordings of `text` for the inline AI menu. */
  improveText(text: string, instruction: AiInstruction): Promise<string[]>
  /** A whole Canvas page from a description (the editor's "Generate with AI"). */
  generatePage(request: CanvasPageRequest): Promise<CanvasContent>
  /** Focal point of a media-library image, as percentages (0–100) from the top left. */
  suggestFocalPoint(url: string): Promise<{ focalX: number; focalY: number }>
  /**
   * The player URL for a Cloudflare Stream video that may be private (playable only with
   * a signed link): a signed player URL, or null when the video is public and its plain
   * URL works. `blockId`/`path` name the Video block on the public page being viewed
   * (empty inside the editor, where the signed-in team member is the authorization).
   */
  videoPlaybackUrl?(request: { streamId: string; blockId: string; path: string }): Promise<string | null>
  /** Media library picker dialog — emits `select(PickedMedia)` / `selectMany(PickedMedia[])`. */
  mediaPicker?: Component
  /** Dictation button — emits `transcribed(text)`. */
  voiceInput?: Component
}

export const canvasHostKey: InjectionKey<CanvasHost> = Symbol('nuxflow:canvas-host')

export function useCanvasHost(): CanvasHost {
  const host = inject(canvasHostKey, null)
  if (!host) throw new Error('@nuxflow/canvas: no CanvasHost provided — the app must provide(canvasHostKey, …) at its root')
  return host
}
