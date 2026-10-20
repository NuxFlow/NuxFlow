import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Nuxt UI's UTable renders a column with `header: ''` differently on the server and the
// client, so every page with one logged a hydration mismatch (and the column had no
// accessible name). Use `header: actionsHeader` (app/utils/table.ts) instead.

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(?:vue|ts)$/.test(name) ? [full] : []
  })
}

describe('table column headers', () => {
  it('no UTable column uses an empty-string header', () => {
    const offenders = sourceFiles(appDir)
      .filter(f => /header:\s*(?:''|"")/.test(readFileSync(f, 'utf8')))
      .map(f => path.relative(appDir, f))
    expect(offenders).toEqual([])
  })
})
