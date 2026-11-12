// A navigation menu's items, as stored in `menus.items` and served by
// GET /api/public/menus/:location and GET /api/v1/menus/:id. The shape is enforced on save
// by the Zod schema in server/api/v1/menus/[id].patch.ts — change both together.

/** One link: a page on the site (`contentId` + `slug`) or any address (`url`). */
export interface MenuLink {
  id: string
  label: string
  type: 'page' | 'url'
  url?: string
  /** The linked page's id. Only the menu editor uses it; public menus link by `slug`. */
  contentId?: string
  slug?: string
  target: '_self' | '_blank'
}

/** A top-level menu item: a link with an optional dropdown of links under it. */
export interface MenuItem extends MenuLink {
  children: MenuLink[]
}
