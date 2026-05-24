import { useEffect, useMemo, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Activity, ArrowDownUp, ArrowUpDown, Clock3, Expand, Gauge, GripVertical, RadioTower, ShieldAlert, X } from 'lucide-react'
import { Card } from './ui/card'
import { StatusDot } from './StatusDot'
import { bytes, pct, uptime } from '../utils/format'
import { deriveUsage, displayName } from '../utils/derive'
import { cn } from '../utils/cn'
import { getLatency, type LatencyLookup, type TimeWindowKey } from '../utils/rankings'
import type { BackendPool } from '../api/pool'
import { useMonitoringStats, type MonitoringStatsLookup } from '../hooks/useMonitoringStats'
import { useLatencyOverview } from '../hooks/useLatencyOverview'
import { useTrafficRanking, type TrafficWindow } from '../hooks/useTrafficRanking'
import type { LatencyType, Node } from '../types'

interface Props {
  nodes: Node[]
  latency: LatencyLookup
  pool: BackendPool | null
  latencyLoading?: boolean
}

type HardwareWindow = 'now' | '4h' | '1d' | '7d'
type HardwareMetric = 'overall' | 'cpu' | 'mem'
type NetworkMetric = 'latency' | 'loss'
type SortDirection = 'high' | 'low'
type RankingKey = 'uptime' | 'network' | 'traffic' | 'hardware'

const RANKING_ORDER_KEY = 'nodeget.ranking.order'
const DEFAULT_RANKING_ORDER: RankingKey[] = ['uptime', 'network', 'traffic', 'hardware']
const RANKING_LABELS: Record<RankingKey, string> = {
  uptime: '在线',
  network: '网络',
  traffic: '流量',
  hardware: '负载',
}
const RANKING_PILL_STYLES: Record<RankingKey, { active: string; idle: string; ring: string }> = {
  uptime: {
    active: 'border-emerald-400/80 bg-emerald-400/20 text-emerald-700 shadow-[0_0_18px_rgba(52,211,153,0.22)] dark:border-emerald-300/80 dark:bg-emerald-950/70 dark:text-emerald-100 dark:shadow-[inset_0_0_0_1px_rgba(167,243,208,0.10),0_0_18px_rgba(16,185,129,0.22)]',
    idle: 'border-emerald-500/45 bg-emerald-500/10 text-emerald-700 hover:border-emerald-500/70 hover:bg-emerald-400/18 hover:text-emerald-800 dark:border-emerald-400/70 dark:bg-emerald-950/45 dark:text-emerald-100 dark:hover:border-emerald-300/85 dark:hover:bg-emerald-900/60 dark:hover:shadow-[0_0_18px_rgba(16,185,129,0.24)]',
    ring: 'ring-emerald-300/70',
  },
  network: {
    active: 'border-sky-400/80 bg-sky-400/20 text-sky-700 shadow-[0_0_18px_rgba(56,189,248,0.22)] dark:border-sky-300/80 dark:bg-sky-950/70 dark:text-sky-100 dark:shadow-[inset_0_0_0_1px_rgba(186,230,253,0.10),0_0_18px_rgba(14,165,233,0.22)]',
    idle: 'border-sky-500/45 bg-sky-500/10 text-sky-700 hover:border-sky-500/70 hover:bg-sky-400/18 hover:text-sky-800 dark:border-sky-400/70 dark:bg-sky-950/45 dark:text-sky-100 dark:hover:border-sky-300/85 dark:hover:bg-sky-900/60 dark:hover:shadow-[0_0_18px_rgba(14,165,233,0.24)]',
    ring: 'ring-sky-300/70',
  },
  traffic: {
    active: 'border-violet-400/80 bg-violet-400/20 text-violet-700 shadow-[0_0_18px_rgba(167,139,250,0.22)] dark:border-violet-300/80 dark:bg-violet-950/70 dark:text-violet-100 dark:shadow-[inset_0_0_0_1px_rgba(221,214,254,0.10),0_0_18px_rgba(139,92,246,0.22)]',
    idle: 'border-violet-500/45 bg-violet-500/10 text-violet-700 hover:border-violet-500/70 hover:bg-violet-400/18 hover:text-violet-800 dark:border-violet-400/70 dark:bg-violet-950/45 dark:text-violet-100 dark:hover:border-violet-300/85 dark:hover:bg-violet-900/60 dark:hover:shadow-[0_0_18px_rgba(139,92,246,0.24)]',
    ring: 'ring-violet-300/70',
  },
  hardware: {
    active: 'border-amber-400/80 bg-amber-400/20 text-amber-700 shadow-[0_0_18px_rgba(251,191,36,0.22)] dark:border-amber-300/80 dark:bg-amber-950/70 dark:text-amber-100 dark:shadow-[inset_0_0_0_1px_rgba(254,240,138,0.10),0_0_18px_rgba(245,158,11,0.24)]',
    idle: 'border-amber-500/45 bg-amber-500/10 text-amber-700 hover:border-amber-500/70 hover:bg-amber-400/18 hover:text-amber-800 dark:border-amber-400/70 dark:bg-amber-950/45 dark:text-amber-100 dark:hover:border-amber-300/85 dark:hover:bg-amber-900/60 dark:hover:shadow-[0_0_18px_rgba(245,158,11,0.26)]',
    ring: 'ring-amber-300/70',
  },
}

