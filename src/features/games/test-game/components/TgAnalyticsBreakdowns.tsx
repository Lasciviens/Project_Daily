import { useMemo, useState } from 'react'
import { BarChart3, Tags } from 'lucide-react'
import { platformInfo, type TgGame } from '../testGameModel'
import type { TgaBarRow, TgaLibrary } from './tgAnalyticsModel'
import { TGA_PLATFORM_METRICS, platformRowsBy, type TgaPlatformMetric } from './tgAnalyticsMore'
import { fmtHours } from './tgAnalyticsData'
import { plural } from './tgAnalyticsFormat'
import { openLibrary } from './tgAnalyticsNav'
import { TGA_PLATFORM_EMPTY, platformLegend, platformOpenLabel } from './tgAnalyticsCollection'
import { PlatformIcon } from './platformArt'
import { TgAnalyticsBarList } from './TgAnalyticsBarList'
import { TgAnalyticsCard, TgAnalyticsEmpty } from './TgAnalyticsCard'
import { TgDropdown } from './TgDropdown'

// The same two tones TgAnalyticsBarList draws a `part` row with.
const SWATCH = 'h-2.5 w-3.5 shrink-0 rounded-[3px]'

/** Names the two tones of a two-tone bar list: the filled share and the rest of the bar. */
export function TgAnalyticsPartLegend({ filled, rest, className = '' }: { filled: string; rest: string; className?: string }) {
  return (
    <ul aria-label="Legend" className={`mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--tg-muted)] ${className}`}>
      <li className="flex items-center gap-1.5"><span aria-hidden className={`${SWATCH} bg-[var(--tg-accent)]`} />{filled}</li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className={`${SWATCH} bg-[color-mix(in_srgb,var(--tg-accent)_22%,var(--tg-panel))]`} />{rest}
      </li>
    </ul>
  )
}

/**
 * Platforms ranked by one metric — games, play time, played share or
 * completions. A row opens that platform's shelf (its completed games, when
 * ranking by completions).
 */
export function TgAnalyticsPlatforms({ scoped, platforms, className = '' }: { scoped: TgGame[]; platforms: number; className?: string }) {
  const [metric, setMetric] = useState<TgaPlatformMetric>('games')
  const rows = useMemo(() => platformRowsBy(scoped, metric, fmtHours), [scoped, metric])
  const legend = platformLegend(metric)
  const empty = TGA_PLATFORM_EMPTY[metric]

  return (
    <TgAnalyticsCard label="Platforms" meta={plural(platforms, 'platform')} className={className}>
      <div className="-mt-1 mb-3 flex items-center gap-2">
        <span className="text-[12px] text-[var(--tg-muted)]">Rank by</span>
        {/* `!` because testGame.css loads after the utilities; touch keeps its 44px from there. */}
        <TgDropdown
          value={metric} onChange={setMetric} ariaLabel="Rank platforms by" className="!h-8 !px-2.5 !text-[12px]"
          buttonLabel={TGA_PLATFORM_METRICS.find(m => m.key === metric)?.label ?? ''}
          options={TGA_PLATFORM_METRICS.map(m => ({ value: m.key, label: m.label }))}
        />
      </div>
      {rows.length ? (
        <>
          {legend && <TgAnalyticsPartLegend filled={legend.filled} rest={legend.rest} />}
          <TgAnalyticsBarList
            rows={rows}
            icon={row => <PlatformIcon family={row.target ? platformInfo(row.target).family : 'other'} className="h-[18px] w-[18px]" />}
            openLabel={row => platformOpenLabel(metric, row)}
            onOpen={row => {
              if (row.target) openLibrary({ platform: row.target, status: metric === 'completed' ? 'completed' : undefined })
            }}
          />
        </>
      ) : (
        <TgAnalyticsEmpty icon={BarChart3} title={empty.title} hint={empty.hint} />
      )}
    </TgAnalyticsCard>
  )
}

/** The most common genres. A row opens the library filtered to that genre, on the analytics library's shelf. */
export function TgAnalyticsGenres({ rows, total, tagged, games, library, className = '' }: {
  rows: TgaBarRow[]; total: number; tagged: number; games: number; library: TgaLibrary; className?: string
}) {
  const untagged = games - tagged
  return (
    <TgAnalyticsCard
      label="Top genres" className={className}
      meta={total ? `${plural(total, 'genre')}${untagged ? ` · ${plural(untagged, 'game')} untagged` : ''}` : undefined}
    >
      {rows.length ? (
        <TgAnalyticsBarList
          rows={rows}
          openLabel={row => `Show ${row.label} games in the library`}
          onOpen={row => { if (row.target) openLibrary({ library, genre: row.target }) }}
        />
      ) : (
        <TgAnalyticsEmpty icon={Tags} title="No genres recorded" hint="Genres arrive with ScreenScraper, Steam and PlayStation metadata, or from a game's Edit form." />
      )}
    </TgAnalyticsCard>
  )
}
