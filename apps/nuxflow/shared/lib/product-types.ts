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
