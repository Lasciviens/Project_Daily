import type { TgaTile } from './tgAnalyticsModel'
import { useOverviewData, type TgaBase } from './tgAnalyticsData'
import { TGA_GRID, TGA_SPAN_WIDE } from './tgAnalyticsFormat'
import { TgAnalyticsKpis } from './TgAnalyticsKpis'
import { TgAnalyticsHiddenNote } from './TgAnalyticsHiddenNote'
import { TgAnalyticsActivity } from './TgAnalyticsActivity'
import { TgAnalyticsStatusMix } from './TgAnalyticsStatusMix'
import { TgAnalyticsIdle } from './TgAnalyticsIdle'
import { TgAnalyticsRecent } from './TgAnalyticsPlayed'
import { TgAnalyticsFacts } from './TgAnalyticsFacts'

// Spans and a reorder pair cards of similar height per row. Screen-reader
// order stays Activity · Status · Idle · Recent · Facts; only the visual rows move.
//                   2 columns                                3 columns                                 4 columns
// all cards:  [Activity ··] [Status · Facts] [Idle · Recent]  [Activity ·· · Status] [Idle · Facts · Recent]  [Activity ·· · Status · Idle] [Recent ·· · Facts ··]
// no Idle:    [Activity ··] [Status · Facts] [Recent ··]      [Activity ·· · Status] [Facts · Recent ··]      [Activity ·· · Status · Recent] [Facts ····]
// no Facts:   [Activity ··] [Status · Idle] [Recent ··]       [Activity ·· · Status] [Idle · Recent ··]       [Activity ·· · Status · Idle] [Recent ··]
// neither:    [Activity ··] [Status · Recent]                 [Activity ·· · Status] [Recent ··]              [Activity ·· · Status · Recent]
const LAYOUT = {
  all: { idle: '@2xl:order-1 @[62rem]:order-none', recent: '@2xl:order-1 @[100rem]:order-none @[100rem]:col-span-2', facts: '@[100rem]:col-span-2' },
  noIdle: { idle: '', recent: '@2xl:order-1 @2xl:col-span-2 @[100rem]:order-none @[100rem]:col-span-1', facts: '@[100rem]:col-span-4' },
  noFacts: { idle: '', recent: '@2xl:col-span-2', facts: '' },
  neither: { idle: '', recent: '@[62rem]:col-span-2 @[100rem]:col-span-1', facts: '' },
}

/** Overview: the headline tiles, then activity, the status mix, what's idle, recent sessions and a few facts. */
export function TgAnalyticsOverviewTab({ base, onDrill }: { base: TgaBase; onDrill: (t: TgaTile) => void }) {
  const d = useOverviewData(base)
  const hasIdle = d.playing.total > 0
  const hasFacts = d.facts.length > 0
  const at = LAYOUT[hasIdle ? (hasFacts ? 'all' : 'noFacts') : hasFacts ? 'noIdle' : 'neither']
  return (
    <>
      <TgAnalyticsKpis k={d.kpis} windowed={base.start != null} onOpen={onDrill} />
      <TgAnalyticsHiddenNote hidden={d.hidden} library={base.library} />
      <div className={TGA_GRID}>
        <TgAnalyticsActivity series={d.activity} period={base.period} className={TGA_SPAN_WIDE} />
        <TgAnalyticsStatusMix mix={d.mix} total={base.scoped.length} library={base.library} />
        <TgAnalyticsIdle breakdown={d.playing} library={base.library} className={at.idle} />
        <TgAnalyticsRecent items={d.recent} className={at.recent} />
        <TgAnalyticsFacts facts={d.facts} className={at.facts} />
      </div>
    </>
  )
}
