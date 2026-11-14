import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// In a <style scoped> block Vue compiles `:global(.dark) .thing { … }` to plain
// `.dark { … }` — everything after :global() is dropped. The dark-mode rule never
// reaches `.thing`, and lands on the whole <html class="dark"> instead. That made the
// Canvas settings panel's rich-text box dark-on-dark (invisible text) and gave <html>
// a forced `background-color: #111827 !important` in dark mode. Write
// `:where(.dark) .thing` instead, which scoping handles correctly.

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const roots = [path.join(appRoot, 'app'), path.resolve(appRoot, '../../packages/canvas/src')]

function vueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : vueFiles(full)
    return name.endsWith('.vue') ? [full] : []
  })
}

const SCOPED_STYLE_RE = /<style[^>]*\sscoped[^>]*>([\s\S]*?)<\/style>/g
// :global(...) followed by more selector before the rule's `{` or the next `,`.
const COMPOUND_GLOBAL_RE = /:global\([^)]*\)[ \t]*[^\s{,]/

describe('scoped styles', () => {
  it('never put more selector after :global(...) (Vue drops it)', () => {
    const offenders: string[] = []
    for (const file of roots.flatMap(vueFiles)) {
      const source = readFileSync(file, 'utf8')
      for (const [, css] of source.matchAll(SCOPED_STYLE_RE)) {
        for (const line of css!.split('\n')) {
          if (COMPOUND_GLOBAL_RE.test(line)) offenders.push(`${path.relative(appRoot, file)}: ${line.trim()}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
