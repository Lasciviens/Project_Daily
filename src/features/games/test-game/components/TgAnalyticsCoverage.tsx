import { platformInfo } from '../testGameModel'
import type { TgaLibrary } from './tgAnalyticsModel'
import type { TgaPlayCoverage } from './tgAnalyticsMore'
import { fmtInt, fmtPct, plural } from './tgAnalyticsFormat'
import { openLibrary } from './tgAnalyticsNav'
import { coverageNote } from './tgAnalyticsPlay'
import { PlatformIcon } from './platformArt'
import { TgAnalyticsBarList } from './TgAnalyticsBarList'
import { TgAnalyticsCard } from './TgAnalyticsCard'

// The same two tones TgAnalyticsBarList draws a `part` row with.
const SWATCH = 'h-2.5 w-3.5 shrink-0 rounded-[3px]'
const FILLED = 'bg-[var(--tg-accent)]'
const TINT = 'bg-[color-mix(in_srgb,var(--tg-accent)_22%,var(--tg-panel))]'

/**
 * How much of the library has recorded play: the headline, then one bar per
 * platform — the whole bar is the platform's games, the filled part the ones
 * with recorded play. A row opens that platform's shelf.
 */
export function TgAnalyticsCoverage({ coverage, library }: { coverage: TgaPlayCoverage; library: TgaLibrary }) {
  const { total, played, unplayed, rows } = coverage
  return (
    <TgAnalyticsCard label="Play coverage" meta={plural(total, 'game')}>
      <p className="flex items-baseline gap-2">
        <span className="text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[var(--tg-text)]">{fmtInt(played)}</span>
        <span className="text-[13px] font-medium text-[var(--tg-text-2)]">played</span>
      </p>
      <p className="mt-2 text-[13px] text-[var(--tg-text-2)]">
        {fmtInt(unplayed)} with no recorded play <span className="tabular-nums text-[var(--tg-muted)]">({fmtPct(unplayed, total)})</span>
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-[var(--tg-muted)]">{coverageNote(library)}</p>

      <ul aria-label="Legend" className="mb-2 mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--tg-muted)]">
        <li className="flex items-center gap-1.5"><span aria-hidden className={`${SWATCH} ${FILLED}`} />Played</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className={`${SWATCH} ${TINT}`} />No recorded play</li>
      </ul>
      <TgAnalyticsBarList
        rows={rows}
        icon={row => <PlatformIcon family={row.target ? platformInfo(row.target).family : 'other'} className="h-[18px] w-[18px]" />}
        openLabel={row => `Open the ${row.label} shelf`}
        onOpen={row => { if (row.target) openLibrary({ platform: row.target }) }}
      />
    </TgAnalyticsCard>
  )
}
