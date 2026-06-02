<script setup lang="ts">
const props = defineProps<{
  modelValue: { name: string; email: string; password: string }
  hasGlobalAdmin?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: typeof props.modelValue]
  next: []
  back: []
}>()

const local = reactive({ ...props.modelValue })
watch(local, (v) => emit('update:modelValue', { ...v }))

// Reactive state for reusing existing administrator credentials
const useExisting = ref(false)

// Watch the prop to update the state dynamically once data loads from async fetch
watch(() => props.hasGlobalAdmin, (newVal) => {
  if (newVal !== undefined) {
    useExisting.value = newVal
  }
}, { immediate: true })

const showPassword = ref(false)
const showConfirm = ref(false)
const confirm = ref('')

const passwordMismatch = computed(() => !useExisting.value && confirm.value.length > 0 && local.password !== confirm.value)

// Standard, highly resilient email validation regex
const emailRegex = /^[\w.%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i

const valid = computed(() => {
  const email = (local.email || '').trim()
  if (useExisting.value) {
    return emailRegex.test(email)
  }
  return (
    local.name.trim().length > 0 &&
    emailRegex.test(email) &&
    local.password.length >= 8 &&
    local.password === confirm.value
  )
})
</script>

<template>
  <div class="space-y-5">
    <div>
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Admin account</h2>
      <p class="text-sm text-gray-500 mt-1">This will be the administrator account for your new site.</p>
    </div>

    <!-- Toggle between existing global user and new user if a global admin exists -->
    <div v-if="hasGlobalAdmin" class="flex p-1 rounded-lg bg-gray-100 dark:bg-gray-800/50">
      <button
        type="button"
        class="flex-1 py-1.5 text-xs font-medium rounded-md transition-colors text-center"
        :class="useExisting ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'"
        @click="useExisting = true"
      >
        Use Existing Admin
      </button>
      <button
        type="button"
        class="flex-1 py-1.5 text-xs font-medium rounded-md transition-colors text-center"
        :class="!useExisting ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'"
        @click="useExisting = false"
      >
        Create New Admin
      </button>
    </div>

    <template v-if="!useExisting">
      <UFormField label="Full name" required>
        <UInput v-model="local.name" placeholder="Jane Smith" />
      </UFormField>
    </template>

    <UFormField label="Email address" required :hint="useExisting ? 'Enter your existing global administrator email' : undefined">
      <UInput v-model="local.email" type="email" placeholder="jane@example.com" />
    </UFormField>

    <template v-if="!useExisting">
      <UFormField label="Password" required hint="At least 8 characters">
        <UInput
          v-model="local.password"
          :type="showPassword ? 'text' : 'password'"
          placeholder="••••••••"
        >
          <template #trailing>
            <button type="button" tabindex="-1" class="flex items-center" @click.prevent="showPassword = !showPassword">
              <UIcon
                :name="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                class="size-4 text-gray-400 hover:text-gray-600 cursor-pointer"
              />
            </button>
          </template>
        </UInput>
      </UFormField>

      <UFormField
        label="Confirm password"
        required
        :error="passwordMismatch ? 'Passwords do not match' : undefined"
      >
        <UInput
          v-model="confirm"
          :type="showConfirm ? 'text' : 'password'"
          placeholder="••••••••"
          @keyup.enter="valid && emit('next')"
        >
          <template #trailing>
            <button type="button" tabindex="-1" class="flex items-center" @click.prevent="showConfirm = !showConfirm">
              <UIcon
                :name="showConfirm ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                class="size-4 text-gray-400 hover:text-gray-600 cursor-pointer"
              />
            </button>
          </template>
        </UInput>
      </UFormField>
    </template>

    <div class="flex items-center justify-between pt-2">
      <UButton variant="ghost" @click="emit('back')">
        <UIcon name="i-lucide-arrow-left" class="mr-1 w-4 h-4" />
        Back
      </UButton>
      <UButton :disabled="!valid" @click="emit('next')">
        Continue
        <UIcon name="i-lucide-arrow-right" class="ml-1 w-4 h-4" />
      </UButton>
    </div>
  </div>
</template>
