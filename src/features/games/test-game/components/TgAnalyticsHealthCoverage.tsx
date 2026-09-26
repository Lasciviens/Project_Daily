import { FileSearch, Wand2 } from 'lucide-react'
import type { TgaCoverageField } from './tgAnalyticsHealth'
import { plural } from './tgAnalyticsFormat'
import { coverageFix, coverageFootnote, coverageMeta, coverageScopeNote } from './tgAnalyticsHealthCopy'
import { TgAnalyticsCard, TgAnalyticsEmpty } from './TgAnalyticsCard'
import { TgAnalyticsHealthCoverageRow } from './TgAnalyticsHealthCoverageRow'

// The same two tones the meter draws.
const SWATCH = 'h-2.5 w-3.5 shrink-0 rounded-[3px]'

/**
 * How complete the metadata is, one row per field, the biggest gap first.
 * A row with a gap ScreenScraper can close opens the batch scrape on exactly
 * those games. In a card wide enough, the rows flow into two columns.
 */
export function TgAnalyticsHealthCoverage({ coverage, className = '' }: {
  coverage: { fields: TgaCoverageField[]; retro: number }
  className?: string
}) {
  const { fields, retro } = coverage
  const scope = coverageScopeNote(fields, retro)
  const foot = coverageFootnote(fields)
  const fixable = fields.some(f => coverageFix(f, retro)?.kind === 'scrape')
  // The header's one truncating line is short on a phone: the count alone there.
  const meta = retro > 0 && (
    <>
      <span className="@[26rem]:hidden">{plural(retro, 'retro game')}</span>
      <span className="hidden @[26rem]:inline">{coverageMeta(retro)}</span>
    </>
  )

  return (
    <TgAnalyticsCard label="Metadata coverage" meta={meta || undefined} className={className}>
      {fields.length ? (
        <>
          <ul aria-label="Legend" className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--tg-muted)]">
            <li className="flex items-center gap-1.5"><span aria-hidden className={`${SWATCH} bg-[var(--tg-accent)]`} />Filled</li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden className={`${SWATCH} bg-[color-mix(in_srgb,var(--tg-accent)_22%,var(--tg-panel))]`} />Missing
            </li>
            {fixable && (
              <li className="flex items-center gap-1.5">
                <Wand2 size={12} strokeWidth={2.1} aria-hidden className="text-[var(--tg-accent)]" />Opens ScreenScraper on the gaps
              </li>
            )}
          </ul>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-0.5 @[46rem]:grid-cols-2">
            {fields.map(f => <TgAnalyticsHealthCoverageRow key={f.key} field={f} retro={retro} />)}
          </ul>
          {(scope || foot) && (
            <div className="mt-3 flex flex-col gap-1 text-[12px] leading-relaxed text-[var(--tg-muted)]">
              {scope && <p>{scope}</p>}
              {foot && <p>{foot}</p>}
            </div>
          )}
        </>
      ) : (
        <TgAnalyticsEmpty icon={FileSearch} title="Nothing to measure" hint="Metadata coverage fills in once the library has games." />
      )}
    </TgAnalyticsCard>
  )
}
