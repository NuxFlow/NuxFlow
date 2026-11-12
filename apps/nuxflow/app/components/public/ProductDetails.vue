<script lang="ts">
</script>

<script setup lang="ts">
import type { PublicProduct, PublicVariant } from '#shared/lib/product-types'
import { NuxImage } from '@nuxflow/canvas'
import { sameOptions } from '#shared/lib/shop'

// What a product page shows up top: pictures, price, the options to choose between, and
// whether it's in stock. The page is cached whole, so stock is asked for again in the
// browser; everything else comes with the page.
const props = defineProps<{
  product: PublicProduct
  title: string
  /** The featured image, shown first. */
  image?: string | null
}>()

const emit = defineEmits<{ variant: [PublicVariant | null] }>()

const selected = ref<string[]>(props.product.variants[0]?.options.slice() ?? [])

const variant = computed(() => props.product.variants.find(v => sameOptions(v.options, selected.value)) ?? null)
watch(variant, v => emit('variant', v), { immediate: true })

/** The values an option offers, in the order the variants list them. */
function valuesFor(i: number): string[] {
  return [...new Set(props.product.variants.map(v => v.options[i]!).filter(Boolean))]
}

function choose(i: number, value: string) {
  const next = selected.value.slice()
  next[i] = value
  // A combination that doesn't exist moves the other options to the nearest one that does.
  if (!props.product.variants.some(v => sameOptions(v.options, next))) {
    const near = props.product.variants.find(v => v.options[i] === value)
    if (near) {
      selected.value = near.options.slice()
      return
    }
  }
  selected.value = next
}

// ── Live stock ────────────────────────────────────────────────────────────

const live = ref<Record<string, { state: 'in_stock' | 'low' | 'out'; message: string }>>({})
onMounted(async () => {
  try {
    const result = await $fetch<{ variants: { id: string; state: 'in_stock' | 'low' | 'out'; message: string }[] }>('/api/public/shop', { query: { product: props.product.id } })
    live.value = Object.fromEntries(result.variants.map(v => [v.id, v]))
  }
  catch {
    // The cached availability stands in.
  }
})

const stock = computed(() => {
  const v = variant.value
  if (!v) return { state: 'out' as const, message: 'Not available in this combination' }
  return live.value[v.id] ?? (v.available ? { state: 'in_stock' as const, message: 'In stock' } : { state: 'out' as const, message: 'Out of stock' })
})

const canBuy = computed(() => stock.value.state !== 'out')

// ── Basket ────────────────────────────────────────────────────────────────

const cart = useCart()
const route = useRoute()
const quantity = ref(1)
const added = ref(false)
watch(variant, () => { added.value = false })

function addToBasket() {
  const v = variant.value
  if (!v) return
  cart.add({ variantId: v.id, quantity: quantity.value, title: props.title, label: v.label, price: v.price, image: v.imageUrl || props.image || null, path: route.path })
  added.value = true
}
defineExpose({ variant, canBuy })

// ── Pictures ──────────────────────────────────────────────────────────────

const pictures = computed(() => {
  const list: { url: string; alt: string }[] = []
  if (props.image) list.push({ url: props.image, alt: props.title })
  for (const img of props.product.images) list.push({ url: img.url, alt: img.alt || props.title })
  return list
})
const shown = ref(0)
// Choosing a variant with its own picture shows that picture.
const mainPicture = computed(() => variant.value?.imageUrl
  ? { url: variant.value.imageUrl, alt: `${props.title} – ${variant.value.label}` }
  : pictures.value[shown.value] ?? null)
watch(variant, () => { if (variant.value?.imageUrl) shown.value = -1 })
</script>

<template>
  <section class="nuxflow-product grid gap-8 md:grid-cols-2">
    <div v-if="mainPicture || pictures.length" class="space-y-3">
      <NuxImage v-if="mainPicture" :src="mainPicture.url" :alt="mainPicture.alt" :width="800" :height="800" fit="cover" loading="eager" class="w-full aspect-square object-cover rounded-2xl" />
      <div v-if="pictures.length > 1" class="flex flex-wrap gap-2">
        <button
          v-for="(pic, i) in pictures"
          :key="`${pic.url}-${i}`"
          type="button"
          class="h-16 w-16 overflow-hidden rounded-lg border-2"
          :class="i === shown ? 'border-primary-500' : 'border-transparent'"
          :aria-label="`Show picture ${i + 1}`"
          @click="shown = i"
        >
          <NuxImage :src="pic.url" :alt="''" :width="64" :height="64" fit="cover" class="h-full w-full object-cover" />
        </button>
      </div>
    </div>

    <div class="space-y-5">
      <div>
        <p class="nuxflow-product-price text-2xl font-semibold text-gray-900 dark:text-white">
          {{ variant?.price ?? product.priceLabel }}
          <s v-if="variant?.compareAt" class="ml-2 text-lg font-normal text-gray-400">{{ variant.compareAt }}</s>
        </p>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ product.pricesIncludeTax ? 'Including tax.' : 'Plus tax, worked out at checkout.' }}</p>
      </div>

      <div v-for="(name, i) in product.optionNames" :key="name" class="space-y-2">
        <p class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ name }}: <span class="font-normal">{{ selected[i] }}</span></p>
        <div class="flex flex-wrap gap-2" role="radiogroup" :aria-label="name">
          <UButton
            v-for="value in valuesFor(i)"
            :key="value"
            size="sm"
            role="radio"
            :aria-checked="selected[i] === value"
            :variant="selected[i] === value ? 'solid' : 'outline'"
            color="neutral"
            @click="choose(i, value)"
          >
            {{ value }}
          </UButton>
        </div>
      </div>

      <p class="text-sm" :class="stock.state === 'out' ? 'text-red-600' : stock.state === 'low' ? 'text-amber-600' : 'text-green-700 dark:text-green-500'">
        {{ stock.message }}<template v-if="variant?.kind === 'digital' && canBuy"> · Download straight after paying</template>
      </p>

      <div v-if="canBuy && variant" class="flex flex-wrap items-center gap-3">
        <UInputNumber v-model="quantity" :min="1" :max="20" class="w-28" aria-label="Quantity" />
        <UButton size="lg" icon="i-lucide-shopping-bag" @click="addToBasket">Add to basket</UButton>
      </div>
      <p v-if="added" class="text-sm text-gray-600 dark:text-gray-400" role="status">
        Added to your basket. <NuxtLink to="/checkout" class="underline font-medium">View basket</NuxtLink>
      </p>

      <slot :variant="variant" :can-buy="canBuy" />
    </div>
  </section>
</template>
