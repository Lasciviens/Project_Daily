import { useDailyBriefing } from '../hooks/useDailyBriefing'
import { useWidgetState } from '../hooks/useWidgetState'

// Leads the home page: an AI-written morning digest of the day's tasks,
// schedule, training, news headlines, currency trend and more. Auto-generated
// at most once per day (see useDailyBriefing); the ↻ button is a manual redo.
// Collapsible (persisted via useWidgetState) — while collapsed the query is
// disabled so no AI request is spent.

export function DailyBriefing() {
  const { collapsed, toggle } = useWidgetState('dailyBriefing')
  const { text, isLoading, error, regenerate, isRefreshing } = useDailyBriefing({
    enabled: !collapsed,
  })

  return (
    <div className="rounded-2xl border border-accent-200 bg-gradient-to-br from-accent-50 to-cream-50 shadow-sm p-5">
      <div className={`flex items-center justify-between gap-2 ${collapsed ? '' : 'mb-2'}`}>
        <h2 className="text-xs font-bold text-accent-700 uppercase tracking-wide flex items-center gap-1.5">
          <span>✦</span> Daily Brief
        </h2>
        <div className="flex items-center gap-1">
          {!collapsed && (
            <button
              type="button"
              onClick={() => regenerate()}
              disabled={isRefreshing}
              title="Yeniden oluştur (yeni bir AI isteği harcar)"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-ink-400 hover:text-accent-600 disabled:opacity-40 transition-colors"
            >
              <span className={isRefreshing ? 'inline-block animate-spin' : ''}>↻</span>
            </button>
          )}
          <button
            type="button"
            onClick={toggle}
            title={collapsed ? 'Genişlet' : 'Daralt'}
            aria-expanded={!collapsed}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-ink-400 hover:text-accent-600 transition-colors"
          >
            <span className={`inline-block transition-transform ${collapsed ? '' : 'rotate-180'}`}>⌄</span>
          </button>
        </div>
      </div>

      {collapsed ? null : isLoading ? (
        <div className="space-y-2">
          <div className="h-3 rounded bg-accent-100 animate-pulse w-1/3" />
          <div className="h-3 rounded bg-accent-100 animate-pulse w-full" />
          <div className="h-3 rounded bg-accent-100 animate-pulse w-5/6" />
          <div className="h-3 rounded bg-accent-100 animate-pulse w-2/3" />
          <p className="text-xs text-ink-400 pt-1">Bugünün brifingi hazırlanıyor…</p>
        </div>
      ) : error ? (
        <div className="text-sm text-ink-600">
          <p className="mb-2">Brifing oluşturulamadı: {error.message}</p>
          <button
            type="button"
            onClick={() => regenerate()}
            className="min-h-[44px] px-3 rounded-lg bg-accent-600 text-white text-xs font-semibold hover:bg-accent-700 transition-colors"
          >
            Tekrar dene
          </button>
        </div>
      ) : text ? (
        <p className="text-sm text-ink-800 whitespace-pre-wrap leading-relaxed">{text}</p>
      ) : null}
    </div>
  )
}
