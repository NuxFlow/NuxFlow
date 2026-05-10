export async function verifyTurnstile(token: string, ip?: string): Promise<boolean> {
  const secret = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY
  if (!secret) {
    // Turnstile not configured — skip in dev
    return true
  }

  const fd = new FormData()
  fd.append('secret', secret)
  fd.append('response', token)
  if (ip) fd.append('remoteip', ip)

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: fd,
  })

  const json = await res.json() as { success: boolean }
  return json.success
}
