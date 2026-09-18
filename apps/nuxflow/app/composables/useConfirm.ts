import ConfirmDialog from '~/components/ConfirmDialog.vue'

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  color?: 'error' | 'primary' | 'warning'
}

/**
 * Shared confirm-dialog composable — replaces native `confirm()` (unstyled, not
 * dark-mode-aware, blocks the main thread) with a Nuxt UI `UModal` opened programmatically
 * via `useOverlay()`. Resolves `true` only when the user explicitly clicks confirm;
 * dismissing via Escape/backdrop/cancel all resolve `false`, same as native `confirm()`.
 */
export function useConfirm() {
  const overlay = useOverlay()

  async function confirm(options: ConfirmOptions): Promise<boolean> {
    const instance = overlay.create(ConfirmDialog)
    const result = await instance.open(options)
    return result === true
  }

  return { confirm }
}
