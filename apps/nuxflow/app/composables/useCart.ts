import { addToBasket, MAX_LINE_QUANTITY } from '#shared/lib/shop'

/**
 * The shop basket. It lives in the browser's localStorage, never a cookie (a cookie would
 * switch the page cache off for every page), and holds only what to show until the server
 * prices it again: the basket page and checkout always ask the server for today's prices.
 */
export interface CartItem {
  variantId: string
  quantity: number
  title: string
  /** "M / Blue", or "". */
  label: string
  /** As last seen, for the header and a quick look; the basket page re-prices. */
  price: string
  image: string | null
  path: string
}

const STORAGE_KEY = 'nuxflow:cart:v1'

function read(): CartItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown
    return Array.isArray(parsed)
      ? parsed.filter((i): i is CartItem => Boolean(i) && typeof (i as CartItem).variantId === 'string' && Number.isInteger((i as CartItem).quantity))
      : []
  }
  catch {
    return []
  }
}

function write(items: CartItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  }
  catch {
    // Private windows can refuse storage; the basket then lasts until the tab closes.
  }
}

export function useCart() {
  const items = useState<CartItem[]>('shop:cart', () => [])
  const loaded = useState('shop:cart-loaded', () => false)

  // Read once in the browser, after hydration, so the server and first client render agree.
  if (import.meta.client && !loaded.value && getCurrentInstance()) {
    onMounted(() => {
      if (loaded.value) return
      items.value = read()
      loaded.value = true
      // Another tab changed the basket.
      window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY) items.value = read()
      })
    })
  }

  const count = computed(() => items.value.reduce((n, i) => n + i.quantity, 0))

  function save(next: CartItem[]) {
    items.value = next
    write(next)
  }

  return {
    items,
    count,
    loaded,
    add(item: CartItem) {
      save(addToBasket(loaded.value ? items.value : read(), item))
      loaded.value = true
    },
    setQuantity(variantId: string, quantity: number) {
      const q = Math.min(MAX_LINE_QUANTITY, Math.floor(quantity))
      save(q <= 0 ? items.value.filter(i => i.variantId !== variantId) : items.value.map(i => (i.variantId === variantId ? { ...i, quantity: q } : i)))
    },
    remove(variantId: string) {
      save(items.value.filter(i => i.variantId !== variantId))
    },
    clear() {
      save([])
    },
  }
}
