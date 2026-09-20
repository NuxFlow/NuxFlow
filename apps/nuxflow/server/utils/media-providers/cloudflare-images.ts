import type { MediaProvider, UploadResult } from './index'

export class CloudflareImagesProvider implements MediaProvider {
  readonly name = 'cloudflare'

  constructor(
    private readonly accountId: string,
    private readonly imagesToken: string,
    private readonly deliveryUrl: string,
  ) {}

  async upload(file: File, key: string): Promise<UploadResult> {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('id', key)

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/images/v1`,
      { method: 'POST', headers: { Authorization: `Bearer ${this.imagesToken}` }, body: fd },
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
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/images/v1/${storageKey}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${this.imagesToken}` } },
    )
    // Without this check (mirroring upload()'s own res.ok check above), a failed
    // provider-side delete (bad/revoked token, 5xx) is silently swallowed, the caller
    // deletes the D1 row anyway, and the image orphans in Cloudflare Images with no
    // error surfaced anywhere.
    if (!res.ok) throw new Error(`Cloudflare Images delete failed: ${res.status}`)
  }

  getUrl(storageKey: string): string {
    return `${this.deliveryUrl}/${storageKey}/public`
  }
}
