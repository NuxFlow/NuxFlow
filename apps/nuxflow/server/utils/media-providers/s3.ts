import type { MediaProvider, UploadResult } from './index'

function toHex(buf: ArrayBuffer) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function hmacSha256(key: BufferSource | CryptoKey, data: string): Promise<ArrayBuffer> {
  const cryptoKey = key instanceof CryptoKey
    ? key
    : await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
}

async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data
  return toHex(await crypto.subtle.digest('SHA-256', buf))
}

async function signingKey(secretKey: string, date: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(new TextEncoder().encode(`AWS4${secretKey}`), date)
  const kRegion = await hmacSha256(kDate, region)
  const kService = await hmacSha256(kRegion, service)
  return hmacSha256(kService, 'aws4_request')
}

async function signRequest(opts: {
  method: string
  url: string
  headers: Record<string, string>
  body: ArrayBuffer | string
  accessKey: string
  secretKey: string
  region: string
  service: string
}): Promise<Record<string, string>> {
  const url = new URL(opts.url)
  const now = new Date()
  const dateTime = now.toISOString().replace(/[-:]|\.\d{3}/g, '').slice(0, 15) + 'Z'
  const date = dateTime.slice(0, 8)

  const bodyHash = await sha256Hex(opts.body)

  const signedHeaders = { ...opts.headers, 'x-amz-date': dateTime, 'x-amz-content-sha256': bodyHash }
  const sortedHeaderKeys = Object.keys(signedHeaders).map(k => k.toLowerCase()).sort()
  const canonicalHeaders = sortedHeaderKeys.map(k => `${k}:${signedHeaders[k as keyof typeof signedHeaders]}`).join('\n') + '\n'
  const signedHeadersStr = sortedHeaderKeys.join(';')

  const canonicalRequest = [
    opts.method,
    url.pathname,
    url.search.slice(1),
    canonicalHeaders,
    signedHeadersStr,
    bodyHash,
  ].join('\n')

  const credentialScope = `${date}/${opts.region}/${opts.service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', dateTime, credentialScope, await sha256Hex(canonicalRequest)].join('\n')

  const key = await signingKey(opts.secretKey, date, opts.region, opts.service)
  const signature = toHex(await hmacSha256(key, stringToSign))

  return {
    ...signedHeaders,
    Authorization: `AWS4-HMAC-SHA256 Credential=${opts.accessKey}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`,
  }
}

export class S3Provider implements MediaProvider {
  readonly name = 's3'

  private get bucket() { return process.env.S3_BUCKET! }
  private get region() { return process.env.S3_REGION ?? 'us-east-1' }
  private get endpoint() { return process.env.S3_ENDPOINT ?? `https://s3.${this.region}.amazonaws.com` }
  private get accessKey() { return process.env.S3_ACCESS_KEY! }
  private get secretKey() { return process.env.S3_SECRET_KEY! }
  private get publicUrl() { return process.env.S3_PUBLIC_URL ?? `${this.endpoint}/${this.bucket}` }

  async upload(file: File, key: string): Promise<UploadResult> {
    const buf = await file.arrayBuffer()
    const url = `${this.endpoint}/${this.bucket}/${key}`

    const headers = await signRequest({
      method: 'PUT',
      url,
      headers: {
        'Content-Type': file.type,
        'Content-Length': String(file.size),
        'x-amz-acl': 'public-read',
        host: new URL(url).host,
      },
      body: buf,
      accessKey: this.accessKey,
      secretKey: this.secretKey,
      region: this.region,
      service: 's3',
    })

    const res = await fetch(url, { method: 'PUT', headers, body: buf })
    if (!res.ok) throw new Error(`S3 upload failed: ${res.status} ${await res.text()}`)

    return { url: `${this.publicUrl}/${key}`, storageKey: key, provider: 's3' }
  }

  async delete(storageKey: string): Promise<void> {
    const url = `${this.endpoint}/${this.bucket}/${storageKey}`
    const headers = await signRequest({
      method: 'DELETE',
      url,
      headers: { host: new URL(url).host },
      body: '',
      accessKey: this.accessKey,
      secretKey: this.secretKey,
      region: this.region,
      service: 's3',
    })
    await fetch(url, { method: 'DELETE', headers })
  }

  getUrl(storageKey: string): string {
    return `${this.publicUrl}/${storageKey}`
  }
}
