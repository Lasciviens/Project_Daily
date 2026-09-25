import { Tags } from 'lucide-react'
import { useTestGameStore } from '../testGameStore'
import { ALL_PLATFORMS, platformInfo } from '../testGameModel'
import type { TgaBarRow } from './tgAnalyticsModel'
import { plural } from './tgAnalyticsFormat'
import { PlatformIcon } from './platformArt'
import { TgAnalyticsBarList } from './TgAnalyticsBarList'
import { TgAnalyticsCard, TgAnalyticsEmpty } from './TgAnalyticsCard'

// Setters are read at click time; subscribing to them would only add renders.
const act = useTestGameStore.getState

/** Games per platform, biggest first. A row opens that platform's shelf, unfiltered. */
export function TgAnalyticsPlatforms({ rows, platforms }: { rows: TgaBarRow[]; platforms: number }) {
  return (
    <TgAnalyticsCard label="Library by platform" meta={plural(platforms, 'platform')}>
      <TgAnalyticsBarList
        rows={rows}
        icon={row => <PlatformIcon family={row.target ? platformInfo(row.target).family : 'other'} className="h-[18px] w-[18px]" />}
        openLabel={row => `Open the ${row.label} shelf`}
        onOpen={row => {
          if (!row.target) return
          const s = act()
          s.setSearch('')
          s.setGenre(null)
          s.setPlatform(row.target)
        }}
      />
    </TgAnalyticsCard>
  )
}

/** The most common genres. A row opens the whole library filtered to that genre. */
export function TgAnalyticsGenres({ rows, total, tagged, games }: { rows: TgaBarRow[]; total: number; tagged: number; games: number }) {
  const untagged = games - tagged
  return (
    <TgAnalyticsCard
      label="Top genres"
      meta={total ? `${plural(total, 'genre')}${untagged ? ` · ${plural(untagged, 'game')} untagged` : ''}` : undefined}
    >
      {rows.length ? (
        <TgAnalyticsBarList
          rows={rows}
          openLabel={row => `Show ${row.label} games in the library`}
          onOpen={row => {
            if (!row.target) return
            const s = act()
            s.setSearch('')
            s.setPlatform(ALL_PLATFORMS)
            s.setGenre(row.target)
          }}
        />
      ) : (
        <TgAnalyticsEmpty icon={Tags} title="No genres recorded" hint="Genres arrive with ScreenScraper, Steam and PlayStation metadata, or from a game's Edit form." />
      )}
    </TgAnalyticsCard>
  )
}
