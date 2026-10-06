import { useState } from 'react'
import { Banknote } from 'lucide-react'
import { ModalShell } from '../../../shared/modals'
import { Button, Skeleton, AnimatedNumber } from '../../../shared/ui'
import { useCurrencyRates } from '../hooks/useCurrencyRates'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'
import { GlanceCarousel, type GlanceScreen } from './GlanceCarousel'
import type { CurrencyData } from '../api/currencyApi'
import { ChangeBadge, CurrencyDetails } from './CurrencyDetails'

function CurrencySkeleton() {
  return <div className="space-y-3"><Skeleton className="h-9 w-48" /><Skeleton className="h-16 w-full" /><Skeleton className="h-4 w-3/4" /></div>
}

function CurrencyError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-body text-fg-muted">
      <span>Rates unavailable.</span>
      <Button size="sm" onClick={onRetry}>Retry</Button>
    </div>
  )
}

/** Desktop side-column card. Every fetch costs two OXR calls, so collapsing it stops the query. */
export function CurrencyWidget() {
  const ws = useWidgetState('currency', { mobileCollapsed: true })
  const { data, isLoading, error, refetch, isFetching } = useCurrencyRates({ enabled: !ws.collapsed })
  return (
    <WidgetShell title="Currency" icon={<Banknote />} ws={ws} onRefresh={() => refetch()} refreshing={isFetching}>
      {isLoading && <CurrencySkeleton />}
      {error && !data && <CurrencyError onRetry={() => refetch()} />}
      {data && <CurrencyDetails data={data} />}
    </WidgetShell>
  )
}

const fmt = (n: number, d = 2) => n.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d })

/** The tile's screens: NOK → TRY · what 1,000 NOK buys · EUR/USD · gold. */
function currencyScreens(data: CurrencyData): GlanceScreen[] {
  const p = data.primary
  return [
    { key: 'nok-try', name: 'NOK → TRY', value: <AnimatedNumber value={p.rate} decimals={3} />, hint: <ChangeBadge pct={p.changePct} /> },
    { key: 'thousand', name: '1,000 NOK', value: <span className="flex items-baseline gap-1">{fmt(p.rate * 1000, 0)}<span className="text-meta font-medium text-fg-muted">TRY</span></span>, hint: `1,000 TRY = ${fmt(1000 / p.rate, 0)} NOK` },
    { key: 'eur-usd', name: 'EUR → USD', value: fmt(data.secondary.rate, 4), hint: <ChangeBadge pct={data.secondary.changePct} /> },
    { key: 'gold', name: 'Gold', value: <span className="flex items-baseline gap-1">{fmt(data.gold.nokPerGram, 0)}<span className="text-meta font-medium text-fg-muted">NOK/g</span></span>, hint: <span className="flex items-center gap-1.5"><span className="tabular-nums">${fmt(data.gold.usdPerOz, 0)}/oz</span><ChangeBadge pct={data.gold.changePct} /></span> },
  ]
}

/** Glance tile with swipeable screens; everything else in the sheet. */
export function CurrencyTile() {
  const [open, setOpen] = useState(false)
  const { data, isLoading, error, refetch } = useCurrencyRates()
  const screens = data ? currencyScreens(data) : [{ key: 'none', name: 'NOK → TRY', value: '—', hint: error ? 'Unavailable' : undefined }]
  return (
    <>
      <GlanceCarousel id="currency" label="Money" icon={<Banknote />} loading={isLoading} screens={screens} onClick={() => setOpen(true)} />
      <ModalShell open={open} onClose={() => setOpen(false)} title="Currency" size="sm">
        {isLoading && <CurrencySkeleton />}
        {error && !data && <CurrencyError onRetry={() => refetch()} />}
        {data && <CurrencyDetails data={data} />}
      </ModalShell>
    </>
  )
}
