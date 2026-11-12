<script setup lang="ts">
// Product sidebar card for the `product` content type: options (size, colour…), the variants
// they make, and each variant's price, stock and image. Saved with the post (`product` on
// the content PATCH), like the event card's fields.
import { ulid } from 'ulid'
import { fromMinorUnits, toMinorUnits } from '#shared/lib/money'
import { MAX_OPTIONS, optionCombinations, sameOptions, variantLabel } from '#shared/lib/shop'
import type { EditorProduct, EditorProductVariant } from '#shared/lib/product-types'

/** A variant in the form: as the server sent it, plus the stock it had when the editor opened. */
export interface ProductFormVariant extends EditorProductVariant {
  /** What was loaded, so a stock change is saved as a difference (see products.ts). */
  stockWas: number | null
}

export interface ProductForm extends Omit<EditorProduct, 'variants'> {
  variants: ProductFormVariant[]
}

const product = defineModel<ProductForm>('product', { required: true })

const props = defineProps<{
  /** The shop's currency (Admin → Shop). */
  currency: string
  /** False until the product's first save: a file can only go on a saved variant. */
  saved: boolean
}>()

// ── Download files ────────────────────────────────────────────────────────

const { run, isRunning } = useAdminAction()

async function uploadFile(v: ProductFormVariant, event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const form = new FormData()
  form.append('variantId', v.id)
  form.append('file', file)
  await run(async () => {
    const stored = await $fetch<{ fileName: string; fileSize: number }, string>('/api/v1/shop', { method: 'POST', body: form })
    v.fileName = stored.fileName
    v.fileSize = stored.fileSize
  }, { key: `file:${v.id}`, successTitle: 'File uploaded', errorTitle: "Couldn't upload the file" })
}

async function removeFile(v: ProductFormVariant) {
  await run(async () => {
    await $fetch<unknown, string>('/api/v1/shop', { method: 'POST', body: { action: 'remove-file', variantId: v.id } })
    v.fileName = null
    v.fileSize = null
  }, { key: `file:${v.id}`, successTitle: 'File removed', errorTitle: "Couldn't remove the file" })
}

const megabytes = (bytes: number | null | undefined) => (bytes ? `${(bytes / 1_048_576).toFixed(1)} MB` : '')

// ── Options ────────────────────────────────────────────────────────────────

// Values are edited as text ("S, M, L") and only turned into variants on request, so typing
// doesn't make and delete variants with every keystroke.
const optionDrafts = ref<{ name: string; values: string }[]>([])

function draftsFromProduct() {
  optionDrafts.value = product.value.optionNames.map((name, i) => ({
    name,
    values: [...new Set(product.value.variants.map(v => v.options[i] ?? '').filter(Boolean))].join(', '),
  }))
}
draftsFromProduct()

const draftValues = (d: { values: string }) => [...new Set(d.values.split(',').map(v => v.trim()).filter(Boolean))]

const draftsDiffer = computed(() => {
  const combos = optionCombinations(optionDrafts.value.map(draftValues))
  const names = optionDrafts.value.map(d => d.name.trim())
  if (names.join('\u0000') !== product.value.optionNames.join('\u0000')) return true
  return combos.length !== product.value.variants.length || combos.some(c => !product.value.variants.some(v => sameOptions(v.options, c)))
})

function addOption() {
  if (optionDrafts.value.length < MAX_OPTIONS) optionDrafts.value.push({ name: optionDrafts.value.length ? '' : 'Size', values: '' })
}

function removeOption(i: number) {
  optionDrafts.value.splice(i, 1)
}

function blankVariant(options: string[], like?: ProductFormVariant): ProductFormVariant {
  return {
    id: ulid(),
    sku: null,
    options,
    priceMinor: like?.priceMinor ?? 0,
    compareAtMinor: like?.compareAtMinor ?? null,
    stock: like?.stock === null || like === undefined ? null : 0,
    stockWas: null,
    weightGrams: like?.weightGrams ?? null,
    kind: like?.kind ?? 'physical',
    imageUrl: null,
    isActive: true,
  }
}

const optionError = ref('')

