<script setup lang="ts">
const props = defineProps<{ itemId: string }>()

interface Comment {
  id: string
  body: string
  createdAt: string
  parentId: string | null
  guestName: string | null
  authorName: string | null
  authorEmail: string | null
}

const { loggedIn, user } = useUserSession()

// ── Comments ──────────────────────────────────────────────────────────────────
const { data, refresh } = await useFetch<{ comments: Comment[] }>(
  `/api/v1/content/${props.itemId}/comments`,
)
const comments = computed(() => data.value?.comments ?? [])

const roots = computed(() => comments.value.filter(c => !c.parentId))
const repliesFor = (id: string) => comments.value.filter(c => c.parentId === id)

function displayName(c: Comment) {
  return c.authorName ?? c.guestName ?? 'Anonymous'
}

// ── Form state ────────────────────────────────────────────────────────────────
const replyingTo = ref<string | null>(null)

interface FormState {
  name: string
  email: string
  body: string
  submitting: boolean
  result: 'approved' | 'pending' | 'error' | null
  error: string
}

function freshForm(): FormState {
  return { name: '', email: '', body: '', submitting: false, result: null, error: '' }
}

const rootForm = reactive<FormState>(freshForm())
const replyForms = reactive<Record<string, FormState>>({})

function getReplyForm(id: string): FormState {
  if (!replyForms[id]) replyForms[id] = freshForm()
  return replyForms[id]
}

function startReply(id: string) {
  replyingTo.value = id
  nextTick(() => {
    const el = document.getElementById(`reply-input-${id}`)
    el?.focus()
  })
}

function cancelReply(id: string) {
  replyingTo.value = null
  if (replyForms[id]) Object.assign(replyForms[id], freshForm())
}

async function submitComment(form: FormState, parentId: string | null = null) {
  form.error = ''
  form.submitting = true
  try {
    const body: Record<string, unknown> = { body: form.body }
    if (!loggedIn.value) {
      body.guestName = form.name
      body.guestEmail = form.email
    }
    if (parentId) body.parentId = parentId

    const res = await $fetch<{ status: string }>(
      `/api/v1/content/${props.itemId}/comments`,
      { method: 'POST', body },
    )

    form.result = res.status as 'approved' | 'pending'
    form.body = ''
    form.name = ''
    form.email = ''

    if (res.status === 'approved') {
      await refresh()
      if (parentId) replyingTo.value = null
    }
  } catch (e: unknown) {
    form.error = (e as { data?: { message?: string } })?.data?.message ?? 'Failed to post comment'
  } finally {
    form.submitting = false
  }
}
</script>

