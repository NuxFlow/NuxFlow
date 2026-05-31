import type { MediaProvider, UploadResult } from './index'

export class CloudflareImagesProvider implements MediaProvider {
  readonly name = 'cloudflare'

  private get config() { return useRuntimeConfig() }

  async upload(file: File, key: string): Promise<UploadResult> {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('id', key)

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.config.cloudflareAccountId}/images/v1`,
      { method: 'POST', headers: { Authorization: `Bearer ${this.config.cloudflareImagesToken}` }, body: fd },
    )

    if (!res.ok) {
      throw new Error(`Cloudflare Images upload failed: ${res.status}`)
    }

    const json = await res.json() as { result: { variants: string[] } }
    return {
      url: json.result.variants[0] ?? '',
      storageKey: key,
      provider: 'cloudflare',
    }
  }

  async delete(storageKey: string): Promise<void> {
    await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.config.cloudflareAccountId}/images/v1/${storageKey}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${this.config.cloudflareImagesToken}` } },
    )
  }

  getUrl(storageKey: string): string {
    return `${this.config.cloudflareImagesDeliveryUrl}/${storageKey}/public`
  }
}