/** Rebuilds the variant list from the options, keeping every variant that still exists. */
function applyOptions() {
  optionError.value = ''
  const drafts = optionDrafts.value.filter(d => d.name.trim() || d.values.trim())
  if (drafts.some(d => !d.name.trim() || !draftValues(d).length)) {
    optionError.value = 'Give each option a name and at least one value.'
    return
  }
  const names = drafts.map(d => d.name.trim())
  if (new Set(names.map(n => n.toLowerCase())).size !== names.length) {
    optionError.value = 'Two options have the same name.'
    return
  }
  const combos = optionCombinations(drafts.map(draftValues))
  if (combos.length > 100) {
    optionError.value = `That makes ${combos.length} variants; a product can have up to 100.`
    return
  }
  const old = product.value.variants
  const first = old[0]
  const sameNames = names.length === product.value.optionNames.length
  product.value = {
    ...product.value,
    optionNames: names,
    variants: combos.map((combo) => {
      // Same options as before: the same variant, with its price, stock and history.
      const kept = sameNames ? old.find(v => sameOptions(v.options, combo)) : undefined
      if (kept) return { ...kept, options: combo }
      // A product getting its first option keeps its one variant as the first combination.
      if (!product.value.optionNames.length && old.length === 1 && combo === combos[0]) return { ...old[0]!, options: combo }
      return blankVariant(combo, first)
    }),
  }
  draftsFromProduct()
}

// ── Variants ──────────────────────────────────────────────────────────────

const major = (minor: number | null) => (minor === null ? null : fromMinorUnits(minor, props.currency))
const minor = (value: unknown) => toMinorUnits(Number(value) || 0, props.currency)

function setPrice(v: ProductFormVariant, value: unknown) {
  v.priceMinor = minor(value)
}

function setCompareAt(v: ProductFormVariant, value: unknown) {
  v.compareAtMinor = value === '' || value === null || Number(value) <= 0 ? null : minor(value)
}

function setTracked(v: ProductFormVariant, tracked: boolean) {
  v.stock = tracked ? (v.stockWas ?? 0) : null
}

function setStock(v: ProductFormVariant, value: unknown) {
  v.stock = Math.max(0, Math.floor(Number(value) || 0))
}

function setWeight(v: ProductFormVariant, value: unknown) {
  v.weightGrams = value === '' || value === null ? null : Math.max(0, Math.round(Number(value) || 0))
}

const openVariant = ref<string | null>(product.value.variants.length === 1 ? product.value.variants[0]!.id : null)

// ── Pictures ──────────────────────────────────────────────────────────────

const pickerFor = ref<'gallery' | string | null>(null)
const pickerOpen = computed({
  get: () => pickerFor.value !== null,
  set: (open) => { if (!open) pickerFor.value = null },
})

function onPicked(file: { url: string; altText?: string }) {
  if (pickerFor.value === 'gallery') {
    product.value.images = [...product.value.images, { url: file.url, ...(file.altText ? { alt: file.altText } : {}) }]
  }
  else {
    const v = product.value.variants.find(x => x.id === pickerFor.value)
    if (v) v.imageUrl = file.url
  }
  pickerFor.value = null
}

function removeImage(i: number) {
  product.value.images = product.value.images.filter((_, j) => j !== i)
}
</script>

