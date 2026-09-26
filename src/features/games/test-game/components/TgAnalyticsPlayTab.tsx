import { usePsnStatus } from '../../hooks/usePlayStation'
import { usePlayData, type TgaBase } from './tgAnalyticsData'
import { TGA_GRID } from './tgAnalyticsFormat'
import { TGA_SPAN_ROW, TGA_SPAN_SPREAD_ALONE } from './tgAnalyticsPlay'
import { TgAnalyticsCoverage } from './TgAnalyticsCoverage'
import { TgAnalyticsLibraries } from './TgAnalyticsLibraries'
import { TgAnalyticsMostPlayed } from './TgAnalyticsPlayed'
import { TgAnalyticsPlaytime } from './TgAnalyticsPlaytime'
import { TgAnalyticsTrophies } from './TgAnalyticsTrophies'

// Dense flow lets the one-column cards fill the row above the full-width
// Libraries table, so each row pairs cards of similar height:
//   2 cols  [Coverage · Most played] [Libraries ··] [Spread · Trophies]
//   3 cols  [Coverage · Most played · Spread] [Libraries ···] [Trophies]
//   4 cols  [Coverage · Most played · Spread · Trophies] [Libraries ····]
// Libraries only shows for All; Trophies only with a PlayStation connection.
// Without Trophies, Spread takes two columns where it would stand alone.
const GRID = `${TGA_GRID} grid-flow-row-dense`

function Cards({ base, trophies }: { base: TgaBase; trophies: boolean }) {
  const d = usePlayData(base)
  return (
    <div className={GRID}>
      <TgAnalyticsCoverage coverage={d.coverage} library={base.library} />
      <TgAnalyticsLibraries rows={d.libraries} className={TGA_SPAN_ROW} />
      <TgAnalyticsMostPlayed items={d.mostPlayed} launched={d.mostLaunched} />
      <TgAnalyticsPlaytime buckets={d.buckets} concentration={d.concentration} className={trophies ? '' : TGA_SPAN_SPREAD_ALONE} />
      {trophies && <TgAnalyticsTrophies library={base.library} />}
    </div>
  )
}

/** The connection status only matters where Trophies can show; elsewhere it isn't fetched at all. */
function WithPsn({ base }: { base: TgaBase }) {
  const status = usePsnStatus()
  return <Cards base={base} trophies={!!status.data?.connected} />
}

/** Play: how much of the library gets played, the libraries side by side, and where the hours go. */
export function TgAnalyticsPlayTab({ base }: { base: TgaBase }) {
  return base.library === 'all' || base.library === 'playstation'
    ? <WithPsn base={base} />
    : <Cards base={base} trophies={false} />
}
