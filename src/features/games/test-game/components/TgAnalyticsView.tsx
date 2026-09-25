import { useTestGameStore } from '../testGameStore'
import { useTestGameLibrary } from '../useTestGameLibrary'
import { formatDay } from '../testGameModel'
import { useState } from 'react'
import type { TgaLibrary, TgaTile } from './tgAnalyticsModel'
import { useLibraryCounts, useTgAnalyticsData } from './tgAnalyticsData'
import { useToday } from './tgAnalyticsClock'
import { TGA_GRID, TGA_ORDER_RATINGS, TGA_RANGE, TGA_SPAN_RECENT, TGA_SPAN_WIDE } from './tgAnalyticsFormat'
import { TgAnalyticsControls } from './TgAnalyticsControls'
import { TgAnalyticsKpis } from './TgAnalyticsKpis'
import { TgAnalyticsDrill } from './TgAnalyticsDrill'
import { TgAnalyticsStatusMix } from './TgAnalyticsStatusMix'
import { TgAnalyticsCompletions, TgAnalyticsRatings } from './TgAnalyticsCharts'
import { TgAnalyticsPlatforms, TgAnalyticsGenres } from './TgAnalyticsBreakdowns'
import { TgAnalyticsMostPlayed, TgAnalyticsRecent } from './TgAnalyticsPlayed'
import { TgAnalyticsScopeEmpty, TgAnalyticsSkeleton } from './TgAnalyticsStates'
import { TgEmptyState, TgErrorState } from './TgStates'

// The Analytics section: the whole library in numbers, computed on the
// client from the same cached rows the shelves read (useTestGameLibrary
// shares their queries — nothing is fetched twice). A container: every card
// sizes to the column it is given, not to the viewport.

const ROOT = '@container flex flex-col gap-5 pb-4 pt-2'

export function TgAnalyticsView() {
  const lib = useTestGameLibrary()
  const today = useToday()
  const period = useTestGameStore(s => s.analyticsPeriod)
  const setPeriod = useTestGameStore(s => s.setAnalyticsPeriod)
  const picked = useTestGameStore(s => s.analyticsLibrary)
  const setLibrary = useTestGameStore(s => s.setAnalyticsLibrary)

  const [drill, setDrill] = useState<TgaTile | null>(null)

  const counts = useLibraryCounts(lib.games)
  // A library that has since lost its last visible game falls back to All.
  const library: TgaLibrary = picked !== 'all' && counts[picked] === 0 ? 'all' : picked
  const d = useTgAnalyticsData(lib.games, period, library, today)

  if (lib.isError) return <TgErrorState error={lib.error} onRetry={lib.refetch} />
  if (lib.isLoading || (counts.all === 0 && lib.providersLoading)) {
    return <div className={ROOT}><TgAnalyticsSkeleton /></div>
  }
  if (counts.all === 0) return <div className="h-full pb-4 pt-2"><TgEmptyState kind="library" /></div>

  const windowed = d.start != null
  const caption = windowed
    ? `Games you played, started or finished since ${formatDay(new Date(d.start!).toISOString())}. Play time is each game’s lifetime total — the providers report totals, not individual sessions.`
    : 'Your whole library. Play time is each game’s lifetime total, as ES-DE, Steam and PlayStation report it.'

  return (
    <div className={ROOT}>
      <TgAnalyticsControls
        period={period} onPeriod={setPeriod} library={library} onLibrary={setLibrary} libraryCounts={counts}
        caption={caption} providersLoading={lib.providersLoading} providerError={lib.providerError != null}
        onRetryProviders={lib.retryProviders}
      />

      {d.scoped.length === 0 ? (
        <TgAnalyticsScopeEmpty
          range={TGA_RANGE[period]} windowed={windowed} filtered={library !== 'all'}
          onAllTime={() => setPeriod('all')} onAllLibraries={() => setLibrary('all')}
        />
      ) : (
        <>
          <TgAnalyticsKpis k={d.kpis} windowed={windowed} onOpen={setDrill} />
          <div className={TGA_GRID}>
            <TgAnalyticsCompletions series={d.completions} period={period} className={TGA_SPAN_WIDE} />
            <TgAnalyticsStatusMix mix={d.mix} total={d.scoped.length} />
            <TgAnalyticsRatings {...d.ratings} className={TGA_ORDER_RATINGS} />
            <TgAnalyticsMostPlayed items={d.mostPlayed} />
            <TgAnalyticsPlatforms rows={d.platforms} platforms={d.platformCount} />
            <TgAnalyticsGenres rows={d.genres.rows} total={d.genres.total} tagged={d.genres.tagged} games={d.scoped.length} />
            <TgAnalyticsRecent items={d.recent} className={TGA_SPAN_RECENT} />
          </div>
        </>
      )}
      <TgAnalyticsDrill kind={drill} scoped={d.scoped} start={d.start} library={library} onClose={() => setDrill(null)} />
    </div>
  )
}