const HARDWARE_WINDOWS: { key: HardwareWindow; label: string }[] = [
  { key: 'now', label: '实时' },
  { key: '4h', label: '4h' },
  { key: '1d', label: '1天' },
  { key: '7d', label: '7天' },
]

const NETWORK_WINDOWS: { key: TimeWindowKey; label: string }[] = [
  { key: '1h', label: '1h' },
  { key: '6h', label: '6h' },
  { key: '12h', label: '12h' },
  { key: '24h', label: '1天' },
  { key: '30d', label: '30天' },
]

const TRAFFIC_WINDOWS: { key: TrafficWindow; label: string }[] = [
  { key: 'today', label: '当日' },
  { key: 'month', label: '当月' },
]

function initialRankingOrder(): RankingKey[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RANKING_ORDER_KEY) || '[]')
    if (!Array.isArray(raw)) return DEFAULT_RANKING_ORDER
    const picked = raw.filter((key): key is RankingKey =>
      DEFAULT_RANKING_ORDER.includes(key as RankingKey),
    )
    return [...picked, ...DEFAULT_RANKING_ORDER.filter(key => !picked.includes(key))]
  } catch {
    return DEFAULT_RANKING_ORDER
  }
}

function isRankingKey(value: string): value is RankingKey {
  return DEFAULT_RANKING_ORDER.includes(value as RankingKey)
}

