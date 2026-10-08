import { RefreshCw } from 'lucide-react'
import { Button, Card, CardHeader, TonePill, cx, useChartColors } from '../../../../shared/ui'
import { formatDate, formatDateTime } from '../../../../shared/utils/dateFormat'
import { useCheckPrices, useShopPricePoints } from '../../hooks/useShopPrices'
import { currencyOf } from '../../shopModel'
import { money } from '../shopFormat'
import type { ShopItem, ShopPricePoint, ShopPriceWatch } from '../../types'

/**
 * What the row's link costs now: Prisjakt's lowest (and how many shops) or the
 * shop's own price, with its source and date, the trend, the history, and
 * what it means here — at your target, or cheaper than you paid while it can
 * still be returned. A blocked check says so and keeps the last price read.
 */
export function RecordPriceWatch({ item, watch, owned, today }: { item: ShopItem; watch: ShopPriceWatch | null; owned: boolean; today: string }) {
  const check = useCheckPrices()
  const current = watch && watch.url === item.url ? watch : null
  const { data: points = [] } = useShopPricePoints(item.url ? item.id : null)
  if (!item.url) return null
  const cur = (current?.currency ?? currencyOf(item)).toUpperCase()
  const failed = current && current.status !== 'ok'
  const low = current?.low ?? null
  const source = current?.source === 'prisjakt' ? 'Prisjakt' : hostOf(item.url)
  const target = item.target_price
  const sameCurrency = cur === currencyOf(item)
  const cheaper = owned && low != null && sameCurrency && item.price != null && low < item.price && item.return_by && item.return_by >= today

  return (
    <Card>
      <CardHeader title="Price now" variant="label" className="mb-2"
        action={<Button size="sm" variant="ghost" icon={<RefreshCw />} loading={check.isPending} onClick={() => check.mutate([item.id])}>Check now</Button>} />
      {!current ? (
        <p className="text-body text-fg-muted">Not checked yet — the morning check reads it, or tap Check now.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {low != null && (
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-lead font-semibold tabular-nums text-fg">{money(low, cur)}</span>
              <span className="text-meta text-fg-muted">
                {current.source === 'prisjakt'
                  ? <>lowest at {source}{current.offers ? ` · ${current.offers} shops` : ''}{current.high && current.high > low ? ` · up to ${money(current.high, cur)}` : ''}</>
                  : <>at {source}{current.was && current.was > low ? <> · <s>{money(current.was, cur)}</s> before</> : null}</>}
              </span>
            </p>
          )}
          {current.prev_low != null && low != null && current.prev_low !== low && (
            <TonePill tone={low < current.prev_low ? 'success' : 'warn'} className="w-fit tabular-nums">
              {low < current.prev_low ? '↓' : '↑'} {money(Math.abs(low - current.prev_low), cur)} since {formatDate(current.prev_at)}
            </TonePill>
          )}
          {!owned && target != null && low != null && sameCurrency && (
            <TonePill tone={low <= target ? 'success' : 'neutral'} className="w-fit tabular-nums">
              {low <= target ? 'At or below your target' : `${money(low - target, cur)} above your target`}
            </TonePill>
          )}
          {cheaper && (
            <p className="text-meta text-success">
              Now {money((item.price as number) - (low as number), cur)} less than you paid — return or ask for the difference until {formatDate(item.return_by)}.
            </p>
          )}
          {current.in_stock === false && <p className="text-meta text-warn">Out of stock there.</p>}
          {failed && (
            <p className="text-meta text-warn">
              Couldn't check {formatDate(current.checked_at)}: {current.error ?? 'no price on the page'}.
              {low != null && current.last_ok_at && <> The price above is from {formatDate(current.last_ok_at)}.</>}
            </p>
          )}
          <Sparkline points={points} currency={cur} />
          <p className="text-micro text-fg-faint">
            {current.last_ok_at ? `Read ${formatDateTime(current.last_ok_at)}` : `Checked ${formatDateTime(current.checked_at)}`}
            {' · '}{current.source === 'prisjakt' ? 'from Prisjakt\'s public page, best effort' : 'from the shop\'s page'}
          </p>
        </div>
      )}
    </Card>
  )
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return 'the shop' }
}

/** The lowest price over the checks, with its lowest and highest marked. */
function Sparkline({ points, currency }: { points: ShopPricePoint[]; currency: string }) {
  const colors = useChartColors()
  const rows = points.filter(p => (p.currency ?? currency).toUpperCase() === currency)
  if (rows.length < 2) return null
  const lows = rows.map(p => p.low)
  const min = Math.min(...lows), max = Math.max(...lows)
  const span = max - min || 1
  const W = 300, H = 56
  const xy = rows.map((p, i) => [(i / (rows.length - 1)) * W, H - 6 - ((p.low - min) / span) * (H - 12)])
  return (
    <div className="max-w-md">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-14 w-full" role="img"
        aria-label={`Price history: from ${money(lows[0], currency)} to ${money(lows[lows.length - 1], currency)}, lowest ${money(min, currency)}`}>
        <polyline points={xy.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke={colors.series[0]} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r={3} fill={colors.series[0]} />
      </svg>
      <p className={cx('flex justify-between text-micro tabular-nums text-fg-faint')}>
        <span>{formatDate(rows[0].checked_at)}</span>
        <span>lowest {money(min, currency)} · highest {money(max, currency)}</span>
      </p>
    </div>
  )
}
