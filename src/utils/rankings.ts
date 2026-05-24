import type { LatencyType, Node, TaskQueryResult, Usage } from '../types'

export type TimeWindowKey = '1h' | '6h' | '12h' | '24h' | '30d'

export interface LatencyAggregate {
  uuid: string
  type: LatencyType
  window: TimeWindowKey
  samples: number
  success: number
  avg: number | null
  min: number | null
  max: number | null
  jitter: number | null
  lossRate: number
}

export type LatencyLookup = Map<string, Partial<Record<LatencyType, Partial<Record<TimeWindowKey, LatencyAggregate>>>>>

export interface RankedNode {
  node: Node
  usage: Usage
  value: number
  sub?: string
}

function normalizeTs(ts: number) {
  return ts < 1_000_000_000_000 ? ts * 1000 : ts
}

export function extractLatencyValue(row: TaskQueryResult, type: LatencyType): number | null {
  const v = row.task_event_result?.[type]
  return row.success && typeof v === 'number' ? v : null
}

export function aggregateLatencyRows(
  rows: TaskQueryResult[],
  type: LatencyType,
  window: TimeWindowKey,
): LatencyAggregate[] {
  const byNode = new Map<string, TaskQueryResult[]>()
  for (const row of rows) {
    if (!row.uuid) continue
    const list = byNode.get(row.uuid) || []
    list.push(row)
    byNode.set(row.uuid, list)
  }

  return [...byNode.entries()].map(([uuid, list]) => {
    const sorted = list.slice().sort((a, b) => normalizeTs(a.timestamp) - normalizeTs(b.timestamp))
    const vals: number[] = []
    for (const row of sorted) {
      const v = extractLatencyValue(row, type)
      if (v != null) vals.push(v)
    }

    const samples = sorted.length
    const success = vals.length
    const lossRate = samples ? ((samples - success) / samples) * 100 : 0
    if (!vals.length) {
      return { uuid, type, window, samples, success, avg: null, min: null, max: null, jitter: null, lossRate }
    }

    const avg = vals.reduce((acc, v) => acc + v, 0) / vals.length
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const jitter =
      vals.length >= 2
        ? vals.slice(1).reduce((acc, v, i) => acc + Math.abs(v - vals[i]), 0) / (vals.length - 1)
        : null

    return { uuid, type, window, samples, success, avg, min, max, jitter, lossRate }
  })
}

export function buildLatencyLookup(rows: LatencyAggregate[]) {
  const out: LatencyLookup = new Map()
  for (const row of rows) {
    const cur = out.get(row.uuid) || {}
    const byType = cur[row.type] || {}
    byType[row.window] = row
    cur[row.type] = byType
    out.set(row.uuid, cur)
  }
  return out
}

export function getLatency(
  lookup: LatencyLookup,
  uuid: string,
  type: LatencyType,
  window: TimeWindowKey,
) {
  return lookup.get(uuid)?.[type]?.[window] || null
}
