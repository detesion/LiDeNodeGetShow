import { useEffect, useMemo, useState } from 'react'
import { dynamicSummaryAvg } from '../api/methods'
import type { BackendPool } from '../api/pool'
import type { DynamicSummary, Node } from '../types'

export type HardwareWindow = '4h' | '1d' | '7d'
export type TrafficWindow = 'today' | 'month'

interface HardwareScore {
  score: number
  cpu?: number
  mem?: number
  disk?: number
  samples: number
}

interface TrafficScore {
  total: number
  received: number
  transmitted: number
  baselineTimestamp?: number
}

export interface MonitoringStats {
  hardware: Partial<Record<HardwareWindow, HardwareScore>>
  traffic: Partial<Record<TrafficWindow, TrafficScore>>
}

export type MonitoringStatsLookup = Map<string, MonitoringStats>

const HARDWARE_REFRESH_MS = 5 * 60_000
const QUERY_TIMEOUT_MS = 25_000

const HARDWARE_WINDOWS: { key: HardwareWindow; ms: number }[] = [
  { key: '4h', ms: 4 * 60 * 60 * 1000 },
  { key: '1d', ms: 24 * 60 * 60 * 1000 },
  { key: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
]

const HARDWARE_FIELDS = [
  'cpu_usage',
  'used_memory',
  'total_memory',
  'total_space',
  'available_space',
]

function emptyStats(): MonitoringStats {
  return { hardware: {}, traffic: {} }
}

function mergeStats(
  prev: MonitoringStatsLookup,
  partial: Map<string, Partial<MonitoringStats>>,
): MonitoringStatsLookup {
  const next = new Map(prev)
  for (const [uuid, incoming] of partial) {
    const cur = next.get(uuid) || emptyStats()
    next.set(uuid, {
      hardware: incoming.hardware ? { ...cur.hardware, ...incoming.hardware } : cur.hardware,
      traffic: incoming.traffic ? { ...cur.traffic, ...incoming.traffic } : cur.traffic,
    })
  }
  return next
}

function scoreFromRows(rows: DynamicSummary[]): HardwareScore | null {
  const scores: number[] = []
  const cpus: number[] = []
  const mems: number[] = []
  const disks: number[] = []

  for (const row of rows) {
    const parts: number[] = []
    if (Number.isFinite(row.cpu_usage)) {
      parts.push(row.cpu_usage as number)
      cpus.push(row.cpu_usage as number)
    }
    if (row.total_memory && row.used_memory != null) {
      const mem = (row.used_memory / row.total_memory) * 100
      parts.push(mem)
      mems.push(mem)
    }
    if (row.total_space && row.available_space != null) {
      const disk = ((row.total_space - row.available_space) / row.total_space) * 100
      parts.push(disk)
      disks.push(disk)
    }
    if (parts.length) scores.push(parts.reduce((acc, v) => acc + v, 0) / parts.length)
  }

  if (!scores.length) return null
  return {
    score: average(scores),
    cpu: cpus.length ? average(cpus) : undefined,
    mem: mems.length ? average(mems) : undefined,
    disk: disks.length ? average(disks) : undefined,
    samples: rows.length,
  }
}

function average(values: number[]) {
  return values.reduce((acc, v) => acc + v, 0) / values.length
}

export function useMonitoringStats(
  pool: BackendPool | null,
  nodes: Node[],
  windows: HardwareWindow[] = [],
) {
  const [lookup, setLookup] = useState<MonitoringStatsLookup>(new Map())
  const [hardwareLoading, setHardwareLoading] = useState(false)
  const windowSig = windows.join('|')

  const nodeSig = useMemo(
    () =>
      nodes
        .map(n => `${n.source}:${n.uuid}`)
        .sort()
        .join('|'),
    [nodes],
  )

  useEffect(() => {
    if (!pool || !nodes.length || !windows.length) return

    const bySource = new Map<string, Node[]>()
    for (const node of nodes) {
      const list = bySource.get(node.source) || []
      list.push(node)
      bySource.set(node.source, list)
    }

    let cancelled = false
    let firstHardwareLoad = true

    const fetchHardware = async () => {
      const now = Date.now()
      const partial = new Map<string, Partial<MonitoringStats>>()
      if (firstHardwareLoad) setHardwareLoading(true)

      await Promise.allSettled(
        pool.entries.map(async entry => {
          const group = bySource.get(entry.name) || []
          await Promise.allSettled(
            group.flatMap(node => [
              ...HARDWARE_WINDOWS.filter(window => windows.includes(window.key)).map(async window => {
                const rows = await dynamicSummaryAvg(
                  entry.client,
                  {
                    fields: HARDWARE_FIELDS,
                    uuid: node.uuid,
                    timestamp_from: now - window.ms,
                    timestamp_to: now,
                    points: 24,
                  },
                  QUERY_TIMEOUT_MS,
                )
                const score = scoreFromRows(rows || [])
                if (score) {
                  const cur = partial.get(node.uuid) || {}
                  cur.hardware = { ...(cur.hardware || {}), [window.key]: score }
                  partial.set(node.uuid, cur)
                }
              }),
            ]),
          )
        }),
      )

      if (!cancelled) {
        setLookup(prev => mergeStats(prev, partial))
        setHardwareLoading(false)
        firstHardwareLoad = false
      }
    }

    fetchHardware()
    const hardwareTimer = setInterval(fetchHardware, HARDWARE_REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(hardwareTimer)
    }
  }, [pool, nodeSig, windowSig])

  return { lookup, hardwareLoading, trafficLoading: false }
}
