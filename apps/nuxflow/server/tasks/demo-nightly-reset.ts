import { demoNightlyReset } from '../scheduled/demo-reset'

export default defineTask({
  meta: {
    name: 'demo-nightly-reset',
    description: 'Wipes and reseeds the demo database — runs on the 0 3 * * * cron',
  },
  async run() {
    const result = await demoNightlyReset()
    return { result }
  },
})
