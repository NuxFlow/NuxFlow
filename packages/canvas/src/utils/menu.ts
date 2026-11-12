// The Menu block's items (a café's or restaurant's menu): parsing, grouping into sections,
// dietary codes, and schema.org Menu data for search engines. Shared by the block and the
// page's structured data (apps/nuxflow/app/utils/seo.ts). Import-free.

export interface DietaryCode {
  code: string
  label: string
  /** schema.org RestrictedDiet, where there is one. */
  diet?: string
}

/** The codes a menu item can carry, typed as e.g. "VG, GF". */
export const DIETARY_CODES: DietaryCode[] = [
  { code: 'V', label: 'Vegetarian', diet: 'VegetarianDiet' },
  { code: 'VG', label: 'Vegan', diet: 'VeganDiet' },
  { code: 'GF', label: 'Gluten free', diet: 'GlutenFreeDiet' },
  { code: 'DF', label: 'Dairy free' },
  { code: 'N', label: 'Contains nuts' },
  { code: 'H', label: 'Halal', diet: 'HalalDiet' },
  { code: 'S', label: 'Spicy' },
]

const BY_CODE = new Map(DIETARY_CODES.map(d => [d.code, d]))

export interface MenuItem {
  section: string
  name: string
  description: string
  price: string
  dietary: string[]
}

export interface MenuSection {
  title: string
  items: MenuItem[]
}

/** "vg, gf / S" → ["VG", "GF", "S"]: known codes only, in the order typed, once each. */
export function parseDietary(text: unknown): string[] {
  if (typeof text !== 'string') return []
  const codes = text.toUpperCase().split(/[\s,/;]+/).filter(c => BY_CODE.has(c))
  return [...new Set(codes)]
}

export function dietaryLabel(code: string): string {
  return BY_CODE.get(code)?.label ?? code
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

/** The block's items (a JSON string from its list field). Rows without a name are skipped. */
export function parseMenuItems(json: unknown): MenuItem[] {
  let list: unknown = json
  if (typeof json === 'string') {
    try {
      list = JSON.parse(json)
    }
    catch {
      list = []
    }
  }
  if (!Array.isArray(list)) return []
  return list
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
    .map(x => ({
      section: str(x.section, 120),
      name: str(x.name, 200),
      description: str(x.description, 1000),
      price: str(x.price, 40),
      dietary: parseDietary(x.dietary),
    }))
    .filter(i => i.name)
}

/**
 * Groups items into sections in the order they're written. An item with no section of its
 * own carries on the one above, so the section only needs typing on its first dish.
 */
export function menuSections(items: MenuItem[]): MenuSection[] {
  const sections: MenuSection[] = []
  for (const item of items) {
    const last = sections.at(-1)
    if (!last || (item.section && item.section !== last.title)) sections.push({ title: item.section, items: [item] })
    else last.items.push(item)
  }
  return sections
}

/** The dietary codes used anywhere on the menu, in the key's order. */
export function usedDietaryCodes(items: MenuItem[]): DietaryCode[] {
  const used = new Set(items.flatMap(i => i.dietary))
  return DIETARY_CODES.filter(d => used.has(d.code))
}

/** "£8.50", "8.5", "12,00 €" → 8.5 / 12 — the number for schema.org, or null. */
export function priceNumber(price: string): number | null {
  const m = /\d+(?:[.,]\d{1,2})?/.exec(price.replace(/\s/g, ''))
  if (!m) return null
  const n = Number(m[0].replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** schema.org Menu for one Menu block. */
export function menuJsonLd(name: string, sections: MenuSection[], currency: string): Record<string, unknown> {
  const code = /^[A-Z]{3}$/.test(currency.toUpperCase()) ? currency.toUpperCase() : undefined
  return {
    '@type': 'Menu',
    ...(name ? { name } : {}),
    hasMenuSection: sections.map(s => ({
      '@type': 'MenuSection',
      ...(s.title ? { name: s.title } : {}),
      hasMenuItem: s.items.map((i) => {
        const price = priceNumber(i.price)
        const diets = i.dietary.map(c => BY_CODE.get(c)?.diet).filter(Boolean).map(d => `https://schema.org/${d}`)
        return {
          '@type': 'MenuItem',
          name: i.name,
          ...(i.description ? { description: i.description } : {}),
          ...(price !== null ? { offers: { '@type': 'Offer', price: price.toFixed(2), ...(code ? { priceCurrency: code } : {}) } } : {}),
          ...(diets.length ? { suitableForDiet: diets } : {}),
        }
      }),
    })),
  }
}

interface BlockLike { type?: string; props?: Record<string, unknown>; children?: Record<string, BlockLike[]> }

/** schema.org Menus for every Menu block on a Canvas page (nested ones included). */
export function extractMenus(content: unknown): Record<string, unknown>[] {
  const c = content as { type?: string; blocks?: BlockLike[] } | null
  if (!c || c.type !== 'canvas' || !Array.isArray(c.blocks)) return []
  const out: Record<string, unknown>[] = []
  const visit = (list: BlockLike[]) => {
    for (const b of list) {
      if (b?.type === 'canvas-menu') {
        const items = parseMenuItems(b.props?.itemsJson)
        if (items.length) out.push(menuJsonLd(str(b.props?.title, 120), menuSections(items), str(b.props?.currency, 3) || 'GBP'))
      }
      for (const slot of Object.values(b?.children ?? {})) visit(slot ?? [])
    }
  }
  visit(c.blocks)
  return out
}
