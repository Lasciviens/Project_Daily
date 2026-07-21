import { useState } from 'react'
import { useHealthWorkouts } from '../hooks/useHealthExport'
import { ActivityRings } from './health/ActivityRings'
import { HealthWorkoutDetail } from './health/HealthWorkoutDetail'
import { StepsSection } from './health/StepsSection'
import { EnergySection } from './health/EnergySection'
import { HeartSection } from './health/HeartSection'
import { SleepSection } from './health/SleepSection'
import { BodySection } from './health/BodySection'
import { SECTIONS, type SectionId } from './health/sectionTypes'
import type { HealthWorkout } from '../api/healthApi'
import { FitbitSyncButton } from './health/FitbitSyncButton'

// Apple Health-inspired browse view: activity rings + dedicated sections per
// metric group (steps/energy/heart/sleep/body). Every HealthKit metric we
// know about now has a home in one of these sections (main widget or
// mini-metric grid) — there's no longer a generic catch-all table.

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
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
      className="w-full text-left rounded-xl border border-ink-100 bg-cream-50 min-h-[60px] flex overflow-hidden hover:border-accent-300 transition-colors"
    >
      <div className="w-1 shrink-0 bg-blue-400" />
      <div className="flex-1 px-3 py-2.5 flex flex-col gap-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <span className="text-sm font-bold text-ink-900 truncate">{workout.name}</span>
          <span className="text-sm font-semibold text-ink-700 whitespace-nowrap shrink-0">
            {fmtDuration(workout.duration_seconds)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-500">{fmtDate(workout.start_time)}</span>
          {workout.avg_heart_rate != null && (
            <span className="text-[11px] font-medium bg-ink-100 text-ink-500 rounded-full px-2 py-0.5">
              avg {Math.round(workout.avg_heart_rate)} bpm
            </span>
          )}
          {/* HAE sends workout energy in kcal (units:"kcal"), despite the
              column being named *_kj — label it correctly (was a wrong "kJ"). */}
          {workout.active_energy_kj != null && (
            <span className="text-[11px] font-medium bg-ink-100 text-ink-500 rounded-full px-2 py-0.5">
              {Math.round(workout.active_energy_kj)} kcal
            </span>
          )}
          <span className="text-[11px] text-ink-300 ml-auto">Details →</span>
        </div>
      </div>
    </button>
  )
}

function WorkoutsList() {
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<HealthWorkout | null>(null)
  const { data: workouts = [], isLoading } = useHealthWorkouts({ limit: 20 })
  return (
    <div className="bg-cream-50 border border-ink-200 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 min-h-[44px] py-2"
      >
        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-500">
          🏃 Health Workouts (Apple Health / Huawei) {workouts.length > 0 && `· ${workouts.length}`}
        </p>
        <span className="text-ink-400 text-xs">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-4">
          {isLoading ? (
            <div className="space-y-1.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-[60px] rounded-xl bg-cream-200 animate-pulse" />
              ))}
            </div>
          ) : workouts.length === 0 ? (
            <div className="text-center py-10 border border-dashed border-ink-200 rounded-xl">
              <p className="text-2xl mb-2">📱</p>
              <p className="text-ink-600 font-medium text-sm">No workouts synced yet</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {workouts.map(w => <HealthWorkoutRow key={w.id} workout={w} onOpen={() => setSelected(w)} />)}
            </div>
          )}
        </div>
      )}
      {selected && <HealthWorkoutDetail workout={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

// ─── Section navigation ─────────────────────────────────────────────────────

interface Props {
  // Controlled by TrainingPage so the right-rail stats panel can show
  // analysis for whichever Health section is active — the training calendar
  // isn't relevant here, so that space is reclaimed for per-section stats.
  section?: SectionId
  onSectionChange?: (s: SectionId) => void
}

export function HealthTab({ section: controlledSection, onSectionChange }: Props = {}) {
  const [localSection, setLocalSection] = useState<SectionId>('overview')
  const section = controlledSection ?? localSection
  const setSection = onSectionChange ?? setLocalSection

  return (
    <div className="flex flex-col gap-4">
      {/* Section pills — a right-edge fade cues the strip scrolls on a phone
          (mobile only; all pills fit on desktop). */}
      <div className="relative">
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none snap-x-mandatory pb-1">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className={`min-h-[44px] px-3 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1.5 transition-colors press-feedback snap-start ${
                section === s.id ? 'bg-ink-950 text-white' : 'bg-cream-50 border border-ink-200 text-ink-600 hover:bg-ink-50'
              }`}
            >
              <span>{s.icon}</span>{s.label}
            </button>
          ))}
          <FitbitSyncButton />
        </div>
        <div
          className="sm:hidden pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-canvas to-transparent"
          aria-hidden
        />
      </div>

      {section === 'overview' && (
        <div className="flex flex-col gap-3">
          <ActivityRings />
          <WorkoutsList />
        </div>
      )}
      {section === 'steps' && <StepsSection />}
      {section === 'energy' && <EnergySection />}
      {section === 'heart' && <HeartSection />}
      {section === 'sleep' && <SleepSection />}
      {section === 'body' && <BodySection />}
    </div>
  )
}
