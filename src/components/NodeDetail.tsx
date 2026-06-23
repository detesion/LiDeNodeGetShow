import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Expand, X } from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Flag } from './Flag'
import { StatusDot } from './StatusDot'
import { bytes, pct, relativeAge, uptime } from '../utils/format'
import { deriveUsage, displayName, distroLogo, osLabel, virtLabel } from '../utils/derive'
import { cycleProgress, hasCost, remainingDays, remainingValue } from '../utils/cost'
import { cn, strokeColor } from '../utils/cn'
import {
  computeLatencyStats,
  type LatencyStats,
} from '../utils/latency'
import { useNodeLatency } from '../hooks/useNodeLatency'
import { useNodeTrafficHistory, type TrafficHistoryPoint } from '../hooks/useNodeTrafficHistory'
import { useTrafficRanking, type TrafficRow } from '../hooks/useTrafficRanking'
import { dynamicSummaryMulti } from '../api/methods'
import type { BackendPool } from '../api/pool'
import type { DynamicSummary, HistorySample, LatencyType, Node, NodeMeta, TaskQueryResult } from '../types'
import type { TimeWindowKey } from '../utils/rankings'

const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 6,
  fontSize: 11,
}

const LATENCY_WINDOWS: { key: TimeWindowKey; label: string }[] = [
  { key: '1h', label: '1h' },
  { key: '6h', label: '6h' },
  { key: '12h', label: '12h' },
  { key: '24h', label: '1天' },
  { key: '30d', label: '30天' },
]

const WINDOW_LABELS: Record<TimeWindowKey, string> = {
  '1h': '近 1 小时',
  '6h': '近 6 小时',
  '12h': '近 12 小时',
  '24h': '近 1 天',
  '30d': '近 30 天',
}

const DETAIL_DYNAMIC_INTERVAL_MS = 2_000
const DETAIL_HISTORY_LIMIT = 180
const DETAIL_DYNAMIC_FIELDS = [
  'cpu_usage',
  'used_memory',
  'total_memory',
  'available_memory',
  'used_swap',
  'total_swap',
  'total_space',
  'available_space',
  'read_speed',
  'write_speed',
  'receive_speed',
  'transmit_speed',
  'total_received',
  'total_transmitted',
  'load_one',
  'load_five',
  'load_fifteen',
  'uptime',
  'boot_time',
  'process_count',
  'tcp_connections',
  'udp_connections',
]

const DETAIL_WINDOW_MS: Record<TimeWindowKey, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
}

interface Props {
  node: Node | null
  onClose: () => void
  showSource?: boolean
  pool: BackendPool | null
}

function normalizeDynTs(ts: number) {
  return ts < 1_000_000_000_000 ? ts * 1000 : ts
}

function detailSampleFrom(row: DynamicSummary): HistorySample {
  const memTotal = row.total_memory || 0
  const diskTotal = row.total_space || 0
  return {
    t: normalizeDynTs(row.timestamp),
    cpu: row.cpu_usage ?? null,
    mem: memTotal && row.used_memory != null ? (row.used_memory / memTotal) * 100 : null,
    disk:
      diskTotal && row.available_space != null
        ? ((diskTotal - row.available_space) / diskTotal) * 100
        : null,
    netIn: row.receive_speed ?? 0,
    netOut: row.transmit_speed ?? 0,
  }
}

