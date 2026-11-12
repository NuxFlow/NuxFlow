import { listStarters } from '../../../utils/starters/install'

// The starter sites the setup wizard (and the hosting sign-up page on the accounts origin)
// offers. Public: the catalog is public, and this path is answered before any site exists.
export default defineEventHandler(async () => {
  return listStarters()
})
