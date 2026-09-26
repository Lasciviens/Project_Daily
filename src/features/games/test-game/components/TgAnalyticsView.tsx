import { useId, useState } from 'react'
import { useTestGameStore } from '../testGameStore'
import type { TestGameLibrary } from '../useTestGameLibrary'
import { formatDay } from '../testGameModel'
import type { TgaLibrary, TgaTile } from './tgAnalyticsModel'
import { useLibraryCounts, useTgAnalyticsBase } from './tgAnalyticsData'
import { useToday } from './tgAnalyticsClock'
import { TGA_RANGE } from './tgAnalyticsFormat'
import { TgAnalyticsControls } from './TgAnalyticsControls'
import { TgAnalyticsTabs } from './TgAnalyticsTabs'
import { TgAnalyticsDrill } from './TgAnalyticsDrill'
import { TgAnalyticsOverviewTab } from './TgAnalyticsOverviewTab'
import { TgAnalyticsPlayTab } from './TgAnalyticsPlayTab'
import { TgAnalyticsCollectionTab } from './TgAnalyticsCollectionTab'
import { TgAnalyticsHealthTab } from './TgAnalyticsHealthTab'
import { TgAnalyticsScopeEmpty, TgAnalyticsSkeleton } from './TgAnalyticsStates'
import { TgEmptyState, TgErrorState } from './TgStates'

// The Analytics section: the whole library in numbers, computed on the
// client from the same cached rows the shelves read (useTestGameLibrary
// shares their queries — nothing is fetched twice). Four tabs, and only the
// open one derives its figures. A container: every card sizes to the column
// it is given, not to the viewport.

const ROOT = '@container flex flex-col gap-5 pb-4 pt-2'

/** `lib` is the page's own library (never a second derivation of it). */
export function TgAnalyticsView({ lib }: { lib: TestGameLibrary }) {
  const today = useToday()
  const period = useTestGameStore(s => s.analyticsPeriod)
  const setPeriod = useTestGameStore(s => s.setAnalyticsPeriod)
  const picked = useTestGameStore(s => s.analyticsLibrary)
  const setLibrary = useTestGameStore(s => s.setAnalyticsLibrary)
  const tab = useTestGameStore(s => s.analyticsTab)
  const setTab = useTestGameStore(s => s.setAnalyticsTab)
  const panelId = useId()

  const [drill, setDrill] = useState<TgaTile | null>(null)

  const counts = useLibraryCounts(lib.games)
  // A library that has since lost its last visible game falls back to All.
  const library: TgaLibrary = picked !== 'all' && counts[picked] === 0 ? 'all' : picked
  const base = useTgAnalyticsBase(lib.games, period, library, today)

  if (lib.isError) return <TgErrorState error={lib.error} onRetry={lib.refetch} />
  if (lib.isLoading || (counts.all === 0 && lib.providersLoading)) {
    return <div className={ROOT}><TgAnalyticsSkeleton /></div>
  }
  if (counts.all === 0) return <div className="h-full pb-4 pt-2"><TgEmptyState kind="library" /></div>

  const windowed = base.start != null
  const caption = tab === 'health'
    ? 'Data health describes the whole library as it is today — the time window doesn’t apply here.'
    : windowed
      ? `Games you played, started or finished since ${formatDay(new Date(base.start!).toISOString())}. Play time is each game’s lifetime total — the providers report totals, not individual sessions.`
      : 'Your whole library. Play time is each game’s lifetime total, as ES-DE, Steam and PlayStation report it.'
  // Data health reads the whole library, so an empty window doesn't blank it.
  const empty = tab === 'health' ? base.inLibrary.length === 0 : base.scoped.length === 0

  return (
    <div className={ROOT}>
      <TgAnalyticsControls
        period={period} onPeriod={setPeriod} library={library} onLibrary={setLibrary} libraryCounts={counts}
        caption={caption} providersLoading={lib.providersLoading} providerError={lib.providerError != null}
        onRetryProviders={lib.retryProviders}
      />
      <TgAnalyticsTabs tab={tab} onTab={setTab} panelId={panelId} />

      <div id={panelId} role="tabpanel" aria-labelledby={`tga-tab-${tab}`} className="flex flex-col gap-5">
        {empty ? (
          <TgAnalyticsScopeEmpty
            range={TGA_RANGE[period]} windowed={windowed} filtered={library !== 'all'}
            onAllTime={() => setPeriod('all')} onAllLibraries={() => setLibrary('all')}
          />
        ) : tab === 'play' ? <TgAnalyticsPlayTab base={base} />
          : tab === 'collection' ? <TgAnalyticsCollectionTab base={base} />
          : tab === 'health' ? <TgAnalyticsHealthTab base={base} />
          : <TgAnalyticsOverviewTab base={base} onDrill={setDrill} />}
      </div>
      <TgAnalyticsDrill kind={drill} scoped={base.scoped} start={base.start} end={base.end} library={library} onClose={() => setDrill(null)} />
    </div>
  )
}
