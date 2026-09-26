import { useMemo } from 'react'
import { CalendarRange } from 'lucide-react'
import type { decadeRows } from './tgAnalyticsMore'
import { plural } from './tgAnalyticsFormat'
import { decadeBarRows, undatedNote } from './tgAnalyticsCollection'
import { TgAnalyticsBarList } from './TgAnalyticsBarList'
import { TgAnalyticsCard, TgAnalyticsEmpty } from './TgAnalyticsCard'
import { TgAnalyticsPartLegend } from './TgAnalyticsBreakdowns'

const noop = () => {}

/**
 * Games per release decade, oldest first: the whole bar is the decade's
 * games, the filled part the ones with recorded play.
 */
export function TgAnalyticsDecades({ decades, className = '' }: { decades: ReturnType<typeof decadeRows>; className?: string }) {
  const rows = useMemo(() => decadeBarRows(decades.rows), [decades.rows])
  const dated = decades.rows.reduce((n, r) => n + r.owned, 0)

  return (
    <TgAnalyticsCard label="Release decades" meta={dated ? plural(dated, 'dated game') : undefined} className={className}>
      {rows.length ? (
        // Capped: a wide card must not stretch a row past 40rem.
        <div className="max-w-[40rem]">
          <TgAnalyticsPartLegend filled="Played" rest="No recorded play" />
          <TgAnalyticsBarList rows={rows} onOpen={noop} openLabel={row => row.label} />
        </div>
      ) : (
        <TgAnalyticsEmpty
          icon={CalendarRange} title="No release years recorded"
          hint="Release years come with ES-DE, ScreenScraper, Steam and PlayStation metadata, or from a game's Edit form."
        />
      )}
      {decades.undated > 0 && <p className="mt-3 text-[11.5px] text-[var(--tg-muted)]">{undatedNote(decades.undated)}.</p>}
    </TgAnalyticsCard>
  )
}
