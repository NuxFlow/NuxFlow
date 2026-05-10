// Type declarations for Cloudflare-specific bindings used by the dynamic plugin system.
// The WorkerLoader interface reflects the Cloudflare Dynamic Workers open-beta API (March 2026).
// KVNamespace, D1Database, etc. are defined locally to avoid a hard dependency on @cloudflare/workers-types.

export interface KVNamespace {
  get(key: string, options?: { type?: 'text' }): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
}

export interface WorkerCode {
  compatibilityDate: string
  /** Name of the entry-point module — must be a key in `modules`. */
  mainModule: string
  /** Module name → ESM source string. */
  modules: Record<string, string>
  compatibilityFlags?: string[]
}

export interface DynamicWorkerEntrypoint {
  fetch(request: Request): Promise<Response>
}

export interface WorkerStub {
  getEntrypoint(): DynamicWorkerEntrypoint
}

export interface WorkerLoader {
  /**
   * Returns a cached WorkerStub synchronously; `factory` is called lazily on
   * first fetch() if the id is not yet cached. (Cloudflare Dynamic Workers API)
   */
  get(id: string, factory: () => Promise<WorkerCode>): WorkerStub
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]>
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[]
  success: boolean
  error?: string
  meta: {
    changed_db: boolean
    changes: number
    duration: number
    last_row_id: number
    rows_read: number
    rows_written: number
    size_after: number
  }
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>
  exec(query: string): Promise<{ count: number; duration: number }>
  dump(): Promise<ArrayBuffer>
}

export interface NuxFlowCloudflareEnv {
  PLUGIN_KV: KVNamespace
  LOADER: WorkerLoader
  DB?: D1Database
  [key: string]: unknown
}

declare module 'h3' {
  interface H3EventContext {
    cloudflare?: {
      env: NuxFlowCloudflareEnv
      request: Request
      ctx: { waitUntil(promise: Promise<unknown>): void }
    }
  }
}
