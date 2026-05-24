import { useEffect, useMemo, useState } from 'react'
import { dynamicSummaryQuery } from '../api/methods'
import type { BackendPool } from '../api/pool'
import type { DynamicSummary, Node } from '../types'

export type TrafficWindow = 'today' | 'month'

export interface TrafficRow {
  uuid: string
  value: number
  received: number
  transmitted: number
}

interface TrafficTotal {
  received: number
  transmitted: number
}

type BaselineValue = DynamicSummary | null

const QUERY_TIMEOUT_MS = 25_000
const BOUNDARY_LIMIT = 1000
const MIN_SEARCH_MS = 60_000
const BASELINE_CACHE_TTL_MS = 30 * 60_000
const baselineCache = new Map<string, { value: BaselineValue; expiresAt: number; promise?: Promise<BaselineValue> }>()
const carryCache = new Map<string, { bootTime: number; carryReceived: number; carryTransmitted: number; value: TrafficTotal }>()

function startOfDay() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function startOfMonth() {
  const d = new Date()
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

async function queryTrafficRange(
  client: BackendPool['entries'][number]['client'],
  uuid: string,
  from: number,
  to: number,
  limit = BOUNDARY_LIMIT,
) {
  const rows = await dynamicSummaryQuery(
    client,
    {
      fields: ['total_received', 'total_transmitted', 'boot_time'],
      condition: [
        { uuid },
        { timestamp_from_to: [from, to] },
        { limit },
      ],
    },
    QUERY_TIMEOUT_MS,
  )
  return (rows || []).filter(r => r.total_received != null || r.total_transmitted != null)
}

function normalizeTs(ts: number) {
  return ts < 1_000_000_000_000 ? ts * 1000 : ts
}

function dynamicTrafficSample(node: Node, now: number): DynamicSummary | null {
  if (node.dynamic?.total_received == null && node.dynamic?.total_transmitted == null) return null
  return {
    uuid: node.uuid,
    timestamp: node.dynamic?.timestamp ?? now,
    total_received: node.dynamic?.total_received,
    total_transmitted: node.dynamic?.total_transmitted,
    boot_time: node.dynamic?.boot_time,
  }
}

function earliestSample(rows: DynamicSummary[], from: number) {
  return rows
    .filter(row => normalizeTs(row.timestamp) >= from)
    .sort((a, b) => normalizeTs(a.timestamp) - normalizeTs(b.timestamp))[0] ?? null
}

async function rangeHasTraffic(
  client: BackendPool['entries'][number]['client'],
  uuid: string,
  from: number,
  to: number,
) {
  if (to <= from) return false
  const rows = await queryTrafficRange(client, uuid, from, to, 1)
  return rows.length > 0
}

async function findBoundarySample(
  client: BackendPool['entries'][number]['client'],
  uuid: string,
  periodFrom: number,
  now: number,
) {
  if (!(await rangeHasTraffic(client, uuid, periodFrom, now))) return null

  let low = periodFrom
  let high = now
  while (high - low > MIN_SEARCH_MS) {
    const mid = low + Math.floor((high - low) / 2)
    if (await rangeHasTraffic(client, uuid, periodFrom, mid)) high = mid
    else low = mid
  }

  const rows = await queryTrafficRange(
    client,
    uuid,
    Math.max(periodFrom, low - MIN_SEARCH_MS),
    Math.min(now, high + MIN_SEARCH_MS),
    BOUNDARY_LIMIT,
  )
  return earliestSample(rows, periodFrom)
}

function baselineCacheKey(source: string, uuid: string, window: TrafficWindow, periodFrom: number, bootTime?: number) {
  return `${source}:${uuid}:${window}:${periodFrom}:${bootTime ?? 0}`
}

function carryCacheKey(source: string, uuid: string, window: TrafficWindow, periodFrom: number) {
  return `${source}:${uuid}:${window}:${periodFrom}`
}

async function cachedBoundarySample(
  client: BackendPool['entries'][number]['client'],
  node: Node,
  window: TrafficWindow,
  periodFrom: number,
  now: number,
) {
  const key = baselineCacheKey(node.source, node.uuid, window, periodFrom, node.dynamic?.boot_time)
  const hit = baselineCache.get(key)
  if (hit && hit.expiresAt > now) return hit.promise ?? hit.value

  const promise = findBoundarySample(client, node.uuid, periodFrom, now).catch(error => {
    baselineCache.delete(key)
    throw error
  })
  baselineCache.set(key, { value: null, expiresAt: now + BASELINE_CACHE_TTL_MS, promise })
  const value = await promise
  baselineCache.set(key, { value, expiresAt: Date.now() + BASELINE_CACHE_TTL_MS })
  return value
}

function diffTraffic(current: DynamicSummary, baseline: DynamicSummary | null, periodFrom: number): TrafficTotal {
  const currentReceived = current.total_received ?? 0
  const currentTransmitted = current.total_transmitted ?? 0
  const currentBoot = (current.boot_time ?? 0) * 1000

  if (!baseline || currentBoot >= periodFrom) {
    return { received: currentReceived, transmitted: currentTransmitted }
  }

  const baseReceived = baseline.total_received ?? 0
  const baseTransmitted = baseline.total_transmitted ?? 0
  return {
    received: currentReceived >= baseReceived ? currentReceived - baseReceived : currentReceived,
    transmitted:
      currentTransmitted >= baseTransmitted ? currentTransmitted - baseTransmitted : currentTransmitted,
  }
}

async function trafficBeforeReboot(
  client: BackendPool['entries'][number]['client'],
  uuid: string,
  baseline: DynamicSummary | null,
  bootMs: number,
) {
  if (!baseline || bootMs <= normalizeTs(baseline.timestamp)) return null
  const rows = await queryTrafficRange(client, uuid, normalizeTs(baseline.timestamp), bootMs - 1, 1)
  const last = rows
    .filter(row => normalizeTs(row.timestamp) < bootMs)
    .sort((a, b) => normalizeTs(b.timestamp) - normalizeTs(a.timestamp))[0]
  if (!last) return null

  const baseReceived = baseline.total_received ?? 0
  const baseTransmitted = baseline.total_transmitted ?? 0
  const lastReceived = last.total_received ?? 0
  const lastTransmitted = last.total_transmitted ?? 0
  return {
    received: lastReceived >= baseReceived ? lastReceived - baseReceived : lastReceived,
    transmitted: lastTransmitted >= baseTransmitted ? lastTransmitted - baseTransmitted : lastTransmitted,
  }
}

function withRebootCarry(
  node: Node,
  window: TrafficWindow,
  periodFrom: number,
  total: TrafficTotal,
) {
  const bootTime = node.dynamic?.boot_time ?? 0
  const currentBoot = bootTime * 1000
  const key = carryCacheKey(node.source, node.uuid, window, periodFrom)

  if (!bootTime || currentBoot < periodFrom) {
    carryCache.set(key, { bootTime, carryReceived: 0, carryTransmitted: 0, value: total })
    return total
  }

  const prev = carryCache.get(key)
  if (!prev) {
    carryCache.set(key, { bootTime, carryReceived: 0, carryTransmitted: 0, value: total })
    return total
  }

  if (prev.bootTime && bootTime > prev.bootTime) {
    const carryReceived = prev.carryReceived + prev.value.received
    const carryTransmitted = prev.carryTransmitted + prev.value.transmitted
    const value = {
      received: carryReceived + total.received,
      transmitted: carryTransmitted + total.transmitted,
    }
    carryCache.set(key, { bootTime, carryReceived, carryTransmitted, value })
    return value
  }

  if (prev.bootTime === bootTime && (prev.carryReceived || prev.carryTransmitted)) {
    const value = {
      received: prev.carryReceived + total.received,
      transmitted: prev.carryTransmitted + total.transmitted,
    }
    carryCache.set(key, { ...prev, value })
    return value
  }

  carryCache.set(key, { bootTime, carryReceived: 0, carryTransmitted: 0, value: total })
  return total
}

async function resolveTrafficTotal(
  client: BackendPool['entries'][number]['client'],
  node: Node,
  window: TrafficWindow,
  periodFrom: number,
  now: number,
) {
  const current = dynamicTrafficSample(node, now)
  if (!current) return null
  const baseline = await cachedBoundarySample(client, node, window, periodFrom, now)
  let total = diffTraffic(current, baseline, periodFrom)
  const bootMs = (current.boot_time ?? 0) * 1000
  if (bootMs >= periodFrom) {
    const beforeReboot = await trafficBeforeReboot(client, node.uuid, baseline, bootMs)
    if (beforeReboot) {
      total = {
        received: beforeReboot.received + (current.total_received ?? 0),
        transmitted: beforeReboot.transmitted + (current.total_transmitted ?? 0),
      }
    }
  }
  return withRebootCarry(node, window, periodFrom, total)
}

async function resolveTrafficTotals(
  entry: BackendPool['entries'][number],
  nodes: Node[],
  window: TrafficWindow,
  periodFrom: number,
  now: number,
) {
  const next = new Map<string, TrafficTotal>()
  await Promise.allSettled(
    nodes.map(async node => {
      const total = await resolveTrafficTotal(entry.client, node, window, periodFrom, now)
      if (total && total.received + total.transmitted > 0) next.set(node.uuid, total)
    }),
  )
  return next
}

function mergeTrafficTotals(target: Map<string, TrafficTotal>, source: Map<string, TrafficTotal>) {
  for (const [uuid, total] of source) target.set(uuid, total)
}

function makeTrafficRow(node: Node, total: TrafficTotal): TrafficRow | null {
  const received = Math.max(0, total.received)
  const transmitted = Math.max(0, total.transmitted)
  const value = received + transmitted
  if (value <= 0) return null

  return { uuid: node.uuid, value, received, transmitted }
}

function buildSourceGroups(nodes: Node[]) {
  const bySource = new Map<string, Node[]>()
  for (const node of nodes) {
    const list = bySource.get(node.source) || []
    list.push(node)
    bySource.set(node.source, list)
  }
  return bySource
}

/*
 * The backend caps large historical queries, so traffic totals are calculated
 * from the first available sample inside the period and the current counter.
 * If the counter reset after the period began, treat the current counter as the
 * active segment instead of subtracting a stale baseline.
 */
async function fetchTrafficTotals(
  pool: BackendPool,
  nodes: Node[],
  window: TrafficWindow,
  periodFrom: number,
  now: number,
) {
  const bySource = buildSourceGroups(nodes)
  const next = new Map<string, TrafficTotal>()

  await Promise.allSettled(
    pool.entries.map(async entry => {
      const group = bySource.get(entry.name) || []
      const sourceTotals = await resolveTrafficTotals(entry, group, window, periodFrom, now)
      mergeTrafficTotals(next, sourceTotals)
    }),
  )

  return next
}

export function useTrafficRanking(pool: BackendPool | null, nodes: Node[], window: TrafficWindow) {
  const [totals, setTotals] = useState<Map<string, TrafficTotal>>(new Map())
  const [loading, setLoading] = useState(false)

  const nodeSig = useMemo(
    () =>
      nodes
        .map(n => `${n.source}:${n.uuid}:${n.dynamic?.boot_time ?? 0}:${Math.floor((n.dynamic?.timestamp ?? 0) / 300_000)}`)
        .sort()
        .join('|'),
    [nodes],
  )

  useEffect(() => {
    if (!pool || !nodes.length) {
      setTotals(new Map())
      return
    }

    let cancelled = false

    const fetchRows = async () => {
      const now = Date.now()
      const periodFrom = window === 'today' ? startOfDay() : startOfMonth()
      setLoading(true)
      const next = await fetchTrafficTotals(pool, nodes, window, periodFrom, now)

      if (!cancelled) {
        setTotals(next)
        setLoading(false)
      }
    }

    fetchRows()
    return () => {
      cancelled = true
    }
  }, [pool, nodeSig, window])

  const rows = useMemo(
    () =>
      nodes
        .map<TrafficRow | null>(node => {
          const total = totals.get(node.uuid)
          if (!total) return null
          return makeTrafficRow(node, total)
        })
        .filter((row): row is TrafficRow => row != null),
    [totals, nodes],
  )

  return { rows, loading }
}
