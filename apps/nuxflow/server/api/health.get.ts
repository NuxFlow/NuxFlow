import { version } from '../../package.json'

export default defineEventHandler(() => ({ status: 'ok', version }))
