import type { MediaProvider, UploadResult } from './index'
import { encodeStorageKey, assertProviderOk } from './index'

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

    await assertProviderOk(res, 'Cloudflare Images upload')

    const json = await res.json() as { result: { variants: string[] } }
    return {
      url: json.result.variants[0] ?? '',
      storageKey: key,
      provider: 'cloudflare',
    }
  }

  async delete(storageKey: string): Promise<void> {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/images/v1/${encodeStorageKey(storageKey)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${this.imagesToken}` } },
    )
    // allow404: an image already removed out-of-band (a prior partial failure, manual
    // deletion in the Cloudflare dashboard) must not permanently block deleting its D1
    // row — see the shared assertProviderOk doc comment in index.ts. Anything else
    // (bad/revoked token, 5xx) still means the object was NOT removed and must throw, or
    // the caller would delete the D1 row anyway and orphan the image in storage.
    await assertProviderOk(res, 'Cloudflare Images delete', { allow404: true })
  }

  getUrl(storageKey: string): string {
    return `${this.deliveryUrl}/${encodeStorageKey(storageKey)}/public`
  }
}
