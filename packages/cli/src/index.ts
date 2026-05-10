import { defineCommand, runMain } from 'citty'
import { pluginCommand } from './commands/plugin'
import { themeCommand } from './commands/theme'

const main = defineCommand({
  meta: {
    name: 'nuxflow',
    version: '0.1.0',
    description: 'NuxFlow CLI — scaffold plugins, themes, and more',
  },
  subCommands: {
    plugin: pluginCommand,
    theme: themeCommand,
  },
})

runMain(main)
