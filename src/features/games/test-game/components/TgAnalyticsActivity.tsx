import { Activity } from 'lucide-react'
import type { TgaWindow } from './tgAnalyticsModel'
import type { TgaActivity } from './tgAnalyticsSeries'
import { TGA_RANGE } from './tgAnalyticsFormat'
import { activityMeta, activityNote, isActivityEmpty } from './tgAnalyticsActivity'
import { TgAnalyticsActivityChart } from './TgAnalyticsActivityChart'
import { TgActivityLegend } from './TgAnalyticsActivityParts'
import { TgAnalyticsCard, TgAnalyticsEmpty } from './TgAnalyticsCard'

const HEIGHT = 210

/**
 * When you played, by library: every played game once, at its latest session
 * — the only session date the providers report — with the window's
 * completions marked above the columns.
 */
export function TgAnalyticsActivity({ series, period, className = '' }: { series: TgaActivity; period: TgaWindow; className?: string }) {
  const note = activityNote(series)
  const empty = isActivityEmpty(series)
  return (
    <TgAnalyticsCard
      label="Activity" className={className}
      // The range is already in the controls; a narrow card drops it rather than truncating the counts.
      meta={<>{activityMeta(series)}<span className="hidden @[30rem]:inline"> {TGA_RANGE[period]}</span></>}
    >
      {empty ? (
        <TgAnalyticsEmpty
          icon={Activity} className="min-h-[210px]"
          title={`No sessions ${TGA_RANGE[period]}`}
          hint="Games land here at their latest session once ES-DE, Steam or PlayStation reports one — a launch under five minutes doesn’t count."
        />
      ) : (
        <>
          <TgActivityLegend libraries={series.libraries} completions={series.completed > 0} />
          <div className="mt-3">
            <TgAnalyticsActivityChart
              series={series} height={HEIGHT}
              caption={`Games per ${series.unit} by their latest session, and completions by finish date, ${TGA_RANGE[period]}`}
            />
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--tg-muted)]">
            Each game counts once, in the period of its latest session — providers don’t report earlier sessions.
          </p>
        </>
      )}
      {note && <p className={`${empty ? 'mt-3' : 'mt-1'} text-[11.5px] text-[var(--tg-muted)]`}>{note}</p>}
    </TgAnalyticsCard>
  )
}