function useFocusedNode(pool: BackendPool | null, node: Node | null) {
  const [dynamic, setDynamic] = useState<DynamicSummary | null>(null)
  const [history, setHistory] = useState<HistorySample[]>([])
  const nodeSig = node ? `${node.source}:${node.uuid}` : ''

  useEffect(() => {
    setDynamic(null)
    setHistory(node?.history ?? [])
    if (!pool || !node) return
    const entry = pool.entries.find(e => e.name === node.source)
    if (!entry) return

    let cancelled = false
    const fetchOnce = async () => {
      try {
        const rows = await dynamicSummaryMulti(entry.client, [node.uuid], DETAIL_DYNAMIC_FIELDS)
        const row = rows?.[0]
        if (!row || cancelled) return
        setDynamic(row)
        setHistory(prev => {
          const sample = detailSampleFrom(row)
          const dedup = prev.length && prev[prev.length - 1].t === sample.t ? prev : prev.concat(sample)
          return dedup.slice(-DETAIL_HISTORY_LIMIT)
        })
      } catch {}
    }

    fetchOnce()
    const timer = setInterval(fetchOnce, DETAIL_DYNAMIC_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [pool, nodeSig])

  return useMemo<Node | null>(() => {
    if (!node) return null
    return {
      ...node,
      dynamic: dynamic ?? node.dynamic,
      history: history.length ? history : node.history,
    }
  }, [node, dynamic, history])
}

export function NodeDetail({ node, onClose, showSource, pool }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)
  const [tcpWindow, setTcpWindow] = useState<TimeWindowKey>('1h')
  const [trafficWindow, setTrafficWindow] = useState<TimeWindowKey>('1h')
  const [chartLayer, setChartLayer] = useState<'resource' | 'tcp' | 'traffic' | null>(null)
  const focusedNode = useFocusedNode(pool, node)

  useEffect(() => {
    if (!node) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (chartLayer) setChartLayer(null)
        else onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [node, onClose, chartLayer])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setStuck(false)
    const onScroll = () => {
      const h = headerRef.current?.offsetHeight ?? 60
      setStuck(el.scrollTop > h)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [node])

  const { data: tcpData, loading: tcpLoading } = useNodeLatency(
    pool,
    focusedNode?.source ?? null,
    focusedNode?.uuid ?? null,
    'tcp_ping',
    tcpWindow,
  )
  const detailNodes = useMemo(() => (focusedNode ? [focusedNode] : []), [focusedNode])
  const { rows: todayTrafficRows, loading: todayTrafficLoading } = useTrafficRanking(
    pool,
    detailNodes,
    'today',
  )
  const { rows: monthTrafficRows, loading: monthTrafficLoading } = useTrafficRanking(
    pool,
    detailNodes,
    'month',
  )
  const { data: trafficHistory, loading: trafficHistoryLoading } = useNodeTrafficHistory(
    pool,
    focusedNode,
    trafficWindow,
  )

  if (!focusedNode) return null

  const u = deriveUsage(focusedNode)
  const d = focusedNode.dynamic
  const s = focusedNode.static?.system
  const cpu = focusedNode.static?.cpu
  const tags = focusedNode.meta?.tags ?? []
  const virt = virtLabel(focusedNode)
  const logo = distroLogo(focusedNode)
  const swap =
    d?.total_swap && d.used_swap != null ? (d.used_swap / d.total_swap) * 100 : undefined
  const loadAvg =
    d?.load_one != null && d?.load_five != null && d?.load_fifteen != null
      ? `${d.load_one.toFixed(2)} / ${d.load_five.toFixed(2)} / ${d.load_fifteen.toFixed(2)}`
      : null
  const history = focusedNode.history || []
  const todayTraffic = todayTrafficRows.find(row => row.uuid === focusedNode.uuid)
  const monthTraffic = monthTrafficRows.find(row => row.uuid === focusedNode.uuid)
  const trafficLoading = todayTrafficLoading || monthTrafficLoading

  return (
    <div
      ref={scrollRef}
      className="fixed inset-0 z-50 bg-background overflow-y-auto animate-in fade-in duration-150"
    >
      <div
        ref={headerRef}
        className={`sticky top-0 z-10 transition-[background-color,backdrop-filter,border-color] duration-200 ${
          stuck
            ? 'border-b border-border/40 backdrop-blur bg-background/70'
            : 'border-b border-transparent'
        }`}
      >
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-2 sm:gap-3">
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="返回" className="shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <StatusDot online={focusedNode.online} />
          {logo && (
            <img src={logo} alt="" className="w-5 h-5 shrink-0 object-contain" loading="lazy" />
          )}
          <span className="font-semibold truncate min-w-0">{displayName(focusedNode)}</span>
          <Flag code={focusedNode.meta?.region} className="shrink-0" />
          <span className="hidden md:inline truncate text-xs font-mono text-muted-foreground">
            {focusedNode.uuid}
          </span>
          <div className="ml-auto flex flex-wrap gap-1.5 shrink-0">
            {focusedNode.meta?.region && <Badge variant="secondary">{focusedNode.meta.region}</Badge>}
            {showSource && (
              <Badge variant="secondary" className="hidden sm:inline-flex">
                {focusedNode.source}
              </Badge>
            )}
            {virt && <Badge variant="secondary">{virt}</Badge>}
            {tags.map(t => (
              <Badge key={t} variant="outline">
                {t}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">
        <Section
          title="资源"
          actions={<ChartOpenButton label="放大资源趋势" onClick={() => setChartLayer('resource')} />}
        >
          <div className="flex flex-wrap justify-around gap-4 sm:gap-6">
            <Ring label="CPU" value={u.cpu} sub={loadAvg ?? undefined} />
            <Ring
              label="内存"
              value={u.mem}
              sub={u.memTotal ? `${bytes(u.memUsed)} / ${bytes(u.memTotal)}` : undefined}
            />
            <Ring
              label="磁盘"
              value={u.disk}
              sub={u.diskTotal ? `${bytes(u.diskUsed)} / ${bytes(u.diskTotal)}` : undefined}
            />
            {swap != null && (
              <Ring
                label="Swap"
                value={swap}
                sub={`${bytes(d?.used_swap)} / ${bytes(d?.total_swap)}`}
              />
            )}
          </div>
          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-x-8 border-t pt-4">
            <KV k="主机名" v={s?.system_host_name} />
            <KV k="操作系统" v={osLabel(focusedNode)} />
            <KV k="内核" v={s?.system_kernel || s?.system_kernel_version} />
            <KV k="CPU 架构" v={s?.arch || s?.cpu_arch} />
            <KV k="虚拟化" v={virt} />
            <KV k="CPU 型号" v={cpu?.brand || cpu?.per_core?.[0]?.brand} />
            <KV
              k="核心"
              v={
                cpu?.physical_cores != null
                  ? `${cpu.physical_cores} 物理 / ${cpu.logical_cores} 逻辑`
                  : cpu?.per_core?.length
                    ? `${cpu.per_core.length} 核`
                    : null
              }
            />
          </div>
        </Section>

        {history.length > 1 && (
          <Section
            title="实时趋势"
            actions={<ChartOpenButton label="放大实时趋势" onClick={() => setChartLayer('resource')} />}
          >
            <ResourceTrendGrid history={history} />
          </Section>
        )}

        <LatencyBlock
          title="TCP"
          rows={tcpData}
          type="tcp_ping"
          loading={tcpLoading}
          window={tcpWindow}
          windows={LATENCY_WINDOWS}
          onWindowChange={setTcpWindow}
          onOpenLayer={() => setChartLayer('tcp')}
        />
        <TrafficSection
          node={focusedNode}
          today={todayTraffic}
          month={monthTraffic}
          loading={trafficLoading || trafficHistoryLoading}
          data={trafficHistory}
          window={trafficWindow}
          windows={LATENCY_WINDOWS}
          onWindowChange={setTrafficWindow}
          showSource={showSource}
          onOpenLayer={() => setChartLayer('traffic')}
        />

        {hasCost(focusedNode.meta) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <CostSection meta={focusedNode.meta} />
          </div>
        )}
      </div>
      {chartLayer === 'resource' && (
        <ChartLayer
          title="资源趋势"
          subtitle="实时窗口"
          onClose={() => setChartLayer(null)}
        >
          <ResourceTrendGrid history={history} large />
        </ChartLayer>
      )}
      {chartLayer === 'tcp' && (
        <ChartLayer
          title={`TCP · ${WINDOW_LABELS[tcpWindow]}`}
          subtitle="可切换时间尺度查看完整探测序列"
          onClose={() => setChartLayer(null)}
        >
          <LatencyBlock
            title="TCP"
            rows={tcpData}
            type="tcp_ping"
            loading={tcpLoading}
            window={tcpWindow}
            windows={LATENCY_WINDOWS}
            onWindowChange={setTcpWindow}
            large
          />
        </ChartLayer>
      )}
      {chartLayer === 'traffic' && (
        <ChartLayer
          title={`流量 · ${WINDOW_LABELS[trafficWindow]}`}
          subtitle="趋势、周期流量与网络状态集中查看"
          onClose={() => setChartLayer(null)}
        >
          <TrafficSection
            node={focusedNode}
            today={todayTraffic}
            month={monthTraffic}
            loading={trafficLoading || trafficHistoryLoading}
            data={trafficHistory}
            window={trafficWindow}
            windows={LATENCY_WINDOWS}
            onWindowChange={setTrafficWindow}
            showSource={showSource}
            large
          />
        </ChartLayer>
      )}
    </div>
  )
}

function Section({
  title,
  actions,
  children,
}: {
  title: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
        {actions}
      </div>
      {children}
    </Card>
  )
}

function ChartOpenButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="h-7 w-7 rounded-md"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Expand className="h-3.5 w-3.5" />
    </Button>
  )
}

function ChartLayer({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-md animate-in fade-in duration-150">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative mx-auto flex h-full max-w-7xl flex-col px-3 py-4 sm:px-6 sm:py-6">
        <Card className="mb-3 shrink-0 border-primary/25 bg-card/95 p-4 shadow-2xl">
          <div className="flex items-center gap-3">
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold sm:text-xl">{title}</div>
              {subtitle && <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>}
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="ml-auto h-9 w-9 rounded-md"
              aria-label="关闭放大图表"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </Card>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-primary/20 bg-background/95 p-3 shadow-2xl sm:p-4">
          {children}
        </div>
      </div>
    </div>,
    document.body,
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

function KV({ k, v }: { k: string; v: ReactNode }) {
  if (v == null || v === '') return null
  return (
    <div className="flex justify-between gap-3 text-sm py-1">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono text-right truncate">{v}</span>
    </div>
  )
}

function Ring({ label, value, sub }: { label: string; value?: number; sub?: string }) {
  const r = 40
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(100, value ?? 0))
  const hasValue = Number.isFinite(value)

  return (
    <div className="flex flex-col items-center gap-2 min-w-0">
      <div className="relative w-24 h-24 sm:w-28 sm:h-28">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle
            cx="50" cy="50" r={r}
            fill="none" strokeWidth={8}
            className="stroke-secondary"
          />
          {hasValue && (
            <circle
              cx="50" cy="50" r={r}
              fill="none" strokeWidth={8}
              className={strokeColor(value)}
              strokeDasharray={c}
              strokeDashoffset={c - (c * v) / 100}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 400ms ease' }}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-base sm:text-lg font-semibold">
          {pct(value)}
        </div>
      </div>
      <div className="text-sm font-medium">{label}</div>
      {sub && (
        <div className="text-xs font-mono text-muted-foreground truncate max-w-full" title={sub}>
          {sub}
        </div>
      )}
    </div>
  )
}

interface SparkProps {
  data: HistorySample[]
  dataKey: keyof HistorySample
  label: string
  stroke: string
  domain?: [number, number]
  format: (v: number) => string
  large?: boolean
}

function ResourceTrendGrid({ history, large }: { history: HistorySample[]; large?: boolean }) {
  return (
    <div className={cn('grid grid-cols-1 gap-3', large ? 'lg:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-4')}>
      <Spark
        data={history}
        dataKey="cpu"
        label="CPU %"
        stroke="#3b82f6"
        domain={[0, 100]}
        format={pct}
        large={large}
      />
      <Spark
        data={history}
        dataKey="mem"
        label="内存 %"
        stroke="#10b981"
        domain={[0, 100]}
        format={pct}
        large={large}
      />
      <Spark
        data={history}
        dataKey="netIn"
        label="下行"
        stroke="#8b5cf6"
        format={v => `${bytes(v)}/s`}
        large={large}
      />
      <Spark
        data={history}
        dataKey="netOut"
        label="上行"
        stroke="#f59e0b"
        format={v => `${bytes(v)}/s`}
        large={large}
      />
    </div>
  )
}

function Spark({ data, dataKey, label, stroke, domain, format, large }: SparkProps) {
  const last = Number(data.at(-1)?.[dataKey] ?? 0)
  const id = `g-${dataKey}`
  return (
    <div className="rounded-md border bg-card/50 p-3">
      <div className="flex justify-between text-[11px] mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{format(last)}</span>
      </div>
      <div className={large ? 'h-72' : 'h-20'}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="t" hide />
            <YAxis hide domain={domain ?? ['auto', 'auto']} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={t => new Date(t).toLocaleTimeString()}
              formatter={(v: number) => [format(v), label]}
            />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={stroke}
              strokeWidth={1.5}
              fill={`url(#${id})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

interface LatencyBlockProps {
  title: string
  rows: TaskQueryResult[]
  type: LatencyType
  loading: boolean
  window: TimeWindowKey
  windows: { key: TimeWindowKey; label: string }[]
  onWindowChange: (window: TimeWindowKey) => void
  onOpenLayer?: () => void
  large?: boolean
}

const ms = (v: number) => `${v.toFixed(1)} ms`

function chartTick(ts: number, window: TimeWindowKey) {
  const d = new Date(Number(ts))
  if (window === '1h' || window === '6h' || window === '12h') {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  if (window === '24h') {
    return d.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit' })
  }
  return d.toLocaleDateString([], { month: '2-digit', day: '2-digit' })
}

function chartLabel(ts: number) {
  return new Date(Number(ts)).toLocaleString()
}

function tickCount(window: TimeWindowKey) {
  if (window === '1h') return 5
  if (window === '6h' || window === '12h') return 6
  return 7
}

function chartDomain<T extends { t: number }>(data: T[], window: TimeWindowKey, padMs = 0): [number, number] {
  const end = data.length ? Math.max(...data.map(point => Number(point.t))) : Date.now()
  return [end - DETAIL_WINDOW_MS[window] - padMs, end + padMs]
}

function dataExtentDomain<T extends { t: number }>(data: T[], window: TimeWindowKey, padMs = 0): [number, number] {
  if (!data.length) return chartDomain(data, window, padMs)
  const times = data.map(point => Number(point.t)).filter(Number.isFinite)
  if (!times.length) return chartDomain(data, window, padMs)

  const min = Math.min(...times)
  const max = Math.max(...times)
  const span = Math.max(1, max - min)
  const pad = Math.max(padMs, span * 0.03)

  if (span <= 1) {
    const fallback = Math.max(pad, Math.min(6 * 60 * 60 * 1000, DETAIL_WINDOW_MS[window] * 0.04))
    return [min - fallback, max + fallback]
  }

  return [min - pad, max + pad]
}

function latencyDomainPad(window: TimeWindowKey, large?: boolean) {
  return Math.min(bucketMs(window, large) / 2, DETAIL_WINDOW_MS[window] * 0.02, 3 * 60 * 60 * 1000)
}

function bucketMs(window: TimeWindowKey, large?: boolean) {
  if (window === '1h') return large ? 2 * 60 * 1000 : 5 * 60 * 1000
  if (window === '6h') return large ? 10 * 60 * 1000 : 20 * 60 * 1000
  if (window === '12h') return large ? 20 * 60 * 1000 : 40 * 60 * 1000
  if (window === '24h') return large ? 15 * 60 * 1000 : 30 * 60 * 1000
  return large ? 30 * 60 * 1000 : 60 * 60 * 1000
}

function normalizeTaskTs(ts: number) {
  return ts < 1_000_000_000_000 ? ts * 1000 : ts
}

function taskLatency(row: TaskQueryResult, type: LatencyType) {
  const value = row.task_event_result?.[type]
  return row.success && typeof value === 'number' ? value : null
}

function percentile(values: number[], p: number) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

interface LatencyBucket {
  t: number
  avg: number | null
  p95: number | null
  lossRate: number
  samples: number
}

interface LatencySourceSeries {
  name: string
  color: string
}

interface LatencySourcePoint {
  t: number
  [source: string]: number | null
}

function buildLatencyBuckets(rows: TaskQueryResult[], type: LatencyType, window: TimeWindowKey, large?: boolean) {
  const size = bucketMs(window, large)
  const buckets = new Map<number, { values: number[]; total: number }>()

  for (const row of rows) {
    const t = Math.floor(normalizeTaskTs(row.timestamp) / size) * size
    const bucket = buckets.get(t) ?? { values: [], total: 0 }
    bucket.total += 1
    const value = taskLatency(row, type)
    if (value != null) bucket.values.push(value)
    buckets.set(t, bucket)
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map<LatencyBucket>(([t, bucket]) => {
      const avg = bucket.values.length
        ? bucket.values.reduce((sum, value) => sum + value, 0) / bucket.values.length
        : null
      return {
        t,
        avg,
        p95: percentile(bucket.values, 95),
        lossRate: bucket.total ? ((bucket.total - bucket.values.length) / bucket.total) * 100 : 0,
        samples: bucket.total,
      }
    })
}

function buildLatencySourceBuckets(
  rows: TaskQueryResult[],
  type: LatencyType,
  stats: LatencyStats[],
  window: TimeWindowKey,
  large?: boolean,
) {
  const size = bucketMs(window, large)
  const names = stats.map(stat => stat.name)
  const grouped = new Map<number, Map<string, number[]>>()

  for (const row of rows) {
    const source = row.cron_source || '未知'
    const value = taskLatency(row, type)
    if (value == null) continue
    const t = Math.floor(normalizeTaskTs(row.timestamp) / size) * size
    const bucket = grouped.get(t) ?? new Map<string, number[]>()
    const values = bucket.get(source) ?? []
    values.push(value)
    bucket.set(source, values)
    grouped.set(t, bucket)
  }

  const data = [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map<LatencySourcePoint>(([t, bucket]) => {
      const point: LatencySourcePoint = { t }
      for (const name of names) {
        const values = bucket.get(name) ?? []
        point[name] = values.length
          ? values.reduce((sum, value) => sum + value, 0) / values.length
          : null
      }
      return point
    })

  return {
    data,
    series: stats.map<LatencySourceSeries>(stat => ({ name: stat.name, color: stat.color })),
  }
}

function LatencyBlock({
  title,
  rows,
  type,
  loading,
  window,
  windows,
  onWindowChange,
  onOpenLayer,
  large,
}: LatencyBlockProps) {
  const stats = useMemo(() => computeLatencyStats(rows, type), [rows, type])
  const chartData = useMemo(() => buildLatencyBuckets(rows, type, window, large), [rows, type, window, large])
  const sourceChart = useMemo(
    () => buildLatencySourceBuckets(rows, type, stats, window, large),
    [rows, type, stats, window, large],
  )
  const xDomain = useMemo(
    () => dataExtentDomain(sourceChart.data, window, latencyDomainPad(window, large)),
    [sourceChart.data, window, large],
  )
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const empty = sourceChart.data.length === 0
  const overallAvg = useMemo(() => percentile(chartData.flatMap(d => (d.avg != null ? [d.avg] : [])), 50), [chartData])
  const overallP95 = useMemo(() => percentile(chartData.flatMap(d => (d.p95 != null ? [d.p95] : [])), 95), [chartData])
  const overallLoss = chartData.length
    ? chartData.reduce((sum, point) => sum + point.lossRate, 0) / chartData.length
    : 0
  const visibleSeries = sourceChart.series.filter(series => !hidden.has(series.name))

  const toggle = (name: string) =>
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  return (
    <Section
      title={`${title} · ${WINDOW_LABELS[window]}`}
      actions={
        <div className="flex items-center gap-1.5">
          <Segmented items={windows} value={window} onChange={onWindowChange} />
          {onOpenLayer && <ChartOpenButton label={`放大${title}图表`} onClick={onOpenLayer} />}
        </div>
      }
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{rows.length ? `${rows.length} 条探测记录 · ${sourceChart.series.length} 个测试点` : '等待探测记录'}</span>
        <span>{window === '30d' ? '按 5 分钟采样、按小时聚合各测试点曲线' : '按分钟级时间桶平滑各测试点曲线'}</span>
      </div>
      <div className="mb-3 grid grid-cols-3 gap-2">
        <MetricChip label="中位延迟" value={overallAvg != null ? ms(overallAvg) : '—'} />
        <MetricChip label="P95 延迟" value={overallP95 != null ? ms(overallP95) : '—'} />
        <MetricChip label="平均丢包" value={`${overallLoss.toFixed(1)}%`} danger={overallLoss >= 5} />
      </div>
      <div className={cn('relative', large ? 'h-[58vh] min-h-96' : 'h-60')}>
        {empty && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            {loading ? '加载中…' : `暂无 ${type} 数据`}
          </div>
        )}
        {!empty && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sourceChart.data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.25} vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                domain={xDomain}
                scale="time"
                tickFormatter={t => chartTick(Number(t), window)}
                tick={{ fontSize: 11 }}
                tickCount={tickCount(window)}
                minTickGap={36}
                stroke="hsl(var(--muted-foreground))"
              />
              <YAxis
                tickFormatter={v => `${v}ms`}
                tick={{ fontSize: 11 }}
                stroke="hsl(var(--muted-foreground))"
                width={54}
                domain={[0, 'auto']}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelFormatter={t => chartLabel(Number(t))}
                formatter={(v: number, name: string) => [ms(Number(v)), name]}
              />
              {visibleSeries.map(series => (
                <Line
                  key={series.name}
                  type="monotone"
                  dataKey={series.name}
                  stroke={series.color}
                  strokeWidth={large ? 2.1 : 1.7}
                  strokeOpacity={large ? 0.95 : 0.86}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
        {!empty && loading && (
          <div className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
        )}
      </div>

      {stats.length > 0 && (
        <div className="mt-3 border-t pt-3">
          <div className="flex items-center px-2 pb-1 text-[11px] text-muted-foreground">
            <span className="flex-1">来源</span>
            <span className="w-20 text-right">平均延迟</span>
            <span className="w-16 text-right">抖动</span>
            <span className="w-14 text-right">丢包率</span>
          </div>
          <div className="space-y-0.5">
            {stats.map(s => (
              <LatencyStatsRow
                key={s.name}
                stat={s}
                hidden={hidden.has(s.name)}
                onToggle={() => toggle(s.name)}
              />
            ))}
          </div>
        </div>
      )}
    </Section>
  )
}

function MetricChip({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-md border bg-card/50 px-3 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={cn('mt-1 font-mono text-sm font-semibold tabular-nums', danger && 'text-red-400')}>
        {value}
      </div>
    </div>
  )
}

function TrafficSection({
  node,
  today,
  month,
  loading,
  data,
  window,
  windows,
  onWindowChange,
  showSource,
  onOpenLayer,
  large,
}: {
  node: Node
  today?: TrafficRow
  month?: TrafficRow
  loading: boolean
  data: TrafficHistoryPoint[]
  window: TimeWindowKey
  windows: { key: TimeWindowKey; label: string }[]
  onWindowChange: (window: TimeWindowKey) => void
  showSource?: boolean
  onOpenLayer?: () => void
  large?: boolean
}) {
  const d = node.dynamic
  const barData = useMemo(() => buildTrafficBuckets(data, window, large), [data, window, large])
  const xDomain = useMemo(
    () => dataExtentDomain(barData, window, bucketMs(window, large) / 2),
    [barData, window, large],
  )
  const empty = barData.length === 0

  return (
    <Section
      title={`流量 · ${WINDOW_LABELS[window]}`}
      actions={
        <div className="flex items-center gap-1.5">
          <Segmented items={windows} value={window} onChange={onWindowChange} />
          {onOpenLayer && <ChartOpenButton label="放大流量图表" onClick={onOpenLayer} />}
        </div>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <TrafficTile
          label="实时下行"
          value={d?.receive_speed != null ? `${bytes(d.receive_speed)}/s` : '—'}
          sub="当前接收速率"
        />
        <TrafficTile
          label="实时上行"
          value={d?.transmit_speed != null ? `${bytes(d.transmit_speed)}/s` : '—'}
          sub="当前发送速率"
        />
        <TrafficTile
          label="当日流量"
          value={today ? bytes(today.value) : loading ? '加载中…' : '—'}
          sub={today ? `接收 ${bytes(today.received)} · 发送 ${bytes(today.transmitted)}` : '按周期增量累加'}
        />
        <TrafficTile
          label="当月流量"
          value={month ? bytes(month.value) : loading ? '加载中…' : '—'}
          sub={month ? `接收 ${bytes(month.received)} · 发送 ${bytes(month.transmitted)}` : '按周期增量累加'}
        />
      </div>

      <div className={cn('relative mt-4 rounded-md border bg-card/40 p-3', large ? 'h-[58vh] min-h-96' : 'h-64')}>
        {empty && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            {loading ? '加载流量趋势…' : '暂无流量趋势数据'}
          </div>
        )}
        {!empty && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData} margin={{ top: 8, right: 18, left: 0, bottom: 12 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.25} vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                domain={xDomain}
                scale="time"
                tickFormatter={t => chartTick(Number(t), window)}
                tick={{ fontSize: 11 }}
                tickCount={tickCount(window)}
                minTickGap={36}
                interval="preserveStartEnd"
                tickMargin={8}
                padding={{ left: 8, right: 8 }}
                stroke="hsl(var(--muted-foreground))"
              />
              <YAxis
                tickFormatter={v => bytes(Number(v))}
                tick={{ fontSize: 11 }}
                stroke="hsl(var(--muted-foreground))"
                width={64}
                domain={[0, 'auto']}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelFormatter={t => chartLabel(Number(t))}
                formatter={(v: number, name: string) => [
                  bytes(Number(v)),
                  name === 'received' ? '接收流量' : '发送流量',
                ]}
              />
              <Bar
                dataKey="received"
                stackId="traffic"
                fill="#22c55e"
                fillOpacity={0.72}
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
              />
              <Bar
                dataKey="transmitted"
                stackId="traffic"
                fill="#38bdf8"
                fillOpacity={0.72}
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
        {!empty && loading && (
          <div className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
        )}
      </div>

      {!empty && (
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-emerald-500" />
            接收流量
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-sky-400" />
            发送流量
          </span>
          <span>按时间桶聚合，柱高表示该时段真实消耗量</span>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-x-8 border-t pt-3">
        {showSource && <KV k="主控" v={node.source} />}
        <KV k="国家/地区" v={node.meta?.region || null} />
        <KV
          k="TCP / UDP"
          v={
            d?.tcp_connections != null || d?.udp_connections != null
              ? `${d?.tcp_connections ?? '—'} / ${d?.udp_connections ?? '—'}`
              : null
          }
        />
        <KV k="进程数" v={d?.process_count} />
        <KV k="运行时长" v={uptime(d?.uptime)} />
        <KV k="数据更新" v={relativeAge(d?.timestamp)} />
        <KV k="累计接收" v={d?.total_received != null ? bytes(d.total_received) : null} />
        <KV k="累计发送" v={d?.total_transmitted != null ? bytes(d.total_transmitted) : null} />
      </div>
    </Section>
  )
}

function TrafficTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-md border bg-card/50 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-2 font-mono text-lg font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground truncate" title={sub}>
        {sub}
      </div>
    </div>
  )
}

function LatencyStatsRow({
  stat,
  hidden,
  onToggle,
}: {
  stat: LatencyStats
  hidden: boolean
  onToggle: () => void
}) {
  const { name, color, avg, jitter, lossRate } = stat

  return (
    <div
      onClick={onToggle}
      className={cn(
        'flex items-center px-2 py-1 rounded-md text-xs cursor-pointer select-none transition-opacity hover:bg-muted/60',
        hidden && 'opacity-35',
      )}
    >
      <span className="flex items-center gap-2 flex-1 min-w-0">
        <span
          className="inline-block w-4 h-0.5 rounded-full shrink-0"
          style={{ background: color }}
        />
        <span className="truncate">{name}</span>
      </span>
      <span className="w-20 text-right tabular-nums font-mono">
        {avg != null ? ms(avg) : '—'}
      </span>
      <span className="w-16 text-right tabular-nums font-mono">
        {jitter != null ? ms(jitter) : '—'}
      </span>
      <span
        className={cn(
          'w-14 text-right tabular-nums font-mono',
          lossRate >= 5 && 'text-red-500 font-medium',
        )}
      >
        {lossRate.toFixed(1)}%
      </span>
    </div>
  )
}

interface TrafficBucket {
  t: number
  received: number
  transmitted: number
  avgIn: number
  avgOut: number
  samples: number
}

function buildTrafficBuckets(data: TrafficHistoryPoint[], window: TimeWindowKey, large?: boolean): TrafficBucket[] {
  const sorted = data.slice().sort((a, b) => a.t - b.t)
  const size = bucketMs(window, large)
  const fallbackIntervalMs = sorted.length > 1
    ? Math.max(1, (sorted[sorted.length - 1].t - sorted[0].t) / (sorted.length - 1))
    : DETAIL_WINDOW_MS[window] / Math.max(1, sorted.length || 1)
  const buckets = new Map<
    number,
    { received: number; transmitted: number; inSum: number; outSum: number; samples: number }
  >()

  for (let index = 0; index < sorted.length; index++) {
    const point = sorted[index]
    const prev = sorted[index - 1]
    const next = sorted[index + 1]
    const t = Math.floor(point.t / size) * size
    const bucket = buckets.get(t) ?? { received: 0, transmitted: 0, inSum: 0, outSum: 0, samples: 0 }
    const intervalMs = prev
      ? point.t - prev.t
      : next
        ? next.t - point.t
        : fallbackIntervalMs
    const dt = Math.max(0, intervalMs / 1000)
    const receivedDelta = trafficDelta(point.totalReceived, prev?.totalReceived, point.netIn, dt)
    const transmittedDelta = trafficDelta(point.totalTransmitted, prev?.totalTransmitted, point.netOut, dt)

    bucket.received += receivedDelta
    bucket.transmitted += transmittedDelta
    bucket.inSum += point.netIn || (dt ? receivedDelta / dt : 0)
    bucket.outSum += point.netOut || (dt ? transmittedDelta / dt : 0)
    bucket.samples += 1
    buckets.set(t, bucket)
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, bucket]) => ({
      t,
      received: bucket.received,
      transmitted: bucket.transmitted,
      avgIn: bucket.samples ? bucket.inSum / bucket.samples : 0,
      avgOut: bucket.samples ? bucket.outSum / bucket.samples : 0,
      samples: bucket.samples,
    }))
}

function trafficDelta(
  current: number | undefined,
  previous: number | undefined,
  speed: number,
  dt: number,
) {
  if (current != null && previous != null) {
    const delta = current - previous
    if (delta >= 0 && Number.isFinite(delta)) return delta
  }
  return Math.max(0, speed || 0) * dt
}

function CostSection({ meta }: { meta: NodeMeta }) {
  const days = remainingDays(meta.expireTime)
  const value = remainingValue(meta)
  const progress = cycleProgress(meta)
  const unit = meta.priceUnit || '$'

  let daysLabel: string
  let daysClass = ''
  if (days == null) daysLabel = '未设置'
  else if (days < 0) {
    daysLabel = `已过期 ${Math.abs(days)} 天`
    daysClass = 'text-red-500'
  } else if (days <= 7) {
    daysLabel = `${days} 天`
    daysClass = 'text-red-500'
  } else if (days <= 30) {
    daysLabel = `${days} 天`
    daysClass = 'text-orange-500'
  } else {
    daysLabel = `${days} 天`
  }

  const barColor =
    days == null || days < 0
      ? 'bg-muted-foreground/40'
      : days <= 7
        ? 'bg-red-500'
        : days <= 30
          ? 'bg-orange-500'
          : 'bg-emerald-500'

  return (
    <Section title="费用">
      <KV k="月费" v={meta.price > 0 ? `${unit}${meta.price} / ${meta.priceCycle} 天` : null} />
      <KV k="到期" v={meta.expireTime || null} />
      <KV k="剩余" v={<span className={daysClass}>{daysLabel}</span>} />
      <KV k="剩余价值" v={meta.price > 0 ? `${unit}${value.toFixed(2)}` : null} />

      {meta.expireTime && days != null && (
        <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', barColor)}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </Section>
  )
}