<template>
  <UCard class="text-sm">
    <p class="font-medium mb-1">Product</p>
    <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">Prices in {{ currency }}. The featured image below is the main picture.</p>

    <div class="space-y-4">
      <!-- Options -->
      <div class="space-y-2">
        <p class="text-xs font-medium text-gray-600 dark:text-gray-300">Options</p>
        <p v-if="!optionDrafts.length" class="text-xs text-gray-500 dark:text-gray-400">None: one price for the product. Add options for sizes, colours and so on.</p>
        <div v-for="(d, i) in optionDrafts" :key="i" class="flex gap-2 items-start">
          <UInput v-model="d.name" size="xs" placeholder="Size" maxlength="60" class="w-24" :aria-label="`Option ${i + 1} name`" />
          <UInput v-model="d.values" size="xs" placeholder="S, M, L" class="flex-1" :aria-label="`Option ${i + 1} values, separated by commas`" />
          <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-x" :aria-label="`Remove option ${i + 1}`" @click="removeOption(i)" />
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton v-if="optionDrafts.length < MAX_OPTIONS" size="xs" variant="outline" color="neutral" icon="i-lucide-plus" @click="addOption">Add option</UButton>
          <UButton v-if="draftsDiffer" size="xs" icon="i-lucide-refresh-cw" @click="applyOptions">Update variants</UButton>
        </div>
        <p v-if="optionError" class="text-xs text-red-600">{{ optionError }}</p>
      </div>

      <!-- Variants -->
      <div class="space-y-2">
        <p class="text-xs font-medium text-gray-600 dark:text-gray-300">{{ product.variants.length === 1 && !product.optionNames.length ? 'Price and stock' : 'Variants' }}</p>
        <div v-for="v in product.variants" :key="v.id" class="rounded-lg border border-gray-200 dark:border-gray-800">
          <button
            v-if="product.optionNames.length"
            type="button"
            class="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
            :aria-expanded="openVariant === v.id"
            @click="openVariant = openVariant === v.id ? null : v.id"
          >
            <span class="font-medium" :class="{ 'line-through text-gray-400': !v.isActive }">{{ variantLabel(v.options) }}</span>
            <span class="text-xs text-gray-500">{{ major(v.priceMinor)?.toFixed(2) }}<template v-if="v.stock !== null"> · {{ v.stock }} left</template></span>
          </button>
          <div v-if="openVariant === v.id || !product.optionNames.length" class="space-y-2 px-3 pb-3" :class="{ 'pt-3': !product.optionNames.length }">
            <div class="grid grid-cols-2 gap-2">
              <UFormField label="Price" class="text-xs">
                <UInput :model-value="major(v.priceMinor) ?? 0" type="number" min="0" step="0.01" size="xs" @update:model-value="setPrice(v, $event)" />
              </UFormField>
              <UFormField label="Was" hint="Optional" class="text-xs">
                <UInput :model-value="major(v.compareAtMinor) ?? undefined" type="number" min="0" step="0.01" size="xs" @update:model-value="setCompareAt(v, $event)" />
              </UFormField>
            </div>
            <div class="grid grid-cols-2 gap-2 items-end">
              <UFormField label="Type" class="text-xs">
                <USelect v-model="v.kind" size="xs" :items="[{ label: 'Posted', value: 'physical' }, { label: 'Download', value: 'digital' }]" />
              </UFormField>
              <UFormField label="SKU" hint="Optional" class="text-xs">
                <UInput :model-value="v.sku ?? ''" size="xs" maxlength="64" @update:model-value="v.sku = String($event) || null" />
              </UFormField>
            </div>
            <div v-if="v.kind === 'physical'" class="grid grid-cols-2 gap-2 items-end">
              <div class="space-y-1">
                <USwitch :model-value="v.stock !== null" size="xs" label="Track stock" @update:model-value="setTracked(v, $event)" />
                <UInput v-if="v.stock !== null" :model-value="v.stock" type="number" min="0" step="1" size="xs" aria-label="In stock" @update:model-value="setStock(v, $event)" />
              </div>
              <UFormField label="Weight (g)" class="text-xs">
                <UInput :model-value="v.weightGrams ?? undefined" type="number" min="0" step="1" size="xs" @update:model-value="setWeight(v, $event)" />
              </UFormField>
            </div>
            <div v-if="v.kind === 'digital'" class="space-y-1">
              <p class="text-xs text-gray-600 dark:text-gray-300">
                <template v-if="v.fileName">File: <span class="font-medium">{{ v.fileName }}</span> {{ megabytes(v.fileSize) }}</template>
                <template v-else>No file yet. Buyers get a download link once they've paid.</template>
              </p>
              <div v-if="saved" class="flex gap-2">
                <label class="inline-flex">
                  <input type="file" class="sr-only" @change="uploadFile(v, $event)">
                  <UButton as="span" size="xs" variant="outline" color="neutral" icon="i-lucide-upload" :loading="isRunning(`file:${v.id}`)">{{ v.fileName ? 'Replace file' : 'Upload file' }}</UButton>
                </label>
                <UButton v-if="v.fileName" size="xs" variant="ghost" color="neutral" @click="removeFile(v)">Remove file</UButton>
              </div>
              <p v-else class="text-xs text-gray-500">Save the product first, then add its file (up to 100 MB).</p>
            </div>
            <div v-if="product.optionNames.length" class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <img v-if="v.imageUrl" :src="v.imageUrl" alt="" class="h-8 w-8 rounded object-cover">
                <UButton size="xs" variant="outline" color="neutral" @click="pickerFor = v.id">{{ v.imageUrl ? 'Change picture' : 'Picture for this one' }}</UButton>
                <UButton v-if="v.imageUrl" size="xs" variant="ghost" color="neutral" @click="v.imageUrl = null">Remove</UButton>
              </div>
              <USwitch v-model="v.isActive" size="xs" label="On sale" />
            </div>
          </div>
        </div>
      </div>

      <!-- More pictures -->
      <div class="space-y-2">
        <p class="text-xs font-medium text-gray-600 dark:text-gray-300">More pictures</p>
        <div v-if="product.images.length" class="flex flex-wrap gap-2">
          <div v-for="(img, i) in product.images" :key="`${img.url}-${i}`" class="relative">
            <img :src="img.url" :alt="img.alt ?? ''" class="h-14 w-14 rounded object-cover">
            <UButton size="xs" color="neutral" variant="solid" icon="i-lucide-x" class="absolute -top-2 -right-2 rounded-full" :aria-label="`Remove picture ${i + 1}`" @click="removeImage(i)" />
          </div>
        </div>
        <UButton size="xs" variant="outline" color="neutral" icon="i-lucide-image-plus" @click="pickerFor = 'gallery'">Add a picture</UButton>
      </div>
    </div>

    <UModal v-model:open="pickerOpen" title="Choose a picture">
      <template #body>
        <EditorMediaPicker @select="onPicked" />
      </template>
    </UModal>
  </UCard>
</template>
