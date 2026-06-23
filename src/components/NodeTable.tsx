import { Badge } from './ui/badge'
import { Card } from './ui/card'
import { Progress } from './ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Flag } from './Flag'
import { StatusDot } from './StatusDot'
import { bytes, pct } from '../utils/format'
import { deriveUsage, displayName, distroLogo, virtLabel } from '../utils/derive'
import { cn, loadColor } from '../utils/cn'
import { getLatency, type LatencyLookup } from '../utils/rankings'
import type { Node } from '../types'

interface Props {
  nodes: Node[]
  onOpen?: (uuid: string) => void
  latency?: LatencyLookup
}

export function NodeTable({ nodes, onOpen, latency }: Props) {
  return (
    <Card className="overflow-hidden [&_*]:duration-0 [&_td]:transition-none [&_th]:transition-none [&_tr]:transition-none [&>div]:scrollbar-thin [&>div]:scrollbar-track-transparent [&>div]:scrollbar-thumb-slate-300/80 hover:[&>div]:scrollbar-thumb-slate-400 dark:[&>div]:scrollbar-thumb-slate-700/80 dark:hover:[&>div]:scrollbar-thumb-slate-600">
      <Table className="min-w-[1080px] border-separate border-spacing-0">
        <colgroup>
          <col className="w-[240px]" />
          <col className="w-[72px]" />
          <col className="w-24" />
          <col className="w-[110px]" />
          <col className="w-[120px]" />
          <col className="w-[120px]" />
          <col className="w-[86px]" />
          <col className="w-[86px]" />
          <col className="w-[92px]" />
          <col className="w-20" />
          <col className="w-40" />
          {/* <col className="w-20" /> 更新列，后续需要时恢复 */}
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-40 border-r border-white/18 bg-transparent px-3 after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:z-40 after:w-px after:bg-white/18">
              名称
            </TableHead>
            <TableHead className="w-[72px] whitespace-nowrap px-4 text-center">地区</TableHead>
            <TableHead className="whitespace-nowrap text-center">架构</TableHead>
            <TableHead className="whitespace-nowrap">CPU</TableHead>
            <TableHead className="whitespace-nowrap">内存</TableHead>
            <TableHead className="whitespace-nowrap">磁盘</TableHead>
            <TableHead className="whitespace-nowrap">下行</TableHead>
            <TableHead className="whitespace-nowrap">上行</TableHead>
            <TableHead className="whitespace-nowrap">TCP</TableHead>
            <TableHead className="whitespace-nowrap">丢包</TableHead>
            <TableHead className="whitespace-nowrap text-right">总流量</TableHead>
            {/* <TableHead className="whitespace-nowrap">更新</TableHead> */}
          </TableRow>
        </TableHeader>
        <TableBody>
          {nodes.map(n => {
            const u = deriveUsage(n)
            const logo = distroLogo(n)
            const virt = virtLabel(n)
            const tcp = latency ? getLatency(latency, n.uuid, 'tcp_ping', '1h') : null
            const loss = tcp?.lossRate ?? 0
            return (
              <TableRow
                key={n.uuid}
                onClick={() => onOpen?.(n.uuid)}
                className={cn('group cursor-pointer', !n.online && 'opacity-60')}
              >
                <TableCell className="sticky left-0 z-40 border-r border-white/18 bg-transparent px-3 font-medium after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:z-40 after:w-px after:bg-white/18 group-hover:bg-transparent group-hover:after:bg-white/18">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <StatusDot online={n.online} />
                    {logo && (
                      <img
                        src={logo}
                        alt=""
                        className="w-4 h-4 shrink-0 object-contain"
                        loading="lazy"
                      />
                    )}
                    <span className="whitespace-normal break-words leading-snug">{displayName(n)}</span>
                  </div>
                </TableCell>
                <TableCell className="px-4 text-center">
                  {n.meta?.region ? (
                    <Flag code={n.meta.region} />
                  ) : (
                    <span className="text-muted-foreground text-sm">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {virt ? (
                    <div className="flex justify-center">
                      <Badge variant="outline" className="justify-center text-[10px] uppercase tracking-wide">
                        {virt}
                      </Badge>
                    </div>
                  ) : (
                    <div className="flex justify-center text-muted-foreground">—</div>
                  )}
                </TableCell>
                <TableCell>
                  <CellBar value={u.cpu} />
                </TableCell>
                <TableCell>
                  <CellBar
                    value={u.mem}
                    hint={u.memTotal ? `${bytes(u.memUsed)} / ${bytes(u.memTotal)}` : null}
                  />
                </TableCell>
                <TableCell>
                  <CellBar
                    value={u.disk}
                    hint={u.diskTotal ? `${bytes(u.diskUsed)} / ${bytes(u.diskTotal)}` : null}
                  />
                </TableCell>
                <TableCell className="font-mono">{bytes(u.netIn || 0)}/s</TableCell>
                <TableCell className="font-mono">{bytes(u.netOut || 0)}/s</TableCell>
                <TableCell className="font-mono">{latencyCell(tcp?.avg)}</TableCell>
                <TableCell className={cn('font-mono', loss >= 5 && 'text-red-500 font-medium')}>
                  {tcp ? pct(loss) : '—'}
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-right">
                  {inlineBytes((n.dynamic?.total_received ?? 0) + (n.dynamic?.total_transmitted ?? 0))}
                </TableCell>
                {/* <TableCell className="font-mono text-xs text-muted-foreground">
                  {relativeAge(u.ts)}
                </TableCell> */}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Card>
  )
}

function latencyCell(value?: number | null) {
  return value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)} ms`
}

function inlineBytes(value: number) {
  return bytes(value).replace(/\s+/g, '\u00a0')
}

function CellBar({ value, hint }: { value: number | undefined; hint?: string | null }) {
  return (
    <div className="flex items-center gap-2 min-w-[110px]" aria-label={hint || undefined}>
      <Progress value={value} indicatorClassName={loadColor(value)} className="flex-1 h-1.5" />
      <span className="font-mono text-xs w-12 text-right">{pct(value)}</span>
    </div>
  )
}
