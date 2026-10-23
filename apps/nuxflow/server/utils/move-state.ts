/**
 * Whether this database's copy of a site is the real one (`sites.move_state`, see
 * site-move.ts): true for every ordinary site and for one being moved away (still live,
 * locked); false for a copy still being written (`incoming`) or left behind after the
 * switch (`moved`). Lists, lookups and the router's directory skip copies that aren't,
 * so a site never shows up twice. No imports, so anything can use it.
 */
export function isServedCopy(moveState: string | null | undefined): boolean {
  return moveState !== 'incoming' && moveState !== 'moved'
}
