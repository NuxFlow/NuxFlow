import { defineStore } from 'pinia'

interface ContentItem {
  id: string
  title: string
  slug: string
  status: string
  typeSlug: string
  publishedAt?: string
  updatedAt: string
}

export const useContentStore = defineStore('content', () => {
  const items = ref<ContentItem[]>([])
  const loading = ref(false)
  const total = ref(0)

  async function fetchList(params?: Record<string, string>) {
    loading.value = true
    try {
      const data = await $fetch<{ items: ContentItem[]; total: number }>('/api/v1/content', {
        query: params,
      })
      items.value = data.items
      total.value = data.total
    } finally {
      loading.value = false
    }
  }

  async function createItem(body: {
    title: string
    slug: string
    typeSlug: string
    content?: unknown
  }) {
    const result = await $fetch<{ id: string }>('/api/v1/content', {
      method: 'POST',
      body,
    })
    await fetchList()
    return result
  }

  async function updateItem(id: string, body: Partial<ContentItem & { content: unknown }>) {
    await $fetch(`/api/v1/content/${id}`, { method: 'PATCH', body: body as Record<string, unknown> })
    const idx = items.value.findIndex((i) => i.id === id)
    if (idx !== -1) Object.assign(items.value[idx]!, body)
  }

  async function deleteItem(id: string) {
    await $fetch(`/api/v1/content/${id}`, { method: 'DELETE' })
    items.value = items.value.filter((i) => i.id !== id)
    total.value = Math.max(0, total.value - 1)
  }

  return { items, loading, total, fetchList, createItem, updateItem, deleteItem }
})
