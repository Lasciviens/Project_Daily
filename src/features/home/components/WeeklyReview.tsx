import { useWeeklyReview } from '../hooks/useWeeklyReview'
import { useWidgetState } from '../hooks/useWidgetState'

// A once-a-week cross-domain review (training + nutrition + bodyweight over the
// last 7 days), generated at most once per ISO week (see useWeeklyReview); the
// ↻ button is a manual redo. Collapsible (persisted) — while collapsed the
// query is disabled so no AI request is spent. Mirrors DailyBriefing.
export function WeeklyReview() {
  const { collapsed, toggle } = useWidgetState('weeklyReview')
  const { text, isLoading, error, regenerate, isRefreshing } = useWeeklyReview({
    enabled: !collapsed,
  })

  return (
    <div className="rounded-2xl border border-accent-200 bg-gradient-to-br from-accent-50 to-cream-50 shadow-sm p-5">
      <div className={`flex items-center justify-between gap-2 ${collapsed ? '' : 'mb-2'}`}>
        <h2 className="text-xs font-bold text-accent-700 uppercase tracking-wide flex items-center gap-1.5">
          <span>📈</span> Weekly Review
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
          <p className="text-xs text-ink-400 pt-1">Haftalık değerlendirme hazırlanıyor…</p>
        </div>
      ) : error ? (
        <div className="text-sm text-ink-600">
          <p className="mb-2">Değerlendirme oluşturulamadı: {error.message}</p>
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