<template>
  <section class="mt-12 pt-10 border-t border-gray-200 dark:border-gray-800">
    <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-6">
      {{ comments.length ? `${comments.length} comment${comments.length === 1 ? '' : 's'}` : 'Comments' }}
    </h2>

    <!-- Comment list -->
    <div v-if="roots.length" class="space-y-6 mb-10">
      <div v-for="root in roots" :key="root.id">
        <!-- Root comment -->
        <div class="flex gap-3">
          <div class="w-9 h-9 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center shrink-0 text-sm font-medium uppercase text-gray-600 dark:text-gray-300">
            {{ displayName(root).charAt(0) }}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-baseline gap-2 mb-1">
              <span class="text-sm font-medium text-gray-900 dark:text-white">{{ displayName(root) }}</span>
              <span class="text-xs text-gray-400">{{ new Date(root.createdAt).toLocaleDateString() }}</span>
            </div>
            <p class="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line">{{ root.body }}</p>
            <button
              class="mt-2 text-xs text-gray-400 hover:text-primary-500 transition-colors"
              @click="replyingTo === root.id ? cancelReply(root.id) : startReply(root.id)"
            >
              {{ replyingTo === root.id ? 'Cancel' : 'Reply' }}
            </button>

            <!-- Replies -->
            <div v-if="repliesFor(root.id).length" class="mt-4 pl-4 border-l-2 border-gray-100 dark:border-gray-800 space-y-4">
              <div v-for="reply in repliesFor(root.id)" :key="reply.id" class="flex gap-3">
                <div class="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center shrink-0 text-xs font-medium uppercase text-gray-600 dark:text-gray-300">
                  {{ displayName(reply).charAt(0) }}
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-baseline gap-2 mb-1">
                    <span class="text-sm font-medium text-gray-900 dark:text-white">{{ displayName(reply) }}</span>
                    <span class="text-xs text-gray-400">{{ new Date(reply.createdAt).toLocaleDateString() }}</span>
                  </div>
                  <p class="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line">{{ reply.body }}</p>
                </div>
              </div>
            </div>

            <!-- Inline reply form -->
            <div v-if="replyingTo === root.id" class="mt-4 pl-4 border-l-2 border-primary-200 dark:border-primary-800">
              <template v-if="getReplyForm(root.id).result === 'pending'">
                <p class="text-sm text-yellow-600 dark:text-yellow-400 py-2">
                  Your reply has been submitted and is awaiting moderation.
                </p>
              </template>
              <template v-else>
                <div class="space-y-2">
                  <template v-if="!loggedIn">
                    <div class="grid grid-cols-2 gap-2">
                      <UInput :id="`reply-input-${root.id}`" v-model="getReplyForm(root.id).name" size="sm" placeholder="Your name *" />
                      <UInput v-model="getReplyForm(root.id).email" size="sm" type="email" placeholder="Email *" />
                    </div>
                  </template>
                  <UTextarea
                    v-if="loggedIn"
                    :id="`reply-input-${root.id}`"
                    v-model="getReplyForm(root.id).body"
                    :rows="2"
                    size="sm"
                    placeholder="Write a reply…"
                  />
                  <UTextarea
                    v-else
                    v-model="getReplyForm(root.id).body"
                    :rows="2"
                    size="sm"
                    placeholder="Write a reply…"
                  />
                  <p v-if="getReplyForm(root.id).error" class="text-xs text-red-500">{{ getReplyForm(root.id).error }}</p>
                  <div class="flex gap-2">
                    <UButton
                      size="xs"
                      :loading="getReplyForm(root.id).submitting"
                      :disabled="!getReplyForm(root.id).body.trim()"
                      @click="submitComment(getReplyForm(root.id), root.id)"
                    >
                      Post reply
                    </UButton>
                    <UButton size="xs" variant="ghost" @click="cancelReply(root.id)">Cancel</UButton>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="text-sm text-gray-400 mb-10">
      No comments yet. Be the first to leave one.
    </div>

    <!-- New comment form -->
    <div class="bg-gray-50 dark:bg-gray-900 rounded-xl p-5 space-y-4">
      <h3 class="text-sm font-semibold text-gray-900 dark:text-white">
        {{ loggedIn ? `Leave a comment as ${(user as { name?: string })?.name ?? 'yourself'}` : 'Leave a comment' }}
      </h3>

      <template v-if="rootForm.result === 'approved'">
        <p class="text-sm text-green-600 dark:text-green-400">Your comment has been posted.</p>
        <UButton size="sm" variant="ghost" @click="Object.assign(rootForm, freshForm())">Post another</UButton>
      </template>
      <template v-else-if="rootForm.result === 'pending'">
        <p class="text-sm text-yellow-600 dark:text-yellow-400">Thanks! Your comment is awaiting moderation.</p>
        <UButton size="sm" variant="ghost" @click="Object.assign(rootForm, freshForm())">Post another</UButton>
      </template>
      <template v-else>
        <template v-if="!loggedIn">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <UFormField label="Name" required>
              <UInput v-model="rootForm.name" placeholder="Jane Smith" />
            </UFormField>
            <UFormField label="Email" required>
              <UInput v-model="rootForm.email" type="email" placeholder="jane@example.com" />
            </UFormField>
          </div>
        </template>
        <UFormField label="Comment" required>
          <UTextarea v-model="rootForm.body" :rows="4" placeholder="Share your thoughts…" />
        </UFormField>
        <p v-if="rootForm.error" class="text-sm text-red-500">{{ rootForm.error }}</p>
        <div class="flex items-center justify-between">
          <p v-if="!loggedIn" class="text-xs text-gray-400">Guest comments are held for moderation.</p>
          <span v-else />
          <UButton
            :loading="rootForm.submitting"
            :disabled="!rootForm.body.trim() || (!loggedIn && (!rootForm.name.trim() || !rootForm.email.trim()))"
            @click="submitComment(rootForm)"
          >
            Post comment
          </UButton>
        </div>
      </template>
    </div>
  </section>
</template>
