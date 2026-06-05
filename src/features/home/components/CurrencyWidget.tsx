import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchCurrencyData } from '../api/currencyApi'
import { useWidgetState } from '../hooks/useWidgetState'
import { WidgetShell } from './WidgetShell'

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = 'rates' | 'change'

// ─── Constants ────────────────────────────────────────────────────────────────

const FLAG: Record<string, string> = {
  NOK: '🇳🇴', TRY: '🇹🇷', EUR: '🇪🇺', USD: '🇺🇸',
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CurrencyWidget() {
  const [mode, setMode] = useState<Mode>('rates')
  // Currency data updates every 24h — 30m refresh is plenty
  const ws = useWidgetState('currency', { collapsed: false, intervalMs: 30 * 60_000 })

  const { data, isLoading, error, refetch } = useQuery({
    queryKey:        ['currency', 'v2'],
    queryFn:         fetchCurrencyData,
    staleTime:       ws.intervalMs,
    refetchInterval: !ws.collapsed && ws.syncActive ? ws.intervalMs : false,
    enabled:         !ws.collapsed,
  })

  const modeTabs = (
    <div className="flex gap-1">
      <button
        onClick={() => setMode('rates')}
        className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors duration-150 ${
          mode === 'rates' ? 'bg-accent-500 text-white' : 'text-ink-400 hover:bg-ink-100'
        }`}
      >
        Rates
      </button>
      <button
        onClick={() => setMode('change')}
        className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors duration-150 ${
          mode === 'change' ? 'bg-accent-500 text-white' : 'text-ink-400 hover:bg-ink-100'
        }`}
      >
        Change
      </button>
    </div>
  )

  return (
    <WidgetShell
      title="Currency"
      ws={ws}
      headerRight={modeTabs}
      onManualSync={() => { refetch(); ws.markSynced() }}
    >
      {isLoading && <div className="text-ink-400 text-sm">Loading…</div>}
      {error     && <div className="text-ink-400 text-sm">Unavailable</div>}

      {data && mode === 'rates' && (
        <div className="space-y-2.5">
          {data.crossRates.map(r => (
            <div key={r.pair} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-sm">{FLAG[r.base] ?? '🌐'}</span>
                <span className="text-xs font-medium text-ink-600">{r.pair}</span>
              </div>
              <span className="text-sm font-mono text-ink-900 tabular-nums">
                {r.rate >= 100 ? r.rate.toFixed(2) : r.rate.toFixed(4)}
              </span>
            </div>
          ))}
        </div>
      )}

      {data && mode === 'change' && (
        <div className="space-y-2.5">
          <p className="text-[10px] text-ink-400 mb-2">24h change vs yesterday (USD base)</p>
          {data.changes.map(c => {
            const up = c.change > 0
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
