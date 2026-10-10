import { defineCommand, runMain } from 'citty'
import { pluginCommand } from './commands/plugin'
import { themeCommand } from './commands/theme'

// Replaced at build time with package.json's version (build.mjs) — it was hard-coded and
// went stale.
declare const __NUXFLOW_CLI_VERSION__: string

const main = defineCommand({
  meta: {
    name: 'nuxflow',
    version: typeof __NUXFLOW_CLI_VERSION__ === 'string' ? __NUXFLOW_CLI_VERSION__ : 'dev',
    description: 'NuxFlow CLI — scaffold plugins, themes, and more',
  },
  subCommands: {
    plugin: pluginCommand,
    theme: themeCommand,
  },
})

runMain(main)
