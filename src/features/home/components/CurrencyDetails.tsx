import { useState } from 'react'
import { SegmentedControl, cx } from '../../../shared/ui'
import type { CurrencyData } from '../api/currencyApi'
import { CURRENCY_FLAG as FLAG } from '../api/currencyConvert'
import { formatDate } from '../../../shared/utils/dateFormat'
import { CurrencyConverter } from './CurrencyConverter'

type Mode = 'rates' | 'convert' | 'change'

export function ChangeBadge({ pct, className }: { pct: number; className?: string }) {
  const flat = Math.abs(pct) < 0.01
  const tone = flat ? 'neutral' : pct > 0 ? 'success' : 'danger'
  return (
    <span data-tone={tone} className={cx('tone-text inline-flex items-center gap-0.5 text-meta font-semibold tabular-nums', className)}>
      {!flat && <span aria-hidden>{pct > 0 ? '▲' : '▼'}</span>}
      <span>{flat ? '0.00%' : `${Math.abs(pct).toFixed(2)}%`}</span>
      <span className="sr-only">{flat ? 'unchanged' : pct > 0 ? 'up' : 'down'} since yesterday</span>
    </span>
  )
}

function Rates({ data }: { data: CurrencyData }) {
  return (
    <div className="space-y-3">
      {/* NOK ⇄ TRY directly — never routed through a third currency. */}
      <div className="rounded-row border border-line px-3.5 py-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-meta font-semibold text-fg-muted">{FLAG.NOK} NOK ⇄ {FLAG.TRY} TRY</span>
          <ChangeBadge pct={data.primary.changePct} />
        </div>
        <div className="text-kpi font-bold tabular-nums tracking-tight text-fg">1 NOK = {data.primary.rate.toFixed(3)} TRY</div>
      </div>
      {/* EUR and USD against each other (their own parity), not against NOK. */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 px-1">
        <span className="text-meta font-medium text-fg-muted">{FLAG.EUR} EUR ⇄ {FLAG.USD} USD</span>
        <span className="flex items-center gap-2">
          <span className="text-body tabular-nums text-fg">1 EUR = {data.secondary.rate.toFixed(4)} USD</span>
          <ChangeBadge pct={data.secondary.changePct} />
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 px-1">
        <span className="text-meta font-medium text-fg-muted">{FLAG.XAU} Gold</span>
        <span className="flex items-center gap-2">
          <span className="text-body tabular-nums text-fg">
            ${data.gold.usdPerOz.toLocaleString('en-GB', { maximumFractionDigits: 0 })}/oz
            <span className="text-fg-muted"> · {data.gold.nokPerGram.toFixed(1)} NOK/g</span>
          </span>
          <ChangeBadge pct={data.gold.changePct} />
        </span>
      </div>
    </div>
  )
}

function Changes({ data }: { data: CurrencyData }) {
  return (
    <div className="space-y-2.5">
      <p className="text-meta text-fg-muted">Each currency's own 24h move against USD — not against each other.</p>
      {data.changes.map(c => (
        <div key={c.code} className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-body font-medium text-fg-2"><span aria-hidden>{FLAG[c.code] ?? ''}</span>{c.code}</span>
          <ChangeBadge pct={c.change} className="text-body" />
        </div>
      ))}
    </div>
  )
}

/** Rates / converter / 24h change — the widget body and the phone popup. */
export function CurrencyDetails({ data }: { data: CurrencyData }) {
  const [mode, setMode] = useState<Mode>('rates')
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl<Mode>
          size="sm"
          value={mode}
          onChange={setMode}
          options={[{ value: 'rates', label: 'Rates' }, { value: 'convert', label: 'Convert' }, { value: 'change', label: 'Change' }]}
        />
        <span className="text-micro tabular-nums text-fg-muted">Updated {/^\d{4}-\d{2}-\d{2}$/.test(data.date) ? formatDate(data.date) : data.date}</span>
      </div>
      {mode === 'rates' && <Rates data={data} />}
      {mode === 'convert' && <CurrencyConverter rawRates={data.rawRates} size="full" />}
      {mode === 'change' && <Changes data={data} />}
    </div>
  )
}
