import { useState } from 'react'
import { Banknote } from 'lucide-react'
import { ModalShell } from '../../../shared/modals'
import { Button, Skeleton } from '../../../shared/ui'
import { useCurrencyRates } from '../hooks/useCurrencyRates'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'
import { GlanceTile } from './GlanceTile'
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

/** Phone glance tile: NOK→TRY at a glance, everything else in the sheet. */
export function CurrencyTile() {
  const [open, setOpen] = useState(false)
  const { data, isLoading, error, refetch } = useCurrencyRates()
  return (
    <>
      <GlanceTile
        label="NOK → TRY"
        icon={<Banknote />}
        loading={isLoading}
        value={data ? data.primary.rate.toFixed(3) : '—'}
        hint={data ? <ChangeBadge pct={data.primary.changePct} /> : error ? 'Unavailable' : undefined}
        onClick={() => setOpen(true)}
      />
      <ModalShell open={open} onClose={() => setOpen(false)} title="Currency" size="sm">
        {isLoading && <CurrencySkeleton />}
        {error && !data && <CurrencyError onRetry={() => refetch()} />}
        {data && <CurrencyDetails data={data} />}
      </ModalShell>
    </>
  )
}
