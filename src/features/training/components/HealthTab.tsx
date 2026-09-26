import { useEffect, useRef, useState } from 'react'
import { useHealthWorkouts } from '../hooks/useHealthExport'
import { ActivityRings } from './health/ActivityRings'
import { HealthWorkoutDetail } from './health/HealthWorkoutDetail'
import { StepsSection } from './health/StepsSection'
import { EnergySection } from './health/EnergySection'
import { HeartSection } from './health/HeartSection'
import { SleepSection } from './health/SleepSection'
import { BodySection } from './health/BodySection'
import { SECTIONS, type SectionId, type HealthRange } from './health/sectionTypes'
import { DateNav } from './health/DateNav'
import { PeriodToggle, type Period } from './health/PeriodToggle'
import { useAnchorDate } from './health/useAnchorDate'
import { stepAnchor, labelForAnchor } from './health/dateNav'
import { todayStr } from '../../../shared/utils/dateUtils'
import type { HealthWorkout } from '../api/healthApi'
import { ChevronDown, ChevronRight, Smartphone } from 'lucide-react'
import { Card, EmptyState, Skeleton } from '../../../shared/ui'
import { fmtDateEnGB } from '../../../shared/utils/enGBDate'

// Apple Health-inspired browse view: activity rings + dedicated sections per
// metric group (steps/energy/heart/sleep/body). Every HealthKit metric we
// know about now has a home in one of these sections (main widget or
// mini-metric grid) — there's no longer a generic catch-all table.

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return fmtDateEnGB(new Date(iso), { day: 'numeric', month: 'short' })
}

