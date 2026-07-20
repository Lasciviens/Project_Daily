import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchCurrencyData } from '../api/currencyApi'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = 'rates' | 'change' | 'convert'

// ─── Constants ────────────────────────────────────────────────────────────────

const FLAG: Record<string, string> = {
  NOK: '🇳🇴', TRY: '🇹🇷', EUR: '🇪🇺', USD: '🇺🇸', XAU: '🥇',
}

function ChangeBadge({ pct }: { pct: number }) {
  const up   = pct > 0
  const flat = Math.abs(pct) < 0.01
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums ${
      flat ? 'text-ink-400' : up ? 'text-green-600' : 'text-red-500'
    }`}>
      <span>{flat ? '─' : up ? '▲' : '▼'}</span>
      <span>{flat ? '0.00%' : `${Math.abs(pct).toFixed(2)}%`}</span>
    </span>
  )
}

const CURRENCIES = ['NOK', 'TRY', 'EUR', 'USD']

// ─── Converter sub-component ──────────────────────────────────────────────────

function CurrencyConverter({ rawRates }: { rawRates: Record<string, number> }) {
  const [amount, setAmount] = useState('1')
  const [from,   setFrom]   = useState('NOK')
  const [to,     setTo]     = useState('TRY')

  // OXR uses USD as base: rawRates[X] = units of X per 1 USD
  // cross rate: X → Y = rawRates[Y] / rawRates[X]
  const fromRate = from === 'USD' ? 1 : (rawRates[from] ?? 1)
  const toRate   = to   === 'USD' ? 1 : (rawRates[to]   ?? 1)
  const parsed   = parseFloat(amount.replace(',', '.'))
  const result   = isNaN(parsed) ? null : parsed * (toRate / fromRate)

  function swap() {
    setFrom(to)
    setTo(from)
  }

  const selectClass = 'appearance-none bg-transparent text-sm font-semibold text-ink-700 pr-1 focus:outline-none cursor-pointer'

  return (
    <div className="rounded-xl border border-ink-200 overflow-hidden">
      {/* From row */}
      <div className="flex items-center gap-3 px-3 py-3 bg-cream-50">
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          className="flex-1 min-w-0 text-2xl font-semibold text-ink-900 bg-transparent focus:outline-none placeholder:text-ink-300"
          placeholder="0"
        />
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-base">{FLAG[from] ?? '🌐'}</span>
          <select value={from} onChange={e => setFrom(e.target.value)} className={selectClass}>
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Divider + swap — w-11 h-11 (44px) meets touch target minimum; -translate centers it on the 1px divider */}
      <div className="relative h-px bg-ink-100">
        <button
          onClick={swap}
          title="Swap"
          className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-cream-50 border border-ink-200 text-ink-500 hover:text-accent-600 hover:border-accent-300 transition-colors duration-150 flex items-center justify-center text-sm shadow-sm"
        >
          ⇅
        </button>
      </div>

      {/* To row */}
      <div className="flex items-center gap-3 px-3 py-3 bg-cream-50">
        <div className="flex-1 min-w-0 text-2xl font-semibold text-ink-900 tabular-nums">
          {result !== null
            ? result >= 1000
              ? result.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              : result.toFixed(4).replace(/\.?0+$/, '') || '0'
            : '—'
          }
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-base">{FLAG[to] ?? '🌐'}</span>
          <select value={to} onChange={e => setTo(e.target.value)} className={selectClass}>
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {result !== null && !isNaN(parsed) && parsed !== 0 && (
        <div className="px-3 pb-2 text-[10px] text-ink-400">
          1 {from} = {(toRate / fromRate).toFixed(4)} {to}
        </div>
      )}
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CurrencyWidget() {
  // Mobile audit: 2026-06-15 — mode tabs corrected to min-h-[44px] (was 32px); swap button corrected to w-11 h-11 (44px) from w-8 h-8 (32px); text-2xl inputs use min-w-0 so no overflow at 280px or full-width mobile
  const [mode, setMode] = useState<Mode>('rates')
  // 60 min interval keeps monthly requests under OXR free tier limit (1000/mo)
  const ws = useWidgetState('currency', { collapsed: false, intervalMs: 60 * 60_000 }, true)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey:        ['currency', 'v2'],
    queryFn:         fetchCurrencyData,
    staleTime:       0,
    refetchInterval: !ws.collapsed && ws.syncActive ? ws.intervalMs : false,
    enabled:         !ws.collapsed,
  })

  const modeTabs = (
    <div className="flex gap-0.5 bg-cream-100 p-0.5 rounded-lg">
      {(['rates', 'convert', 'change'] as Mode[]).map(m => (
        <button
          key={m}
          onClick={() => setMode(m)}
          className={`text-[10px] px-2.5 rounded-md font-medium transition-colors duration-150 capitalize min-h-[44px] inline-flex items-center justify-center ${
            mode === m ? 'bg-cream-50 text-ink-900 shadow-sm' : 'text-ink-400 hover:text-ink-600'
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  )

  return (
    <WidgetShell
      title="Currency"
      ws={ws}
      headerRight={modeTabs}
      onManualSync={async () => { const result = await refetch(); if (result.isSuccess) ws.markSynced() }}
    >
      {isLoading && (
        <div className="space-y-2">
          <div className="h-4 w-full rounded bg-cream-200 animate-pulse" />
          <div className="h-4 w-3/4 rounded bg-cream-200 animate-pulse" />
        </div>
      )}
      {error     && <div className="text-ink-400 text-sm">Unavailable</div>}

      {data && (
        <p className="text-[10px] text-ink-300 mb-2">Updated {data.date}</p>
      )}

      {data && mode === 'convert' && (
        <CurrencyConverter rawRates={data.rawRates} />
      )}

      {data && mode === 'rates' && (
        <div className="space-y-3">
          {/* Primary: the user's two home currencies, NOK ⇄ TRY directly —
              never routed through a 3rd currency. */}
          <div className="rounded-xl border border-ink-200 bg-cream-50 px-3.5 py-3">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-xs font-semibold text-ink-500 flex items-center gap-1.5">
                {FLAG.NOK} NOK <span className="text-ink-300">⇄</span> {FLAG.TRY} TRY
              </span>
              <ChangeBadge pct={data.primary.changePct} />
            </div>
            <div className="text-2xl font-bold text-ink-900 tabular-nums">
              1 NOK = {data.primary.rate.toFixed(3)} TRY
            </div>
          </div>

          {/* Secondary: EUR and USD against EACH OTHER (their own parity) —
              not "EUR vs NOK" / "USD vs NOK", which was the confusing part. */}
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-xs font-medium text-ink-500 flex items-center gap-1.5">
              {FLAG.EUR} EUR <span className="text-ink-300">⇄</span> {FLAG.USD} USD
            </span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono text-ink-900 tabular-nums">1 EUR = {data.secondary.rate.toFixed(4)} USD</span>
              <ChangeBadge pct={data.secondary.changePct} />
            </div>
          </div>

          {/* Gold */}
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-xs font-medium text-ink-500 flex items-center gap-1.5">{FLAG.XAU} Gold</span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono text-ink-900 tabular-nums">
                ${data.gold.usdPerOz.toLocaleString('en-US', { maximumFractionDigits: 0 })}/oz
                <span className="text-ink-400"> · {data.gold.nokPerGram.toFixed(1)} NOK/g</span>
              </span>
              <ChangeBadge pct={data.gold.changePct} />
            </div>
          </div>
        </div>
      )}

      {data && mode === 'change' && (
        <div className="space-y-2.5">
          <p className="text-[10px] text-ink-400 mb-2">Each currency's own 24h move — not against another currency</p>
          {data.changes.map(c => {
            const up   = c.change > 0
            const flat = Math.abs(c.change) < 0.01
            return (
              <div key={c.code} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{FLAG[c.code] ?? '🌐'}</span>
                  <span className="text-xs font-medium text-ink-600">{c.code}</span>
                </div>
                <div className={`flex items-center gap-1 text-sm font-mono tabular-nums ${
                  flat ? 'text-ink-400' : up ? 'text-green-600' : 'text-red-500'
                }`}>
                  <span>{flat ? '─' : up ? '▲' : '▼'}</span>
                  <span>{flat ? '0.00%' : `${Math.abs(c.change).toFixed(2)}%`}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </WidgetShell>
  )
}
