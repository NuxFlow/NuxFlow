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

/** An upcoming event as the Calendar block shows it (GET /api/public/events in NuxFlow). */
export interface CanvasEventItem {
  id: string
  slug?: string
  title: string
  excerpt?: string
  eventStartAt: string
  eventEndAt?: string
  eventAllDay?: boolean
  eventLocation?: string
  eventUrl?: string
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
  listEvents(limit: number): Promise<CanvasEventItem[]>
  /** Alternative wordings of `text` for the inline AI menu. */
  improveText(text: string, instruction: AiInstruction): Promise<string[]>
  /** A whole Canvas page from a description (the editor's "Generate with AI"). */
  generatePage(request: CanvasPageRequest): Promise<CanvasContent>
  /** Focal point of a media-library image, as percentages (0–100) from the top left. */
  suggestFocalPoint(url: string): Promise<{ focalX: number; focalY: number }>
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
