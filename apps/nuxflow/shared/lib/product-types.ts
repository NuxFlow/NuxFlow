// A shop product as visitors see it: built by toPublicProduct() (server/utils/products.ts),
// sent as `product` on the public page API and read by ProductDetails.vue. Import-free.

export interface PublicVariant {
  id: string
  options: string[]
  label: string
  priceMinor: number
  compareAtMinor: number | null
  price: string
  /** The price as a decimal string ("12.50"), for structured data. */
  amount: string
  compareAt: string | null
  kind: 'physical' | 'digital'
  imageUrl: string | null
  /** At the time the page was cached; the page asks again for the live stock. */
  available: boolean
}

export interface PublicProduct {
  id: string
  currency: string
  pricesIncludeTax: boolean
  optionNames: string[]
  images: { url: string; alt?: string }[]
  variants: PublicVariant[]
  priceLabel: string
  available: boolean
}

/** A variant as the product editor loads it (productForEditor() in server/utils/products.ts). */
export interface EditorProductVariant {
  id: string
  sku: string | null
  options: string[]
  priceMinor: number
  compareAtMinor: number | null
  /** Null: not tracked. */
  stock: number | null
  weightGrams: number | null
  kind: 'physical' | 'digital'
  imageUrl: string | null
  isActive: boolean
  /** A download's file, uploaded on its own rather than saved with the post. */
  fileName?: string | null
  fileSize?: number | null
}

/** A product as the editor loads it, and (with `stockWas` on each variant) saves it back. */
export interface EditorProduct {
  optionNames: string[]
  images: { url: string; alt?: string }[]
  variants: EditorProductVariant[]
}
