import { useCurrency } from '../hooks/useHomeData'

const FLAG: Record<string, string> = {
  EUR: '🇪🇺', USD: '🇺🇸', GBP: '🇬🇧', SEK: '🇸🇪', DKK: '🇩🇰',
}

export function CurrencyWidget() {
  const { data, isLoading, error } = useCurrency()

  if (isLoading) return <WidgetShell><div className="text-ink-400 text-sm">Loading…</div></WidgetShell>
  if (error || !data) return <WidgetShell><div className="text-ink-400 text-sm">Unavailable</div></WidgetShell>

  const entries = Object.entries(data.rates)

  return (
    <WidgetShell>
      <div className="text-xs text-ink-400 mb-3">
        1 NOK as of {new Date(data.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
      </div>
      <div className="space-y-2.5">
        {entries.map(([currency, rate]) => (
          <div key={currency} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-base">{FLAG[currency] ?? '🌐'}</span>
              <span className="text-sm font-medium text-ink-700">{currency}</span>
            </div>
            <div className="text-sm font-mono text-ink-900">
              {rate.toFixed(4)}
            </div>
          </div>
        ))}
      </div>
    </WidgetShell>
  )
}

function WidgetShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-ink-200 p-4 shadow-sm">
      <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide mb-1">Currency · NOK</h3>
      {children}
    </div>
  )
}
