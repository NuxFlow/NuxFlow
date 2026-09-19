import { demoFirstBoot } from '../scheduled/demo-reset'

export default defineTask({
  meta: {
    name: 'demo-reset',
    description: 'Seeds the demo database on first boot if it is empty',
  },
  async run() {
    const result = await demoFirstBoot()
    return { result }
  },
})
