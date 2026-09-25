/**
 * Consistency tests for the two-layer scheduled task setup (CLAUDE.md "Scheduled tasks"):
 * business logic in server/scheduled/, thin defineTask() wrappers in server/tasks/, and a
 * cron registration in nuxt.config.ts's nitro.scheduledTasks. A task missing from any one
 * layer silently never runs, so each direction is checked here, plus the wrappers'
 * error-attribution behaviour.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const taskFiles = readdirSync(resolve(root, 'server/tasks')).filter(f => f.endsWith('.ts')).map(f => f.replace(/\.ts$/, ''))
const scheduledFiles = readdirSync(resolve(root, 'server/scheduled')).filter(f => f.endsWith('.ts')).map(f => f.replace(/\.ts$/, ''))

function registeredTaskNames(): string[] {
  const config = readFileSync(resolve(root, 'nuxt.config.ts'), 'utf8')
  const start = config.indexOf('scheduledTasks: {')
  expect(start, 'nitro.scheduledTasks block in nuxt.config.ts').toBeGreaterThan(-1)
  const block = config.slice(start, config.indexOf('\n    },', start))
  return [...block.matchAll(/'[^']+':\s*\[([^\]]*)\]/g)]
    .flatMap(m => [...m[1]!.matchAll(/'([^']+)'/g)].map(n => n[1]!))
}

describe('scheduled task registry', () => {
  it('registers every task file on a cron schedule', () => {
    const registered = new Set(registeredTaskNames())
    for (const t of taskFiles) expect(registered.has(t), `server/tasks/${t}.ts is not in nitro.scheduledTasks`).toBe(true)
  })

  it('has a task file for every registered name', () => {
    for (const name of registeredTaskNames()) expect(taskFiles, `nitro.scheduledTasks names '${name}'`).toContain(name)
  })

  it('wires every server/scheduled module into at least one task', () => {
    const taskSources = taskFiles.map(t => readFileSync(resolve(root, `server/tasks/${t}.ts`), 'utf8')).join('\n')
    for (const s of scheduledFiles) expect(taskSources, `server/scheduled/${s}.ts is never run`).toContain(`../scheduled/${s}'`)
  })

  it('enables Nitro\'s experimental task system', () => {
    expect(readFileSync(resolve(root, 'nuxt.config.ts'), 'utf8')).toMatch(/tasks:\s*true/)
  })
})

describe('task wrappers', () => {
  globalThis.defineTask = ((def: unknown) => def) as never

  it.each(taskFiles)('%s: meta.name matches its file and failures are logged, then rethrown', async (name) => {
    const src = readFileSync(resolve(root, `server/tasks/${name}.ts`), 'utf8')
    const [, fn, mod] = src.match(/import \{ (\w+) \} from '\.\.\/scheduled\/([\w-]+)'/)!
    vi.resetModules()
    vi.doMock(`../../server/scheduled/${mod}`, () => ({ [fn!]: vi.fn().mockRejectedValue(new Error('boom')) }))
    const { default: task } = await import(`../../server/tasks/${name}.ts`) as { default: { meta: { name: string }; run: () => Promise<unknown> } }

    expect(task.meta.name).toBe(name)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(task.run()).rejects.toThrow('boom')
    expect(spy.mock.calls[0]?.[0]).toContain(`[${name}]`)
    spy.mockRestore()
    vi.doUnmock(`../../server/scheduled/${mod}`)
  })
})