export function RankingsPanel({
  nodes,
  latency,
  pool,
  latencyLoading,
}: Props) {
  const [hardwareWindow, setHardwareWindow] = useState<HardwareWindow>('now')
  const [hardwareMetric, setHardwareMetric] = useState<HardwareMetric>('overall')
  const [trafficWindow, setTrafficWindow] = useState<TrafficWindow>('today')
  const [networkWindow, setNetworkWindow] = useState<TimeWindowKey>('1h')
  const [networkType, setNetworkType] = useState<LatencyType>('ping')
  const [networkMetric, setNetworkMetric] = useState<NetworkMetric>('latency')
  const [uptimeSort, setUptimeSort] = useState<SortDirection>('high')
  const [networkSort, setNetworkSort] = useState<SortDirection>('low')
  const [trafficSort, setTrafficSort] = useState<SortDirection>('high')
  const [hardwareSort, setHardwareSort] = useState<SortDirection>('high')
  const [rankingOrder, setRankingOrder] = useState<RankingKey[]>(initialRankingOrder)
  const [draggingKey, setDraggingKey] = useState<RankingKey | null>(null)
  const [overKey, setOverKey] = useState<RankingKey | null>(null)
  const [expandedKey, setExpandedKey] = useState<RankingKey | null>(null)
  const overviewWindows = useMemo(
    () => (networkWindow === '1h' ? [] : [networkWindow]),
    [networkWindow],
  )
  const overviewTypes = useMemo(() => [networkType], [networkType])
  const {
    lookup: activeLatency,
    loading: activeLatencyLoading,
  } = useLatencyOverview(pool, nodes, overviewWindows, overviewTypes)
  const {
    lookup: monitoring,
    hardwareLoading,
  } = useMonitoringStats(pool, nodes, hardwareWindow === 'now' ? [] : [hardwareWindow])
  const networkLookup = networkWindow === '1h' ? latency : activeLatency
  const networkLoading = networkWindow === '1h' ? latencyLoading : activeLatencyLoading

  useEffect(() => {
    localStorage.setItem(RANKING_ORDER_KEY, JSON.stringify(rankingOrder))
  }, [rankingOrder])

  const hardwareRows =
    hardwareWindow === 'now'
      ? rankHardwareNow(nodes, hardwareMetric)
      : rankHardwareHistory(nodes, monitoring, hardwareWindow, hardwareMetric)
  const networkRows = rankNetwork(nodes, networkLookup, networkMetric, networkType, networkWindow)
  const { rows: trafficData, loading: trafficLoading } = useTrafficRanking(pool, nodes, trafficWindow)
  const trafficRows = rankTrafficPeriod(nodes, trafficData)

  const moveRanking = (from: RankingKey, to: RankingKey) => {
    if (from === to) return
    setRankingOrder(current => {
      const next = current.slice()
      const fromIndex = next.indexOf(from)
      const toIndex = next.indexOf(to)
      if (fromIndex < 0 || toIndex < 0) return current
      next.splice(fromIndex, 1)
      next.splice(toIndex, 0, from)
      return next
    })
  }

  const toggleRanking = (key: RankingKey) => {
    setExpandedKey(current => (current === key ? null : key))
  }

  const onDragStart = (key: RankingKey, event: DragEvent<HTMLElement>) => {
    setDraggingKey(key)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', key)
  }

  const onDrop = (key: RankingKey, event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    const from = event.dataTransfer.getData('text/plain') || draggingKey || ''
    if (isRankingKey(from)) moveRanking(from, key)
    setDraggingKey(null)
    setOverKey(null)
  }

  const cards: Record<RankingKey, ReactNode> = {
    uptime: (
      <RankingCard
        title="在线时长"
        icon={Clock3}
        rows={sortRows(rankUptime(nodes), uptimeSort)}
        formatter={v => uptime(v)}
        empty="暂无在线时长数据"
        dragHandle={<DragHandle />}
        sortControl={<DirectionToggle value={uptimeSort} onChange={setUptimeSort} />}
        openControl={<OpenLayerButton onClick={() => setExpandedKey('uptime')} />}
        onOpenLayer={() => setExpandedKey('uptime')}
      />
    ),
    network: (
      <RankingCard
        title="网络质量"
        icon={networkMetric === 'loss' ? ShieldAlert : RadioTower}
        rows={sortRows(networkRows, networkSort)}
        formatter={networkMetric === 'loss' ? v => pct(v) : v => `${v.toFixed(1)} ms`}
        empty={networkLoading ? '加载网络数据…' : '暂无网络数据'}
        controls={
          <div className="space-y-2">
            <Segmented
              items={[
                { key: 'ping' as const, label: 'Ping' },
                { key: 'tcp_ping' as const, label: 'TCP' },
              ]}
              value={networkType}
              onChange={v => setNetworkType(v)}
            />
            <Segmented
              items={[
                { key: 'latency' as const, label: '延迟' },
                { key: 'loss' as const, label: '丢包' },
              ]}
              value={networkMetric}
              onChange={v => setNetworkMetric(v)}
            />
            <Segmented
              items={NETWORK_WINDOWS}
              value={networkWindow}
              onChange={v => setNetworkWindow(v)}
            />
          </div>
        }
        dragHandle={<DragHandle />}
        sortControl={<DirectionToggle value={networkSort} onChange={setNetworkSort} />}
        openControl={<OpenLayerButton onClick={() => setExpandedKey('network')} />}
        onOpenLayer={() => setExpandedKey('network')}
      />
    ),
    traffic: (
      <RankingCard
        title="流量消耗"
        icon={ArrowDownUp}
        rows={sortRows(trafficRows, trafficSort)}
        formatter={bytes}
        empty={trafficLoading ? '加载流量数据…' : '暂无本周期流量数据'}
        controls={
          <Segmented
            items={TRAFFIC_WINDOWS}
            value={trafficWindow}
            onChange={v => setTrafficWindow(v)}
          />
        }
        dragHandle={<DragHandle />}
        sortControl={<DirectionToggle value={trafficSort} onChange={setTrafficSort} />}
        openControl={<OpenLayerButton onClick={() => setExpandedKey('traffic')} />}
        note="按周期内增量累加，自动处理重启后的计数器重置。"
        onOpenLayer={() => setExpandedKey('traffic')}
      />
    ),
    hardware: (
      <RankingCard
        title="硬件负载"
        icon={Gauge}
        rows={sortRows(hardwareRows, hardwareSort)}
        formatter={v => pct(v)}
        empty={hardwareLoading ? '加载历史负载…' : '暂无负载数据'}
        controls={
          <div className="space-y-2">
            <Segmented
              items={[
                { key: 'overall' as const, label: '综合' },
                { key: 'cpu' as const, label: 'CPU' },
                { key: 'mem' as const, label: '内存' },
              ]}
              value={hardwareMetric}
              onChange={v => setHardwareMetric(v)}
            />
            <Segmented
              items={HARDWARE_WINDOWS}
              value={hardwareWindow}
              onChange={v => setHardwareWindow(v)}
            />
          </div>
        }
        dragHandle={<DragHandle />}
        sortControl={<DirectionToggle value={hardwareSort} onChange={setHardwareSort} />}
        openControl={<OpenLayerButton onClick={() => setExpandedKey('hardware')} />}
        onOpenLayer={() => setExpandedKey('hardware')}
      />
    ),
  }

  const expandedCards: Record<RankingKey, ReactNode> = {
    uptime: (
      <RankingCard
        title="在线时长"
        icon={Clock3}
        rows={sortRows(rankUptime(nodes), uptimeSort)}
        formatter={v => uptime(v)}
        empty="暂无在线时长数据"
        sortControl={<DirectionToggle value={uptimeSort} onChange={setUptimeSort} />}
        expanded
      />
    ),
    network: (
      <RankingCard
        title="网络质量"
        icon={networkMetric === 'loss' ? ShieldAlert : RadioTower}
        rows={sortRows(networkRows, networkSort)}
        formatter={networkMetric === 'loss' ? v => pct(v) : v => `${v.toFixed(1)} ms`}
        empty={networkLoading ? '加载网络数据…' : '暂无网络数据'}
        controls={
          <div className="space-y-2">
            <Segmented
              items={[
                { key: 'ping' as const, label: 'Ping' },
                { key: 'tcp_ping' as const, label: 'TCP' },
              ]}
              value={networkType}
              onChange={v => setNetworkType(v)}
            />
            <Segmented
              items={[
                { key: 'latency' as const, label: '延迟' },
                { key: 'loss' as const, label: '丢包' },
              ]}
              value={networkMetric}
              onChange={v => setNetworkMetric(v)}
            />
            <Segmented
              items={NETWORK_WINDOWS}
              value={networkWindow}
              onChange={v => setNetworkWindow(v)}
            />
          </div>
        }
        sortControl={<DirectionToggle value={networkSort} onChange={setNetworkSort} />}
        expanded
      />
    ),
    traffic: (
      <RankingCard
        title="流量消耗"
        icon={ArrowDownUp}
        rows={sortRows(trafficRows, trafficSort)}
        formatter={bytes}
        empty={trafficLoading ? '加载流量数据…' : '暂无本周期流量数据'}
        controls={
          <Segmented
            items={TRAFFIC_WINDOWS}
            value={trafficWindow}
            onChange={v => setTrafficWindow(v)}
          />
        }
        sortControl={<DirectionToggle value={trafficSort} onChange={setTrafficSort} />}
        note="按周期内增量累加，自动处理重启后的计数器重置。"
        expanded
      />
    ),
    hardware: (
      <RankingCard
        title="硬件负载"
        icon={Gauge}
        rows={sortRows(hardwareRows, hardwareSort)}
        formatter={v => pct(v)}
        empty={hardwareLoading ? '加载历史负载…' : '暂无负载数据'}
        controls={
          <div className="space-y-2">
            <Segmented
              items={[
                { key: 'overall' as const, label: '综合' },
                { key: 'cpu' as const, label: 'CPU' },
                { key: 'mem' as const, label: '内存' },
              ]}
              value={hardwareMetric}
              onChange={v => setHardwareMetric(v)}
            />
            <Segmented
              items={HARDWARE_WINDOWS}
              value={hardwareWindow}
              onChange={v => setHardwareWindow(v)}
            />
          </div>
        }
        sortControl={<DirectionToggle value={hardwareSort} onChange={setHardwareSort} />}
        expanded
      />
    ),
  }

  return (
    <aside className="space-y-4 lg:sticky lg:top-20 self-start">
      <div className="rounded-md border bg-card/80 px-3 py-2.5">
        <div className="text-sm font-semibold">多维榜单</div>
        <div className="mt-2 grid grid-cols-4 gap-1">
          {rankingOrder.map(key => (
            (() => {
              const tone = RANKING_PILL_STYLES[key]
              return (
            <button
              key={key}
              type="button"
              draggable
              onClick={() => toggleRanking(key)}
              onDragStart={event => onDragStart(key, event)}
              onDragEnd={() => {
                setDraggingKey(null)
                setOverKey(null)
              }}
              onDragOver={event => {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setOverKey(key)
              }}
              onDragLeave={() => setOverKey(current => (current === key ? null : current))}
              onDrop={event => onDrop(key, event)}
              className={cn(
                'inline-flex h-8 items-center justify-center gap-1.5 rounded-full border px-2 text-[11px] font-medium transition',
                expandedKey === key ? tone.active : tone.idle,
                draggingKey === key && 'opacity-55',
                overKey === key && draggingKey !== key && `ring-1 ${tone.ring}`,
              )}
              title={`${expandedKey === key ? '收起' : '展开'}${RANKING_LABELS[key]}榜单，拖拽可调整顺序`}
            >
              <GripVertical className="h-3 w-3 opacity-65" />
              {RANKING_LABELS[key]}
            </button>
              )
            })()
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {rankingOrder.map(key => (
          <div
            key={key}
            draggable
            onDragStart={event => onDragStart(key, event)}
            onDragEnd={() => {
              setDraggingKey(null)
              setOverKey(null)
            }}
            onDragOver={event => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              setOverKey(key)
            }}
            onDragLeave={() => setOverKey(current => (current === key ? null : current))}
            onDrop={event => onDrop(key, event)}
            className={cn(
              'rounded-md transition-all',
              draggingKey === key && 'opacity-55',
              overKey === key && draggingKey !== key && 'ring-1 ring-primary/50 ring-offset-2 ring-offset-background',
            )}
          >
            {cards[key]}
          </div>
        ))}
      </div>
      {expandedKey && (
        <RankingLayer
          title={`${RANKING_LABELS[expandedKey]}榜单`}
          onClose={() => setExpandedKey(null)}
        >
          {expandedCards[expandedKey]}
        </RankingLayer>
      )}
    </aside>
  )
}

interface Row {
  node: Node
  value: number
  sub?: string
}

function RankingCard({
  title,
  icon: Icon,
  rows,
  formatter,
  empty,
  controls,
  note,
  dragHandle,
  sortControl,
  openControl,
  onOpenLayer,
  expanded = false,
}: {
  title: string
  icon: typeof Activity
  rows: Row[]
  formatter: (value: number) => string
  empty: string
  controls?: ReactNode
  note?: string
  dragHandle?: ReactNode
  sortControl?: ReactNode
  openControl?: ReactNode
  onOpenLayer?: () => void
  expanded?: boolean
}) {
  const max = Math.max(1, ...rows.map(r => r.value))
  const visibleRows = expanded ? rows : rows.slice(0, 3)
  const canExpand = rows.length > 3

  return (
    <Card
      className={cn(
        'p-3 transition-all duration-200',
        expanded && 'border-primary/30 bg-card/95 shadow-lg shadow-primary/5',
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        {dragHandle}
        <Icon className={cn('shrink-0 text-primary', expanded ? 'h-[18px] w-[18px]' : 'h-4 w-4')} />
        <div className={cn('min-w-0 flex-1 truncate font-medium', expanded ? 'text-base' : 'text-sm')}>
          {title}
        </div>
        {openControl}
        {sortControl}
      </div>
      {controls && <div className="mb-3">{controls}</div>}
      {rows.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted-foreground">{empty}</div>
      ) : (
        <div
          className={cn(
            'space-y-1 pr-1',
            expanded && 'max-h-[30rem] overflow-y-auto rounded-sm',
          )}
        >
          {visibleRows.map((row, index) => (
            <a
              key={row.node.uuid}
              href={`#${encodeURIComponent(row.node.uuid)}`}
              className="group block rounded-md px-2 py-1.5 hover:bg-muted/70 transition"
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'w-5 text-xs font-mono text-muted-foreground',
                    index === 0 && 'text-primary font-semibold',
                  )}
                >
                  {index + 1}
                </span>
                <StatusDot online={row.node.online} className="h-1.5 w-1.5 ring-1" />
                <span className="flex-1 min-w-0 truncate text-xs font-medium">
                  {displayName(row.node)}
                </span>
                <span className="font-mono text-xs tabular-nums">{formatter(row.value)}</span>
              </div>
              <RankBar value={row.value} max={max} index={index} />
              {row.sub && <MetaLine text={row.sub} />}
            </a>
          ))}
        </div>
      )}
      {canExpand && !expanded && onOpenLayer && (
        <button
          type="button"
          onClick={event => {
            event.preventDefault()
            event.stopPropagation()
            onOpenLayer()
          }}
          className="mt-2 inline-flex h-7 w-full items-center justify-center rounded-sm border border-border bg-background/50 text-[11px] text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
        >
          查看全部 {rows.length}
        </button>
      )}
      {note && <div className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{note}</div>}
    </Card>
  )
}

function OpenLayerButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={event => {
        event.preventDefault()
        event.stopPropagation()
        onClick()
      }}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-border bg-background/50 text-muted-foreground transition hover:text-foreground"
      title="打开宽屏榜单"
      aria-label="打开宽屏榜单"
    >
      <Expand className="h-3.5 w-3.5" />
    </button>
  )
}

