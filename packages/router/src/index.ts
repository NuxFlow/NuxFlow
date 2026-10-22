// NuxFlow's front-door router — optional, only for a hosting platform with member pools
// (see apps/nuxflow/server/utils/control-plane.ts). It takes every request for customer
// addresses and passes it, untouched, to the Worker that serves that address: a member
// pool listed in the site directory, otherwise the control plane. Setup: README.md.
import { pickTarget, type RouterEnv } from './route'

export default {
  async fetch(request: Request, env: RouterEnv): Promise<Response> {
    const { target } = await pickTarget(request, env)
    // The same Request object: method, body, every header (Host, CF-Connecting-IP,
    // CF-IPCountry, cookies) reach the pool as they reached the router.
    return target.fetch(request)
  },
}