function fmtDuration(seconds: number | null): string {
  if (!seconds) return '—'
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

// A workout carries far more inside `raw` than the summary shows (HR curve,
// GPS route, cadence, distance, weather, HR recovery). The whole row is a
// button that opens HealthWorkoutDetail to surface it.
function HealthWorkoutRow({ workout, onOpen }: { workout: HealthWorkout; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-[60px] w-full items-center gap-2 rounded-row border border-line bg-surface py-2.5 pl-3 pr-2 text-left transition-colors hover:bg-surface-hover"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <span className="truncate text-body font-semibold text-fg">{workout.name}</span>
          <span className="shrink-0 whitespace-nowrap text-body font-semibold tabular-nums text-fg-2">
            {fmtDuration(workout.duration_seconds)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-meta tabular-nums text-fg-muted">{fmtDate(workout.start_time)}</span>
          {workout.avg_heart_rate != null && (
            <span className="chip tabular-nums">avg {Math.round(workout.avg_heart_rate)} bpm</span>
          )}
          {/* HAE sends workout energy in kcal (units:"kcal"), despite the
              column being named *_kj — label it correctly (was a wrong "kJ"). */}
          {workout.active_energy_kj != null && (
            <span className="chip tabular-nums">{Math.round(workout.active_energy_kj)} kcal</span>
          )}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-fg-faint" aria-hidden />
    </button>
  )
}

function WorkoutsList() {
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<HealthWorkout | null>(null)
  const { data: workouts = [], isLoading } = useHealthWorkouts({ limit: 20 })
  return (
    <Card padded={false} className="max-w-3xl overflow-hidden">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(e => !e)}
        className="flex min-h-[44px] w-full items-center justify-between px-4 py-2"
      >
        <p className="section-label">
          Health workouts (Apple Health) {workouts.length > 0 && `· ${workouts.length}`}
        </p>
        <ChevronDown aria-hidden className={`h-4 w-4 text-fg-faint transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="px-4 pb-4">
          {isLoading ? (
            <div className="space-y-1.5">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} rounded="rounded-row" className="h-[60px]" />)}
            </div>
          ) : workouts.length === 0 ? (
            <EmptyState bordered icon={<Smartphone />} title="No workouts synced yet" className="py-10" />
          ) : (
            <div className="flex flex-col gap-1.5">
              {workouts.map(w => <HealthWorkoutRow key={w.id} workout={w} onOpen={() => setSelected(w)} />)}
            </div>
          )}
        </div>
      )}
      {selected && <HealthWorkoutDetail workout={selected} onClose={() => setSelected(null)} />}
    </Card>
  )
}

// ─── Section navigation ─────────────────────────────────────────────────────

interface Props {
  // Controlled by TrainingPage so the right-rail stats panel can show
  // analysis for whichever Health section is active — the training calendar
  // isn't relevant here, so that space is reclaimed for per-section stats.
  section?: SectionId
  onSectionChange?: (s: SectionId) => void
  /** Lifted by TrainingPage so the right-rail HealthStatsPanel — a sibling of
   *  this component — can describe the SAME window. Kept optional so the tab
   *  still works standalone. */
  range?: HealthRange
}

export function HealthTab({ section: controlledSection, onSectionChange, range: controlledRange }: Props = {}) {
  const [localSection, setLocalSection] = useState<SectionId>('overview')
  const section = controlledSection ?? localSection
  const setSection = onSectionChange ?? setLocalSection

  // ONE day + period selection for the whole Health tab, owned here and
  // rendered above the section pills. Was per-section state: Steps, Energy,
  // Heart and Sleep each held their own anchor/period and rendered their own
  // DateNav inside the section body, so changing the day in one left the
  // others on a different date, the control sat at a different scroll depth
  // in every section, and Overview/Body had no day control at all. Switching
  // section now keeps the day you were looking at.
  const today = todayStr()
  const [localAnchor, setLocalAnchor] = useAnchorDate()
  const [localPeriod, setLocalPeriod] = useState<Period>('week')
  const range: HealthRange = controlledRange ?? {
    anchor: localAnchor, setAnchor: setLocalAnchor,
    period: localPeriod, setPeriod: setLocalPeriod,
  }
  const { anchor, setAnchor, period, setPeriod } = range

  // The pill strip scrolls on a phone and the right-edge fade paints over
  // whatever sits under it — an ACTIVE (near-black) pill under that gradient
  // reads as a corrupted button. Keep the active pill scrolled into view so it
  // is never the thing being faded, on mount as well as on change.
  const activePillRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activePillRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [section])

  return (
    <div className="flex flex-col gap-4">
      {/* The ONE day/period control for every section, above the pills so it
          reads as "which day am I looking at" for the whole tab rather than a
          per-section setting. Changing the period resets to today, matching
          the behaviour each section had on its own before. SourceToggle
          deliberately stays per-section — it's a display choice about that
          section's own chart (Auto/Apple/Google), not a page-wide one. */}
      <div className="flex items-center gap-2 flex-wrap">
        <DateNav
          label={labelForAnchor(period, anchor)}
          onPrev={() => setAnchor(a => stepAnchor(period, a, -1))}
          onNext={() => setAnchor(a => stepAnchor(period, a, 1))}
          canGoNext={anchor !== today}
          value={anchor}
          onPick={setAnchor}
        />
        <PeriodToggle value={period} onChange={p => { setPeriod(p); setAnchor(today) }} />
      </div>

      {/* Section pills — a right-edge fade cues the strip scrolls on a phone
          (mobile only; all pills fit on desktop). */}
      <div role="tablist" aria-label="Health sections" className="scroll-x -mx-1 flex gap-1 px-1">
        {SECTIONS.map(s => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={section === s.id}
            ref={section === s.id ? activePillRef : undefined}
            onClick={() => setSection(s.id)}
            className="pill-tab shrink-0 gap-1.5 px-3"
          >
            <s.icon className="h-4 w-4" aria-hidden />{s.label}
          </button>
        ))}
      </div>

      {section === 'overview' && (
        <div className="flex flex-col gap-3">
          <ActivityRings dateStr={anchor} />
          <WorkoutsList />
        </div>
      )}
      {section === 'steps'  && <StepsSection  range={range} />}
      {section === 'energy' && <EnergySection range={range} />}
      {section === 'heart'  && <HeartSection  range={range} />}
      {section === 'sleep'  && <SleepSection  range={range} />}
      {section === 'body'   && <BodySection   range={range} />}
    </div>
  )
}