function RankingLayer({
  title,
  children,
  onClose,
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-start justify-center bg-background/70 px-4 py-8 backdrop-blur-sm">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="关闭榜单图层"
        onClick={onClose}
      />
      <div className="relative z-[1] w-full max-w-4xl animate-in fade-in-0 zoom-in-95 duration-150">
        <div className="mb-3 flex items-center justify-between gap-3 rounded-md border bg-card/95 px-4 py-3 shadow-xl">
          <div>
            <div className="text-base font-semibold">{title}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">宽屏查看完整排行</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-border bg-background/60 text-muted-foreground hover:text-foreground"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

function DragHandle() {
  return (
    <span
      className="inline-flex h-7 w-5 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground/70 active:cursor-grabbing"
      title="拖拽调整榜单顺序"
      aria-hidden
    >
      <GripVertical className="h-3.5 w-3.5" />
    </span>
  )
}

function RankBar({ value, max, index }: { value: number; max: number; index: number }) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  const color =
    index === 0
      ? 'bg-emerald-400'
      : index === 1
        ? 'bg-sky-400'
        : index === 2
          ? 'bg-violet-400'
          : 'bg-primary/65'
  return (
    <div className="mt-1 ml-7 flex gap-0.5" aria-hidden>
      {Array.from({ length: 12 }).map((_, i) => {
        const active = (i + 1) / 12 <= ratio || (ratio > 0 && i === 0)
        return (
          <span
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              active ? color : 'bg-muted',
            )}
          />
        )
      })}
    </div>
  )
}

