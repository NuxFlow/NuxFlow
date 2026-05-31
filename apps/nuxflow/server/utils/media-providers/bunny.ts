import type { MediaProvider, UploadResult } from './index'

export class BunnyProvider implements MediaProvider {
  readonly name = 'bunny'

  private get apiKey() { return process.env.BUNNY_API_KEY! }
  private get storageZone() { return process.env.BUNNY_STORAGE_ZONE! }
  private get pullZone() { return process.env.BUNNY_PULL_ZONE! }

  async upload(file: File, key: string): Promise<UploadResult> {
    const buf = await file.arrayBuffer()

    const res = await fetch(
      `https://storage.bunnycdn.com/${this.storageZone}/${key}`,
      {
        method: 'PUT',
        headers: {
          AccessKey: this.apiKey,
          'Content-Type': 'application/octet-stream',
        },
        body: buf,
      },
    )

    if (!res.ok) throw new Error(`Bunny.net upload failed: ${res.status}`)

    return {
      url: `https://${this.pullZone}.b-cdn.net/${key}`,
      storageKey: key,
      provider: 'bunny',
    }
  }

  async delete(storageKey: string): Promise<void> {
    await fetch(`https://storage.bunnycdn.com/${this.storageZone}/${storageKey}`, {
      method: 'DELETE',
      headers: { AccessKey: this.apiKey },
    })
  }

  getUrl(storageKey: string): string {
    return `https://${this.pullZone}.b-cdn.net/${storageKey}`
  }
}
