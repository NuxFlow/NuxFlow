import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { consola } from 'consola'

/**
 * Reads and parses a JSON manifest file from a project directory (e.g. a
 * plugin's `nuxflow.plugin.json` or a theme's `nuxflow.theme.json`), throwing
 * a friendly, kind-specific error when the file is missing.
 *
 * Shared by `commands/plugin.ts` and `commands/theme.ts` — the two manifests
 * differ only in filename and the noun used in the error message.
 */
export async function readManifest<T>(dir: string, filename: string, kind: string): Promise<T> {
  const raw = await readFile(join(dir, filename), 'utf-8').catch(() => null)
  if (!raw) throw new Error(`${filename} not found — run this command from a ${kind} directory`)
  return JSON.parse(raw) as T
}

/**
 * Awaits `promise`, printing a friendly error and exiting the process on
 * rejection instead of throwing. Extracted from the
 * `.catch((e: Error) => { consola.error(e.message); process.exit(1) })`
 * pattern repeated across `plugin.ts`'s and `theme.ts`'s manifest/dist-json/
 * private-key/CSS reads.
 */
export function orExit<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((e: unknown) => {
    consola.error((e as Error).message)
    process.exit(1)
  })
}