function MetaLine({ text }: { text: string }) {
  return (
    <div className="ml-7 mt-1 flex flex-wrap gap-1">
      {text.split(' · ').map(part => (
        <span key={part} className="rounded-sm bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {part}
        </span>
      ))}
    </div>
  )
}

function Segmented<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { key: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map(item => (
        <button
          key={item.key}
          type="button"
          onClick={() => onChange(item.key)}
          className={cn(
            'h-7 rounded-sm border px-2 text-[11px] font-medium transition',
            value === item.key
              ? 'border-primary/50 bg-primary/10 text-primary'
              : 'border-border bg-background/50 text-muted-foreground hover:text-foreground',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

function DirectionToggle({
  value,
  onChange,
}: {
  value: SortDirection
  onChange: (value: SortDirection) => void
}) {
  const next = value === 'high' ? 'low' : 'high'
  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      title={value === 'high' ? '当前从高到低，点击切换为从低到高' : '当前从低到高，点击切换为从高到低'}
      aria-label={value === 'high' ? '切换为从低到高' : '切换为从高到低'}
      className={cn(
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border transition',
        value === 'low'
          ? 'border-primary/50 bg-primary/10 text-primary'
          : 'border-border bg-background/50 text-muted-foreground hover:text-foreground',
      )}
    >
      <ArrowUpDown className="h-3.5 w-3.5" />
    </button>
  )
}

function sortRows(rows: Row[], direction: SortDirection) {
  const next = rows.slice().sort((a, b) =>
    direction === 'high' ? b.value - a.value : a.value - b.value,
  )
  return next
}

function rankHardwareNow(nodes: Node[], metric: HardwareMetric): Row[] {
  return nodes
    .map<Row | null>(node => {
      const usage = deriveUsage(node)
      const value =
        metric === 'cpu'
          ? usage.cpu
          : metric === 'mem'
            ? usage.mem
            : averageDefined([usage.cpu, usage.mem, usage.disk])
      if (value == null || !Number.isFinite(value)) return null
      return {
        node,
        value,
        sub: `CPU ${pct(usage.cpu)} · 内存 ${pct(usage.mem)} · 磁盘 ${pct(usage.disk)}`,
      }
    })
    .filter((row): row is Row => row != null)
}

function rankHardwareHistory(
  nodes: Node[],
  monitoring: MonitoringStatsLookup,
  window: HardwareWindow,
  metric: HardwareMetric,
): Row[] {
  return nodes
    .map<Row | null>(node => {
      if (window === 'now') return null
      const stat = monitoring.get(node.uuid)?.hardware[window]
      if (!stat) return null
      const value =
        metric === 'cpu'
          ? stat.cpu
          : metric === 'mem'
            ? stat.mem
            : stat.score
      if (value == null || !Number.isFinite(value)) return null
      return {
        node,
        value,
        sub: `CPU ${pct(stat.cpu)} · 内存 ${pct(stat.mem)} · 磁盘 ${pct(stat.disk)}`,
      }
    })
    .filter((row): row is Row => row != null)
}

function averageDefined(values: Array<number | undefined>) {
  const valid = values.filter((v): v is number => Number.isFinite(v))
  return valid.length ? valid.reduce((acc, v) => acc + v, 0) / valid.length : undefined
}

function rankNetwork(
  nodes: Node[],
  latency: LatencyLookup,
  metric: NetworkMetric,
  type: LatencyType,
  window: TimeWindowKey,
): Row[] {
  return nodes
    .map<Row | null>(node => {
      const stat = getLatency(latency, node.uuid, type, window)
      if (!stat || stat.samples === 0) return null
      const value = metric === 'loss' ? stat.lossRate : stat.avg
      if (value == null || !Number.isFinite(value)) return null
      return {
        node,
        value,
        sub: `${stat.success}/${stat.samples} 成功${stat.jitter != null ? ` · 抖动 ${stat.jitter.toFixed(1)} ms` : ''}`,
      }
    })
    .filter((row): row is Row => row != null)
}

function rankTrafficPeriod(nodes: Node[], rows: { uuid: string; value: number; received: number; transmitted: number }[]): Row[] {
  const byUuid = new Map(rows.map(row => [row.uuid, row]))
  return nodes
    .map<Row | null>(node => {
      const stat = byUuid.get(node.uuid)
      if (!stat || stat.value <= 0) return null
      return {
        node,
        value: stat.value,
        sub: `接收 ${bytes(stat.received)} · 发送 ${bytes(stat.transmitted)}`,
      }
    })
    .filter((row): row is Row => row != null)
}

function rankUptime(nodes: Node[]): Row[] {
  return nodes
    .map<Row | null>(node => {
      const value = node.dynamic?.uptime ?? 0
      if (value <= 0) return null
      return {
        node,
        value,
        sub: node.online ? '当前在线' : '最近上报',
      }
    })
    .filter((row): row is Row => row != null)
}
