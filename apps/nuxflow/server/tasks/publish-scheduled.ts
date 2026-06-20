import { publishScheduled } from '../scheduled/publish-scheduled'

export default defineTask({
  meta: {
    name: 'publish-scheduled',
    description: 'Publish content items whose scheduledAt has passed',
  },
  async run() {
    const result = await publishScheduled()
    return { result }
  },
})
