import {
  Activity,
  ArrowDown,
  ArrowUp,
  Coins,
  Eye,
  EyeOff,
  HardDrive,
  MemoryStick,
  RadioTower,
} from 'lucide-react'
import { Card } from './ui/card'
import { Progress } from './ui/progress'
import { StatusDot } from './StatusDot'
import { bytes, pct, relativeAge } from '../utils/format'
import { deriveUsage } from '../utils/derive'
import { remainingValue } from '../utils/cost'
import { cn, loadColor } from '../utils/cn'
import { backendRegionCode } from '../utils/region'
import type { Node } from '../types'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import type { VisitorInfo } from '../hooks/useVisitorInfo'

interface Props {
  nodes: Node[]
  backendCount: number
  errorCount: number
  mapSlot?: ReactNode
  visitor?: VisitorInfo | null
}

export function DashboardOverview({ nodes, backendCount, errorCount, mapSlot, visitor }: Props) {
  const total = nodes.length
  const online = nodes.filter(n => n.online).length
  const offline = Math.max(0, total - online)
  const onlineRate = total ? (online / total) * 100 : 0
  const usageRows = nodes.map(n => ({ node: n, usage: deriveUsage(n) }))
  const memTotal = sum(usageRows.map(r => r.usage.memTotal))
  const memUsed = sum(usageRows.map(r => r.usage.memUsed))
  const diskTotal = sum(usageRows.map(r => r.usage.diskTotal))
  const diskUsed = sum(usageRows.map(r => r.usage.diskUsed))
  const remaining = nodes.reduce((acc, node) => acc + remainingValue(node.meta), 0)
  const netIn = sum(usageRows.map(r => r.usage.netIn))
  const netOut = sum(usageRows.map(r => r.usage.netOut))
  const latestTs = Math.max(0, ...usageRows.map(r => r.usage.ts ?? 0))
  const regions = useMemo(() => buildRegions(nodes), [nodes])
  const regionsSig = regions.map(r => `${r.code}:${r.count}`).join('|')
  const [lastRegions, setLastRegions] = useState(regions)
  useEffect(() => {
    if (regions.length) setLastRegions(current => {
      const currentSig = current.map(r => `${r.code}:${r.count}`).join('|')
      return currentSig === regionsSig ? current : regions
    })
  }, [regions, regionsSig])
  const displayRegions = regions.length ? regions : lastRegions

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4">
        <Card className="p-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                <h1 className="mt-1 text-xl sm:text-2xl font-semibold tracking-normal">
                  服务器状态总览
                </h1>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <MiniStat label="节点" value={String(total)} />
                <MiniStat label="主控" value={String(backendCount)} />
                <MiniStat label="异常" value={String(errorCount)} tone={errorCount ? 'bad' : 'ok'} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <AssetTile
                icon={MemoryStick}
                label="总内存"
                value={bytes(memTotal)}
                hint={`已用 ${bytes(memUsed)}`}
                progress={memTotal ? (memUsed / memTotal) * 100 : undefined}
              />
              <AssetTile
                icon={HardDrive}
                label="总硬盘"
                value={bytes(diskTotal)}
                hint={`已用 ${bytes(diskUsed)}`}
                progress={diskTotal ? (diskUsed / diskTotal) * 100 : undefined}
              />
              <AssetTile
                icon={Coins}
                label="剩余价值"
                value={remaining > 0 ? `$${remaining.toFixed(2)}` : '未设置'}
                hint="按价格与到期日估算"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <SignalTile
                icon={RadioTower}
                label="在线率"
                value={`${online}/${total || 0}`}
                hint={pct(onlineRate)}
                progress={onlineRate}
              />
              <SignalTile
                icon={ArrowDown}
                label="实时下行"
                value={`${bytes(netIn)}/s`}
                hint="所有在线节点合计"
              />
              <SignalTile
                icon={ArrowUp}
                label="实时上行"
                value={`${bytes(netOut)}/s`}
                hint="所有在线节点合计"
              />
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden bg-white text-slate-950 shadow-[0_18px_48px_rgba(15,23,42,0.14)] dark:bg-slate-950 dark:text-slate-50 dark:shadow-none">
          <div className="relative min-h-[360px]">
            <div className="absolute inset-0 bg-slate-100 dark:bg-[hsl(220_15%_8%)]">
              {mapSlot}
              <div className="absolute inset-0 bg-gradient-to-t from-white via-white/58 to-white/18 dark:from-background dark:via-background/40 dark:to-background/10" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_78%_18%,rgba(59,130,246,0.12),transparent_34%),radial-gradient(circle_at_20%_22%,rgba(16,185,129,0.10),transparent_32%)] dark:hidden" />
            </div>
            <div className="relative z-[1] flex h-full min-h-[360px] flex-col p-3">
              <div className="min-h-[210px] flex flex-col justify-between">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-300/80">
                      健康状态
                    </div>
                    <div className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/88 px-2 py-1 text-xs font-medium text-slate-900 shadow-sm backdrop-blur-sm dark:border-white/30 dark:bg-white/85">
                      <StatusDot online={offline === 0 && total > 0} className="h-1.5 w-1.5" />
                      {total === 0 ? '等待节点' : offline === 0 ? '在线' : `${offline} 离线`}
                    </div>
                  </div>
                  <div className="h-9 w-9 rounded-md bg-blue-500/12 text-blue-600 shadow-sm flex items-center justify-center dark:bg-blue-500/15 dark:text-blue-400">
                    <Activity className="h-5 w-5" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <InfoBlock label="最新上报" value={latestTs ? relativeAge(latestTs) : '从未'} />
                  <InfoBlock label="覆盖地区" value={`${displayRegions.length} 个`} />
                </div>
              </div>
              <div className="mt-auto pt-3">
                <VisitorBlock visitor={visitor} />
              </div>
            </div>
          </div>
        </Card>
      </div>

    </section>
  )
}

