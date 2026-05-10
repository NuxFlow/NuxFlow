<script setup lang="ts">
const props = defineProps<{
  modelValue: { name: string; email: string; password: string }
}>()
const emit = defineEmits<{
  'update:modelValue': [value: typeof props.modelValue]
  next: []
  back: []
}>()

const local = reactive({ ...props.modelValue })
watch(local, (v) => emit('update:modelValue', { ...v }))

const showPassword = ref(false)
const showConfirm = ref(false)
const confirm = ref('')

const passwordMismatch = computed(() => confirm.value.length > 0 && local.password !== confirm.value)

const valid = computed(() =>
  local.name.length > 0 &&
  /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(local.email) &&
  local.password.length >= 8 &&
  local.password === confirm.value,
)
</script>

<template>
  <div class="space-y-5">
    <div>
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Admin account</h2>
      <p class="text-sm text-gray-500 mt-1">This will be the super admin account.</p>
    </div>

    <UFormField label="Full name" required>
      <UInput v-model="local.name" placeholder="Jane Smith" />
    </UFormField>

    <UFormField label="Email address" required>
      <UInput v-model="local.email" type="email" placeholder="jane@example.com" />
    </UFormField>

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
