import { useEffect, useState } from 'react'
import { taskQuery } from '../api/methods'
import type { BackendPool } from '../api/pool'
import type { LatencyType, TaskQueryResult } from '../types'
import type { TimeWindowKey } from '../utils/rankings'

const QUERY_TIMEOUT_MS = 35_000

const WINDOW_MS: Record<TimeWindowKey, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
}

const LIMIT: Record<TimeWindowKey, number> = {
  '1h': 3000,
  '6h': 6000,
  '12h': 9000,
  '24h': 12000,
  '30d': 20000,
}

const CHUNK_LIMIT: Record<TimeWindowKey, number> = {
  '1h': LIMIT['1h'],
  '6h': LIMIT['6h'],
  '12h': LIMIT['12h'],
  '24h': 4000,
  '30d': LIMIT['30d'],
}

const REFRESH_MS: Record<TimeWindowKey, number> = {
  '1h': 60_000,
  '6h': 180_000,
  '12h': 300_000,
  '24h': 600_000,
  '30d': 900_000,
}

function clean(rows: TaskQueryResult[] | undefined): TaskQueryResult[] {
  return (rows ?? [])
    .filter(r => r.cron_source && r.cron_source !== '未知')
    .sort((a, b) => normalizeTs(a.timestamp) - normalizeTs(b.timestamp))
}

function downsampleRows(rows: TaskQueryResult[], window: TimeWindowKey) {
  if (window !== '30d') return rows

  const size = 5 * 60 * 1000
  const picked = new Map<string, TaskQueryResult>()

  for (const row of rows) {
    const ts = normalizeTs(row.timestamp)
    const source = row.cron_source || '未知'
    const bucket = Math.floor(ts / size) * size
    const key = `${source}:${bucket}`
    const prev = picked.get(key)
    if (!prev || normalizeTs(prev.timestamp) < ts) picked.set(key, row)
  }

  return [...picked.values()].sort((a, b) => normalizeTs(a.timestamp) - normalizeTs(b.timestamp))
}

function normalizeTs(ts: number) {
  return ts < 1_000_000_000_000 ? ts * 1000 : ts
}

function queryRanges(window: TimeWindowKey, now: number): [number, number][] {
  const from = now - WINDOW_MS[window]
  if (window === '24h') {
    const chunk = 6 * 60 * 60 * 1000
    return makeRanges(from, now, chunk)
  }
  if (window === '30d') {
    const chunk = 24 * 60 * 60 * 1000
    return makeRanges(from, now, chunk)
  }
  return [[from, now]]
}

function makeRanges(from: number, to: number, chunkMs: number): [number, number][] {
  const ranges: [number, number][] = []
  for (let start = from; start < to; start += chunkMs) {
    ranges.push([start, Math.min(to, start + chunkMs)])
  }
  return ranges
}

async function queryLatencyWindow(
  entry: BackendPool['entries'][number],
  uuid: string,
  type: LatencyType,
  window: TimeWindowKey,
  now: number,
) {
  const ranges = queryRanges(window, now)
  const chunks = await mapLimited(ranges, window === '30d' ? 2 : 4, range =>
    taskQuery(
      entry.client,
      [{ uuid }, { timestamp_from_to: range }, { type }, { limit: CHUNK_LIMIT[window] }],
      QUERY_TIMEOUT_MS,
    ).catch(() => []),
  )
  return chunks.flat()
}

async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = []
  for (let index = 0; index < items.length; index += limit) {
    out.push(...await Promise.all(items.slice(index, index + limit).map(fn)))
  }
  return out
}

export function useNodeLatency(
  pool: BackendPool | null,
  source: string | null,
  uuid: string | null,
  type: LatencyType,
  window: TimeWindowKey = '1h',
) {
  const [data, setData] = useState<TaskQueryResult[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setData([])

    if (!pool || !source || !uuid) return
    const entry = pool.entries.find(e => e.name === source)
    if (!entry) return

    let cancelled = false

    const fetchOnce = async () => {
      const now = Date.now()
      setLoading(true)

      try {
        const result = await queryLatencyWindow(entry, uuid, type, window, now)

        if (!cancelled) setData(downsampleRows(clean(result), window))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchOnce()
    const timer = setInterval(fetchOnce, REFRESH_MS[window])
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [pool, source, uuid, type, window])

  return { data, loading }
}
