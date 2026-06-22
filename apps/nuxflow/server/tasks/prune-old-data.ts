import { pruneOldData } from '../scheduled/prune-old-data'

export default defineTask({
  meta: {
    name: 'prune-old-data',
    description: 'Delete audit logs older than the retention window and trim content revisions beyond the per-item limit',
  },
  async run() {
    const result = await pruneOldData()
    return { result }
  },
})
