import { RefreshCw } from 'lucide-react'
import { Button, Card, CardHeader, TonePill, useChartColors } from '../../../../shared/ui'
import { formatDate, formatDateTime } from '../../../../shared/utils/dateFormat'
import { useCheckPrices, useShopPricePoints } from '../../hooks/useShopPrices'
import { currencyOf } from '../../shopModel'
import { asTail, mixedWords, morningReads, retryWords } from '../../watchWords'
import { hostOf, money } from '../shopFormat'
import { SiteLink } from '../shopKit'
import type { ShopItem, ShopPricePoint, ShopPriceWatch } from '../../types'

/**
 * What the row's link costs now: Prisjakt's lowest (and how many shops) or the
 * shop's own price, with where it was read — a link to the product's page —
 * and when, the trend, the history, and what it means here — at your target,
 * or cheaper than you paid while it can still be returned. A blocked check
 * says so and keeps the last price read; a link on a site that doesn't let
 * apps read it (its terms, or its robots.txt) is never read, and the card
 * says so in a neutral tone — it is the site's answer, not a failure.
 */
export function RecordPriceWatch({ item, watch, owned, today }: { item: ShopItem; watch: ShopPriceWatch | null; owned: boolean; today: string }) {
  const check = useCheckPrices()
  const current = watch && watch.url === item.url ? watch : null
  const { data: points = [] } = useShopPricePoints(item.url ? item.id : null)
  if (!item.url) return null
  const cur = (current?.currency ?? currencyOf(item)).toUpperCase()
  const refused = current?.status === 'not_allowed'
  const low = current?.low ?? null
  const site = hostOf(item.url) ?? 'the shop'
  const target = item.target_price
  const sameCurrency = cur === currencyOf(item)
  const cheaper = owned && low != null && sameCurrency && item.price != null && low < item.price && item.return_by && item.return_by >= today
  const open = <SiteLink url={item.url}>Open at {site}</SiteLink>

  return (
    <Card>
      <CardHeader title="Price now" variant="label" className="mb-2"
        action={<Button size="sm" variant="ghost" icon={<RefreshCw />} loading={check.isPending} onClick={() => check.mutate([item.id])}>Check now</Button>} />
      {!current ? (
        <p className="text-body text-fg-muted">Not checked yet — {morningReads(item, today) ? 'the morning check reads it, or tap Check now' : 'tap Check now'}. {open}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {low != null ? (
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-lead font-semibold tabular-nums text-fg">{money(low, cur)}</span>
              <span className="text-meta text-fg-muted">
                {current.source === 'prisjakt'
                  ? <>lowest at <SiteLink url={item.url}>Prisjakt</SiteLink>{mixedWords(current)}{current.offers ? ` · ${current.offers} shops` : ''}{current.high && current.high > low ? ` · up to ${money(current.high, cur)}` : ''}</>
                  : <>at <SiteLink url={item.url} />{current.was && current.was > low ? <> · <s>{money(current.was, cur)}</s> before</> : null}</>}
              </span>
            </p>
          ) : !refused && <p className="text-meta">{open}</p>}
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
          <WatchAnswer item={item} watch={current} today={today} />
          <Sparkline points={points} currency={cur} />
          <p className="text-micro text-fg-muted">
            {current.last_ok_at ? `Read ${formatDateTime(current.last_ok_at)}` : `Checked ${formatDateTime(current.checked_at)}`}
            {refused && !current.last_ok_at ? null : <>{' · '}{current.source === 'prisjakt' ? 'from Prisjakt\'s public page, best effort' : `from ${site}'s own page`}</>}
          </p>
        </div>
      )}
    </Card>
  )
}

/**
 * Why the last check read no price — the line under the price (the footer's "Read …" dates a price kept from
 * before): a refusal and a page without a price are the site's answers, in a neutral tone; a bot check and a
 * failed check are failures, in the warning tone, with when the morning check tries again.
 */
function WatchAnswer({ item, watch, today }: { item: ShopItem; watch: ShopPriceWatch; today: string }) {
  if (watch.status === 'ok') return null
  if (watch.status === 'not_allowed') {
    return <p className="text-meta text-fg-muted">{watch.error ?? `${hostOf(item.url) ?? 'The site'} doesn't let apps read its pages`}, so its price isn't checked.</p>
  }
  if (watch.status === 'no_price') return <p className="text-meta text-fg-muted">{watch.error ?? 'No price on the page'}.</p>
  const retry = retryWords(item, watch, today)
  return (
    <p className="text-meta text-warn">
      Couldn't check {formatDate(watch.checked_at)}: {asTail(watch.error ?? 'The site didn\'t answer')}{retry ? ` — ${retry}` : ''}.
    </p>
  )
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
      <p className="flex flex-wrap justify-between gap-x-2 text-micro tabular-nums text-fg-muted">
        <span>{formatDate(rows[0].checked_at)}</span>
        <span>lowest {money(min, currency)} · highest {money(max, currency)}</span>
      </p>
    </div>
  )
}