function VisitorBlock({ visitor }: { visitor?: VisitorInfo | null }) {
  const [showIp, setShowIp] = useState(false)
  const unavailable = visitor?.status === 'error'
  const location = locationParts(visitor?.city, visitor?.region, visitor?.country).join(', ')
  const ips = visitor?.ips?.length ? visitor.ips : visitor?.ip ? [visitor.ip] : []
  const ipTitle = ips.join(' / ')
  const displayIps = showIp ? ips : ips.map(maskIp)

  return (
    <div className="rounded-md border border-slate-200/85 bg-white/86 px-3 py-2 text-xs text-slate-950 shadow-[0_10px_28px_rgba(15,23,42,0.10)] backdrop-blur dark:border-white/22 dark:bg-slate-950/72 dark:text-slate-100 dark:shadow-[0_10px_28px_rgba(15,23,42,0.22)]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5 font-medium text-foreground/90">
          来访位置
          {ips.length > 0 && (
            <button
              type="button"
              onClick={() => setShowIp(v => !v)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-900/8 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-50"
              aria-label={showIp ? '隐藏完整 IP' : '显示完整 IP'}
              title={showIp ? '隐藏完整 IP' : '显示完整 IP'}
            >
              {showIp ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
        <div className="h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.85)]" />
      </div>
      <div className="grid grid-cols-[2.9rem_minmax(0,1fr)] gap-x-2 gap-y-1">
        <span className="text-slate-500 dark:text-slate-400">IP</span>
        <span className="min-w-0 space-y-1 font-mono">
          {displayIps.length ? (
            displayIps.map((ip, index) => (
              <span key={`${ip}-${index}`} className="block break-all leading-snug text-[11px]">
                [{ip}]
              </span>
            ))
          ) : (
            <span>{unavailable ? '暂不可用' : '检测中'}</span>
          )}
        </span>
        <span className="text-slate-500 dark:text-slate-400">Location</span>
        <span className="truncate" title={location || undefined}>
          {location || (unavailable ? '暂不可用' : '定位中')}
        </span>
        <span className="text-slate-500 dark:text-slate-400">ISP</span>
        <span className="truncate" title={visitor?.org}>
          {visitor?.org || (unavailable ? '暂不可用' : '检测中')}
        </span>
      </div>
    </div>
  )
}

function locationParts(...parts: Array<string | undefined>) {
  const out: string[] = []
  for (const part of parts) {
    if (!part) continue
    const normalized = part.trim()
    if (!normalized) continue
    const last = out[out.length - 1]
    if (last && last.toLowerCase() === normalized.toLowerCase()) continue
    out.push(normalized)
  }
  return out
}

function maskIp(ip: string) {
  if (ip.includes(':')) {
    const parts = ip.split(':')
    if (parts.length <= 4) return ip
    return `${parts.slice(0, 2).join(':')}:****:${parts.slice(-2).join(':')}`
  }

  const parts = ip.split('.')
  if (parts.length === 4) return `${parts[0]}.*.*.${parts[3]}`
  return ip.replace(/(.{3}).+(.{3})/, '$1****$2')
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className="rounded-md border bg-background/60 px-3 py-2 min-w-16">
      <div
        className={cn(
          'text-lg font-semibold tabular-nums',
          tone === 'ok' && 'text-emerald-600 dark:text-emerald-400',
          tone === 'bad' && 'text-red-600 dark:text-red-400',
        )}
      >
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  )
}

function AssetTile({
  icon: Icon,
  label,
  value,
  hint,
  progress,
}: {
  icon: typeof MemoryStick
  label: string
  value: string
  hint: string
  progress?: number
}) {
  return (
    <div className="rounded-md border bg-background/55 p-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="inline-flex items-center gap-2 text-muted-foreground">
          <Icon className="h-4 w-4" />
          {label}
        </span>
        <span className="font-mono font-medium">{value}</span>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">{hint}</div>
      {progress != null && (
        <Progress value={progress} indicatorClassName={loadColor(progress)} className="mt-3 h-2" />
      )}
    </div>
  )
}

function SignalTile({
  icon: Icon,
  label,
  value,
  hint,
  progress,
}: {
  icon: typeof RadioTower
  label: string
  value: string
  hint: string
  progress?: number
}) {
  return (
    <div className="rounded-md border bg-background/55 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      {progress != null && <Progress value={progress} className="mt-3 h-1.5" />}
    </div>
  )
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200/80 bg-white/74 px-3 py-2 text-slate-950 shadow-sm backdrop-blur dark:border-white/18 dark:bg-slate-950/56 dark:text-slate-100">
      <div className="text-[11px] text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 font-mono text-sm text-slate-950 dark:text-slate-50">{value}</div>
    </div>
  )
}

function sum(values: Array<number | undefined>) {
  return values.reduce((acc, v) => acc + (Number.isFinite(v) ? Number(v) : 0), 0)
}

function buildRegions(nodes: Node[]) {
  const map = new Map<string, number>()
  for (const node of nodes) {
    const code = backendRegionCode(node)
    if (!code) continue
    map.set(code, (map.get(code) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
}
