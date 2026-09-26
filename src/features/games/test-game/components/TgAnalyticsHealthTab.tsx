import { useHealthData, type TgaBase } from './tgAnalyticsData'
import { TGA_GRID, TGA_GRID_3 } from './tgAnalyticsFormat'
import { TgAnalyticsHealthCoverage } from './TgAnalyticsHealthCoverage'
import { TgAnalyticsReview } from './TgAnalyticsReview'
import { TgAnalyticsFreshness } from './TgAnalyticsFreshness'
import { TgAnalyticsAssets } from './TgAnalyticsAssets'
import { TgAnalyticsHiddenTitles } from './TgAnalyticsHiddenTitles'

// Spans, one row span and a reorder pair cards of similar height per row.
// Screen-reader order stays Coverage · Review · Sources · Images · Hidden.
//   2 cols  [Coverage ··] [Review · Images] [Sources · Hidden]
//   3 cols  [Coverage ·· · Review] [Coverage ·· · Sources] [Images ·· · Hidden]
//   4 cols  [Coverage ·· · Review · Sources] [Images ·· · Hidden ··]
// Coverage is the tall one (up to 13 rows); where it spans two columns its
// rows flow into two columns of their own.
const COVERAGE = '@2xl:col-span-2 @[62rem]:row-span-2 @[100rem]:row-span-1'
const AFTER_AT_TWO = '@2xl:order-1 @[62rem]:order-none'
const IMAGES = '@[62rem]:col-span-2'
const HIDDEN = `${AFTER_AT_TWO} @[100rem]:col-span-2`

/**
 * Data health: how complete the metadata is, what needs review, how fresh
 * each source is, what the handheld uploaded and what is hidden. It reads the
 * library as it is, so the time window doesn't apply. Without retro games in
 * view, Needs review and the ES-DE images (both about retro games only) step
 * aside and the three remaining cards sit side by side.
 */
export function TgAnalyticsHealthTab({ base }: { base: TgaBase }) {
  const d = useHealthData(base)
  // Sources follows the library filter like every other card.
  const sources = base.library === 'all' ? d.freshness : d.freshness.filter(r => r.library === base.library)

  if (d.coverage.retro === 0) {
    // Three cards: a fourth column would stand empty on a monitor.
    return (
      <div className={TGA_GRID_3}>
        <TgAnalyticsHealthCoverage coverage={d.coverage} />
        <TgAnalyticsFreshness rows={sources} />
        <TgAnalyticsHiddenTitles hidden={d.hidden} />
      </div>
    )
  }
  return (
    <div className={TGA_GRID}>
      <TgAnalyticsHealthCoverage coverage={d.coverage} className={COVERAGE} />
      <TgAnalyticsReview review={d.review} />
      <TgAnalyticsFreshness rows={sources} className={AFTER_AT_TWO} />
      <TgAnalyticsAssets assets={d.assets} className={IMAGES} />
      <TgAnalyticsHiddenTitles hidden={d.hidden} className={HIDDEN} />
    </div>
  )
}
