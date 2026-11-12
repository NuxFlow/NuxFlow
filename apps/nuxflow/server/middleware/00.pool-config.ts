import { poolConfigProblem } from '../utils/pool-config'

export default defineEventHandler((event) => {
  const problem = poolConfigProblem()
  if (!problem) return
  console.error(`[pool] Misconfigured, refusing requests: ${problem}`)
  setResponseStatus(event, 503)
  setHeader(event, 'Content-Type', 'application/json')
  return { statusCode: 503, statusMessage: 'This server is not set up correctly.' }
})
