import { useState } from 'react'
import { ArrowUpDown } from 'lucide-react'
import { SegmentedControl, cx } from '../../../shared/ui'
import type { CurrencyData } from '../api/currencyApi'
import { fmtDateEnGB } from '../../../shared/utils/enGBDate'

type Mode = 'rates' | 'convert' | 'change'

// Currency flags are content (they name the currency), not UI chrome.
const FLAG: Record<string, string> = { NOK: '🇳🇴', TRY: '🇹🇷', EUR: '🇪🇺', USD: '🇺🇸', XAU: '🥇' }
const CURRENCIES = ['NOK', 'TRY', 'EUR', 'USD']

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

function Converter({ rawRates }: { rawRates: Record<string, number> }) {
  const [amount, setAmount] = useState('1')
  const [from, setFrom] = useState('NOK')
  const [to, setTo] = useState('TRY')

  // OXR is USD-based: rawRates[X] = units of X per 1 USD, so X → Y = rawRates[Y] / rawRates[X].
  const fromRate = from === 'USD' ? 1 : (rawRates[from] ?? 1)
  const toRate = to === 'USD' ? 1 : (rawRates[to] ?? 1)
  const parsed = parseFloat(amount.replace(',', '.'))
  const result = isNaN(parsed) ? null : parsed * (toRate / fromRate)
  const formatted = result === null ? '—'
    : result >= 1000 ? result.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : result.toFixed(4).replace(/\.?0+$/, '') || '0'

  const picker = (value: string, onChange: (v: string) => void, label: string) => (
    <div className="flex shrink-0 items-center gap-1.5">
      <span aria-hidden className="text-base">{FLAG[value] ?? ''}</span>
      <select aria-label={label} value={value} onChange={e => onChange(e.target.value)} className="select w-[5.5rem]">
        {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    </div>
  )

  return (
    <div className="overflow-hidden rounded-row border border-line">
      <div className="flex items-center gap-3 px-3 py-3">
        <input
          type="text"
          inputMode="decimal"
          aria-label="Amount"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-kpi font-semibold tabular-nums text-fg outline-none placeholder:text-fg-faint"
          placeholder="0"
        />
        {picker(from, setFrom, 'From currency')}
      </div>
      <div className="relative h-px bg-line">
        <button
          type="button"
          onClick={() => { setFrom(to); setTo(from) }}
          aria-label="Swap currencies"
          className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-fg-muted shadow-float transition-colors duration-150 hover:text-accent-600"
        >
          <ArrowUpDown aria-hidden className="h-4 w-4" />
        </button>
      </div>
      <div className="flex items-center gap-3 px-3 py-3">
        <output className="min-w-0 flex-1 truncate text-kpi font-semibold tabular-nums text-fg">{formatted}</output>
        {picker(to, setTo, 'To currency')}
      </div>
      {result !== null && parsed !== 0 && (
        <p className="px-3 pb-2 text-meta tabular-nums text-fg-muted">1 {from} = {(toRate / fromRate).toFixed(4)} {to}</p>
      )}
    </div>
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
        <span className="text-micro tabular-nums text-fg-muted">Updated {/^\d{4}-\d{2}-\d{2}$/.test(data.date) ? fmtDateEnGB(data.date + 'T00:00:00', { day: 'numeric', month: 'short', year: 'numeric' }) : data.date}</span>
      </div>
      {mode === 'rates' && <Rates data={data} />}
      {mode === 'convert' && <Converter rawRates={data.rawRates} />}
      {mode === 'change' && <Changes data={data} />}
    </div>
  )
}
