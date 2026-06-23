import { useEffect, useMemo, useState } from 'react'
import { dynamicSummaryQuery } from '../api/methods'
import type { BackendPool } from '../api/pool'
import type { DynamicSummary, Node } from '../types'
import type { TimeWindowKey } from '../utils/rankings'

export interface TrafficHistoryPoint {
  t: number
  netIn: number
  netOut: number
  totalReceived?: number
  totalTransmitted?: number
}

const QUERY_TIMEOUT_MS = 25_000

const WINDOW_MS: Record<TimeWindowKey, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
}

const BUCKETS: Record<TimeWindowKey, number> = {
  '1h': 36,
  '6h': 48,
  '12h': 48,
  '24h': 48,
  '30d': 60,
}

const TOLERANCE_MS: Record<TimeWindowKey, number> = {
  '1h': 30 * 1000,
  '6h': 3 * 60 * 1000,
  '12h': 5 * 60 * 1000,
  '24h': 15 * 60 * 1000,
  '30d': 6 * 60 * 60 * 1000,
}

const REFRESH_MS: Record<TimeWindowKey, number> = {
  '1h': 120_000,
  '6h': 300_000,
  '12h': 300_000,
  '24h': 600_000,
  '30d': 900_000,
}

function normalizeTs(ts: number) {
  return ts < 1_000_000_000_000 ? ts * 1000 : ts
}

function toPoint(row: DynamicSummary): TrafficHistoryPoint | null {
  if (row.total_received == null && row.total_transmitted == null) return null
  return {
    t: normalizeTs(row.timestamp),
    netIn: row.receive_speed ?? 0,
    netOut: row.transmit_speed ?? 0,
    totalReceived: row.total_received,
    totalTransmitted: row.total_transmitted,
  }
}

function clean(rows: Array<DynamicSummary | null>) {
  return rows
    .map(toPoint)
    .filter((row): row is TrafficHistoryPoint => row != null)
    .sort((a, b) => a.t - b.t)
}

function sampleTimes(window: TimeWindowKey, now: number) {
  const from = now - WINDOW_MS[window]
  const buckets = BUCKETS[window]
  const times: number[] = []
  for (let index = 0; index <= buckets; index += 1) {
    times.push(from + ((now - from) * index) / buckets)
  }
  return times
}

function nearestRow(rows: DynamicSummary[] | undefined, target: number) {
  if (!rows?.length) return null
  let best = rows[0]
  for (const row of rows) {
    if (Math.abs(normalizeTs(row.timestamp) - target) < Math.abs(normalizeTs(best.timestamp) - target)) {
      best = row
    }
  }
  return best
}

async function fetchBoundarySample(
  entry: BackendPool['entries'][number],
  uuid: string,
  target: number,
  window: TimeWindowKey,
) {
  try {
    return nearestRow(
      await dynamicSummaryQuery(
        entry.client,
        {
          fields: ['total_received', 'total_transmitted'],
          condition: [
            { uuid },
            { timestamp_from_to: [target - TOLERANCE_MS[window], target + TOLERANCE_MS[window]] },
            { limit: 5 },
          ],
        },
        QUERY_TIMEOUT_MS,
      ),
      target,
    )
  } catch {
    return null
  }
}

export function useNodeTrafficHistory(
  pool: BackendPool | null,
  node: Node | null,
  window: TimeWindowKey,
) {
  const [data, setData] = useState<TrafficHistoryPoint[]>([])
  const [loading, setLoading] = useState(false)
  const nodeSig = useMemo(
    () => (node ? `${node.source}:${node.uuid}` : ''),
    [node],
  )

  useEffect(() => {
    setData([])
    if (!pool || !node) return
    const entry = pool.entries.find(e => e.name === node.source)
    if (!entry) return

    let cancelled = false

    const fetchOnce = async () => {
      const now = Date.now()
      setLoading(true)

      try {
        const rows = await Promise.all(
          sampleTimes(window, now).map(target =>
            fetchBoundarySample(entry, node.uuid, target, window),
          ),
        )

        if (!cancelled) setData(clean(rows))
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
  }, [pool, nodeSig, window])

  return { data, loading }
}
