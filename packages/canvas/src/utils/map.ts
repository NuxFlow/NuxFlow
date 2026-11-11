// Map block URLs (CanvasBlockMap.vue). Keyless embeds only: Google's `output=embed` search
// URL and OpenStreetMap's export embed, so a site needs no API key or billing account.
// Import-free so it can be unit-tested.

export type MapProvider = 'google' | 'osm'

export interface MapSettings {
  provider?: string
  address?: string
  latitude?: number | string
  longitude?: number | string
  zoom?: number | string
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : fallback
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** Coordinates when both are set and in range (0,0 counts as unset — it's the default). */
export function mapCoordinates(s: MapSettings): { lat: number; lng: number } | null {
  const lat = num(s.latitude, Number.NaN)
  const lng = num(s.longitude, Number.NaN)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat === 0 && lng === 0) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}

function mapZoom(s: MapSettings): number {
  return Math.round(clamp(num(s.zoom, 14), 1, 19))
}

/** The iframe URL, or null when there's nothing to show yet. */
export function mapEmbedUrl(s: MapSettings): string | null {
  const zoom = mapZoom(s)
  if (s.provider === 'osm') {
    const c = mapCoordinates(s)
    if (!c) return null
    // Half the visible span at this zoom; a tile is 360° wide at zoom 0.
    const dLng = 360 / 2 ** zoom
    const dLat = dLng / 2
    const bbox = [c.lng - dLng, c.lat - dLat, c.lng + dLng, c.lat + dLat].map(n => n.toFixed(5)).join(',')
    return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${c.lat.toFixed(5)}%2C${c.lng.toFixed(5)}`
  }
  const c = mapCoordinates(s)
  const q = c ? `${c.lat},${c.lng}` : (s.address ?? '').trim()
  if (!q) return null
  return `https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=${zoom}&output=embed`
}

/** A plain link to open the place in a full map, shown under the embed (and without JS). */
export function mapLinkUrl(s: MapSettings): string | null {
  const c = mapCoordinates(s)
  if (s.provider === 'osm') {
    if (!c) return null
    return `https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lng}#map=${mapZoom(s)}/${c.lat}/${c.lng}`
  }
  const q = c ? `${c.lat},${c.lng}` : (s.address ?? '').trim()
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null
}

export function mapProviderName(provider?: string): string {
  return provider === 'osm' ? 'OpenStreetMap' : 'Google Maps'
}
