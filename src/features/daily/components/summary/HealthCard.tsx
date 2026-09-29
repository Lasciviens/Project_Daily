import { useMemo } from 'react'
import { Flame, Footprints, Heart, HeartPulse, Moon, Scale } from 'lucide-react'
import { Cell, CellHeader, CellLink } from './cellKit'
import { formatSleepHours as fmtHrs } from '../../../health/healthAggregate'
import { makeWindow } from '../../../health/healthWindowStats'
import { useEnergyWindow, useHeartWindow, useMetricWindow, useSleepWindow } from '../../../health/hooks/useHealthWindow'
import { useLatestBodyweight } from '../../../health/hooks/useBodyweight'
import { BODYWEIGHT_SOURCE_LABEL } from '../../../health/bodyweight'
import { nightEndingOn, nightMissingText, nightNoun } from '../../../health/healthDateLabels'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { useDragScroll } from '../../../../shared/hooks/useDragScroll'
import { formatDate } from '../../../../shared/utils/dateFormat'

// A SCROLLABLE health glance: one horizontal snap-strip — Sleep, Steps,
// Energy, Heart, Weight — for the day Daily is showing. Every number comes
// from the same window hooks as the Health page's Day view (one day, same
// rules, same cache), so the two can't disagree; the weight is the one merged
// bodyweight series (smart scale + Hevy + Apple Health).

const round = (n: number, d = 0) => { const p = 10 ** d; return Math.round(n * p) / p }

function Panel({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    // Fixed-width snap panels — the strip scrolls; each panel is content-sized.
    <div className="flex w-[150px] shrink-0 snap-start flex-col gap-1 rounded-row bg-surface-2 p-3">
      <p className="flex items-center gap-1.5 section-label [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}{label}</p>
      {children}
    </div>
  )
}
const Big = ({ children }: { children: React.ReactNode }) => <p className="text-title font-bold leading-none tabular-nums text-fg">{children}</p>
const Sub = ({ children }: { children: React.ReactNode }) => <p className="text-meta text-fg-muted">{children}</p>
const Empty = ({ loading, text = 'No data' }: { loading: boolean; text?: string }) => <p className="py-1 text-meta text-fg-muted">{loading ? '…' : text}</p>

export function HealthCard({ date }: { date: string }) {
  const drag = useDragScroll<HTMLDivElement>()
  const today = todayStr()
  const win = useMemo(() => makeWindow(date, date, today), [date, today])
  const isToday = date === today

  const sleep = useSleepWindow(win)
  const steps = useMetricWindow('step_count', win)
  const energy = useEnergyWindow(win)
  const heart = useHeartWindow(win)
  const weight = useLatestBodyweight(date)

  // The night that ended on this day (filed under the wake-up date) — never an older one.
  const night = nightEndingOn(sleep.nights, date)?.total ?? null
  const stepVal = steps.summary.value
  const active = energy.activeSummary.value
  const hr = heart.daily.find(d => d.date === date)
  const w = weight.data

  return (
    <Cell>
      <CellHeader icon={<HeartPulse />} title="Health" action={<CellLink to={`/health?date=${date}&period=day`}>Details</CellLink>} />

      {/* Swipeable strip — snap + edge fade signals there's more to the side */}
      <div {...drag} className={`-mx-1 flex gap-2 overflow-x-auto scrollbar-none scroll-fade-x snap-x-mandatory px-1 pb-1 ${drag.className}`}>
        <Panel icon={<Moon aria-hidden />} label="Sleep">
          {night != null
            ? (<><Big>{fmtHrs(night)}</Big><Sub>{nightNoun(date, today)}</Sub></>)
            : <Empty loading={sleep.isLoading} text={nightMissingText(date, today)} />}
        </Panel>
        <Panel icon={<Footprints aria-hidden />} label="Steps">
          {stepVal != null ? (<><Big>{round(stepVal).toLocaleString('en-GB')}</Big><Sub>{isToday ? 'steps so far' : 'steps'}</Sub></>) : <Empty loading={steps.isLoading} />}
        </Panel>
        <Panel icon={<Flame aria-hidden />} label="Energy">
          {active != null ? (<><Big>{round(active)}</Big><Sub>active kcal{isToday ? ' so far' : ''}</Sub></>) : <Empty loading={energy.isLoading} />}
        </Panel>
        <Panel icon={<Heart aria-hidden />} label="Heart">
          {hr?.avg != null ? (
            <>
              <Big>{round(hr.avg)}</Big>
              <Sub>avg{hr.min != null && hr.max != null ? ` · ${round(hr.min)}–${round(hr.max)}` : ''} bpm</Sub>
            </>
          ) : <Empty loading={heart.isLoading} />}
        </Panel>
        <Panel icon={<Scale aria-hidden />} label="Weight">
          {w ? (
            <>
              <Big>{round(w.kg, 1)}</Big>
              <Sub>kg · {formatDate(w.date)}</Sub>
              <p className="text-micro text-fg-faint">{BODYWEIGHT_SOURCE_LABEL[w.source]}</p>
            </>
          ) : <Empty loading={weight.isLoading} />}
        </Panel>
      </div>
    </Cell>
  )
}
