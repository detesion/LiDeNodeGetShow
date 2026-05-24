import { useEffect, useState } from 'react'

export interface VisitorInfo {
  ip: string
  ips: string[]
  status?: 'loading' | 'ready' | 'error'
  ipv4?: string
  ipv6?: string
  city?: string
  region?: string
  country?: string
  org?: string
  lat?: number
  lng?: number
}

const GEO_URLS = ['https://ipwho.is/', 'https://ipapi.co/json/', 'https://api.ip.sb/geoip']
const IPV4_URL = 'https://api.ipify.org?format=json'
const IPV6_URL = 'https://api64.ipify.org?format=json'
const TIMEOUT_MS = 4_000
const VISITOR_CACHE_KEY = 'nodeget.visitorInfo.v2'
const VISITOR_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

function fetchJson(url: string) {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  return fetch(url, { cache: 'no-cache', signal: ctrl.signal })
    .then(r => (r.ok ? r.json() : null))
    .finally(() => window.clearTimeout(timer))
}

async function fetchIp(url: string) {
  const raw = await fetchJson(url)
  return raw?.ip ? String(raw.ip) : undefined
}

async function fetchGeo() {
  for (const url of GEO_URLS) {
    try {
      const raw = await fetchJson(url)
      if (raw?.success === false) continue
      if (raw?.ip || raw?.latitude || raw?.longitude || raw?.city || raw?.country_name || raw?.country) {
        return raw
      }
    } catch {}
  }
  return null
}

function uniqueIps(...ips: Array<string | undefined>) {
  return [...new Set(ips.filter((ip): ip is string => Boolean(ip)))]
}

function readVisitorCache() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(VISITOR_CACHE_KEY)
    const cached = raw ? JSON.parse(raw) : null
    if (!cached?.visitor || !cached.cachedAt) return null
    if (Date.now() - Number(cached.cachedAt) > VISITOR_CACHE_MAX_AGE_MS) return null
    return cached.visitor as VisitorInfo
  } catch {
    return null
  }
}

function writeVisitorCache(visitor: VisitorInfo) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      VISITOR_CACHE_KEY,
      JSON.stringify({ cachedAt: Date.now(), visitor }),
    )
  } catch {}
}

function visitorFrom(raw: Record<string, unknown> | null, ipv4?: string, ipv6?: string): VisitorInfo | null {
  const ips = uniqueIps(ipv4, ipv6, raw?.ip ? String(raw.ip) : undefined)
  if (!ips.length && !raw) return null

  const lat = Number(raw?.latitude ?? raw?.lat)
  const lng = Number(raw?.longitude ?? raw?.lon)
  const connection = raw?.connection && typeof raw.connection === 'object'
    ? (raw.connection as Record<string, unknown>)
    : null
  const org = raw?.isp
    ?? raw?.organization
    ?? raw?.asn_organization
    ?? raw?.org
    ?? connection?.isp
    ?? connection?.org

  return {
    ip: ips[0] || '',
    ips,
    status: 'ready',
    ipv4,
    ipv6,
    city: raw?.city ? String(raw.city) : undefined,
    region: raw?.region ? String(raw.region) : undefined,
    country: raw?.country_name ? String(raw.country_name) : raw?.country ? String(raw.country) : undefined,
    org: org ? String(org) : undefined,
    lat: Number.isFinite(lat) ? lat : undefined,
    lng: Number.isFinite(lng) ? lng : undefined,
  }
}

export function useVisitorInfo() {
  const [visitor, setVisitor] = useState<VisitorInfo | null>(
    () => readVisitorCache() ?? { ip: '', ips: [], status: 'loading' },
  )

  useEffect(() => {
    let cancelled = false

    Promise.allSettled([
      fetchGeo(),
      fetchIp(IPV4_URL),
      fetchIp(IPV6_URL),
    ])
      .then(([geoResult, ipv4Result, ipv6Result]) => {
        if (cancelled) return
        const raw = geoResult.status === 'fulfilled' ? geoResult.value : null
        const ipv4 = ipv4Result.status === 'fulfilled' ? ipv4Result.value : undefined
        const ipv6 = ipv6Result.status === 'fulfilled' ? ipv6Result.value : undefined
        const next = visitorFrom(raw, ipv4, ipv6)
        if (!next) {
          setVisitor(readVisitorCache() ?? { ip: '', ips: [], status: 'error' })
          return
        }
        setVisitor(next)
        writeVisitorCache(next)
      })
      .catch(() => {
        if (!cancelled) setVisitor(readVisitorCache() ?? { ip: '', ips: [], status: 'error' })
      })

    return () => {
      cancelled = true
    }
  }, [])

  return visitor
}
