import { useEffect, useMemo, useState } from 'react'
import { taskQuery } from '../api/methods'
import type { BackendPool } from '../api/pool'
import type { LatencyType, Node, TaskQueryResult } from '../types'
import {
  aggregateLatencyRows,
  buildLatencyLookup,
  type LatencyAggregate,
  type TimeWindowKey,
} from '../utils/rankings'

const REFRESH_MS = 5 * 60_000
const QUERY_TIMEOUT_MS = 25_000
const LIMIT = 4000

const WINDOWS: { key: TimeWindowKey; ms: number }[] = [
  { key: '1h', ms: 60 * 60 * 1000 },
  { key: '6h', ms: 6 * 60 * 60 * 1000 },
  { key: '12h', ms: 12 * 60 * 60 * 1000 },
  { key: '24h', ms: 24 * 60 * 60 * 1000 },
  { key: '30d', ms: 30 * 24 * 60 * 60 * 1000 },
]

const TYPES: LatencyType[] = ['tcp_ping']

function clean(rows: TaskQueryResult[] | undefined, uuids: Set<string>) {
  return (rows ?? []).filter(row => row.uuid && uuids.has(row.uuid))
}

export function useLatencyOverview(
  pool: BackendPool | null,
  nodes: Node[],
  windows: TimeWindowKey[] = ['1h'],
  types: LatencyType[] = TYPES,
) {
  const [rows, setRows] = useState<LatencyAggregate[]>([])
  const [loading, setLoading] = useState(false)

  const nodeSig = useMemo(
    () =>
      nodes
        .map(n => `${n.source}:${n.uuid}`)
        .sort()
        .join('|'),
    [nodes],
  )

  const windowSig = windows.join('|')
  const typeSig = types.join('|')

  useEffect(() => {
    setRows([])
    if (!pool || !nodes.length || !windows.length || !types.length) return

    const bySource = new Map<string, Set<string>>()
    for (const node of nodes) {
      const set = bySource.get(node.source) || new Set<string>()
      set.add(node.uuid)
      bySource.set(node.source, set)
    }

    let cancelled = false

    const fetchOnce = async () => {
      const now = Date.now()
      setLoading(true)
      const next: LatencyAggregate[] = []

      await Promise.allSettled(
        pool.entries.map(async entry => {
          const uuids = bySource.get(entry.name)
          if (!uuids?.size) return

          await Promise.allSettled(
            WINDOWS.filter(window => windows.includes(window.key)).flatMap(window =>
              types.map(async type => {
                const result = await taskQuery(
                  entry.client,
                  [
                    { timestamp_from_to: [now - window.ms, now] },
                    { type },
                    { limit: LIMIT },
                  ],
                  QUERY_TIMEOUT_MS,
                )
                next.push(...aggregateLatencyRows(clean(result, uuids), type, window.key))
              }),
            ),
          )
        }),
      )

      if (!cancelled) {
        setRows(next)
        setLoading(false)
      }
    }

    fetchOnce()
    const timer = setInterval(fetchOnce, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [pool, nodeSig, windowSig, typeSig])

  const lookup = useMemo(() => buildLatencyLookup(rows), [rows])
  return { rows, lookup, loading }
}
