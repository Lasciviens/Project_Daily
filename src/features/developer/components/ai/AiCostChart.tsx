import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useChartColors } from '../../../../shared/ui'
import { TOOLTIP_BOX } from '../../../../shared/components/charts/chartKit'
import { formatDate, formatDayMonth } from '../../../../shared/utils/dateFormat'
import { formatCount, formatTokens, formatUsd, type UsageTotals } from '../../../ai/claude/ledgerRules'

// The month's cost, one bar per Oslo day (Overview). A day without calls is a zero, so the days stay in step.

type DayTotal = UsageTotals & { day: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts' TooltipProps generic is awkward to import cleanly; only the row is read.
function DayTooltip({ active, payload }: any) {
  const d: DayTotal | undefined = payload?.[0]?.payload
  if (!active || !d) return null
  return (
    <div className={TOOLTIP_BOX}>
      <p className="font-medium tabular-nums text-fg-muted">{formatDate(d.day)}</p>
      <p className="font-semibold tabular-nums text-fg">{formatUsd(d.cost_usd, { fine: true })}</p>
      <p className="tabular-nums text-fg-2">{formatCount(d.calls)} {d.calls === 1 ? 'call' : 'calls'}{d.failed > 0 ? ` · ${formatCount(d.failed)} not answered` : ''}</p>
      <p className="tabular-nums text-fg-2">{formatTokens(d.input_tokens + d.cache_read_tokens + d.cache_write_tokens)} in · {formatTokens(d.output_tokens)} out</p>
    </div>
  )
}

/** A dollar tick short enough for the axis: "$0.02", "$0.005", "$1.5". */
function axisUsd(v: number): string {
  if (!(v > 0)) return '$0'
  return `$${v >= 1 ? v.toFixed(v % 1 === 0 ? 0 : 1) : String(Number(v.toPrecision(2)))}`
}

export function AiCostChart({ days }: { days: DayTotal[] }) {
  const c = useChartColors()
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={days} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={c.grid} />
        <XAxis dataKey="day" tickFormatter={formatDayMonth} tick={{ fontSize: 9, fill: c.axis }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={14} />
        <YAxis tick={{ fontSize: 9, fill: c.axis }} axisLine={false} tickLine={false} width={44} tickFormatter={axisUsd} domain={[0, 'auto']} />
        <Tooltip cursor={false} content={DayTooltip} />
        <Bar dataKey="cost_usd" name="Cost" fill={c.series[0]} fillOpacity={0.85} radius={[3, 3, 0, 0]} maxBarSize={18} activeBar={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}
