import { useState } from 'react'
import { useHevyPRs } from '../hooks/useHevyPRs'
import { fmtTrainingDate as formatDate } from '../dateFormat'
import { ExerciseThumb } from '../exerciseMedia'

// ─────────────────────────────────────────────────────────────────────────────
//  DENSITY PILOT — this tab demonstrates the HOVER-PEEK strategy ("detail on
//  demand"): rows are one dense line each (3-4× more PRs per screen than the
//  old two-line rows), and everything secondary (demo GIF, muscle, estimated
//  1RM, date) lives in a peek card that appears on hover (desktop) or tap
//  (mobile) — permanent screen space is spent ONLY on the decision-relevant
//  numbers. Compare with Muscles (container queries), Workouts (density
//  toggle) and Body (all strategies combined).
// ─────────────────────────────────────────────────────────────────────────────

// Epley estimate — the standard "what's my 1-rep max" formula from a
// weight×reps set. Rough by nature; labelled "est" in the UI.
function est1RM(weightKg: number, reps: number | null): number | null {
  if (reps == null || reps <= 0) return null
  if (reps === 1) return weightKg
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10
}

export function HevyPRList() {
  const { data: prs, isLoading } = useHevyPRs()
  const [activeGroup, setActiveGroup] = useState<string>('All')
  const [query, setQuery] = useState('')
  // Which PR's peek card is open — hover on desktop, tap on mobile.
  const [peekId, setPeekId] = useState<string | null>(null)


  if (isLoading) {
    return <p className="text-sm text-ink-500 py-4">Loading PRs…</p>
  }

  if (!prs || prs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-ink-400">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-3-3v6m9-6a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-sm">No PRs yet — sync your Hevy data first</p>
      </div>
    )
  }

  const muscleGroups = Array.from(
    new Set(prs.map(pr => pr.primary_muscle_group).filter(Boolean) as string[])
  ).sort()

  const groupFiltered = activeGroup === 'All'
    ? prs
    : prs.filter(pr => pr.primary_muscle_group === activeGroup)

  // Live substring match, not prefix-only — searching "zzz" must still find
  // "XXX ZZZ YYY" since the matching word can be anywhere in the title.
  const q = query.trim().toLowerCase()
  const filtered = q ? groupFiltered.filter(pr => pr.title.toLowerCase().includes(q)) : groupFiltered

  const sorted = [...filtered].sort(
    (a, b) => new Date(b.achieved_at).getTime() - new Date(a.achieved_at).getTime()
  )

  return (
    <div className="flex flex-col gap-3">
      {/* Info banner — content-sized, not a full-monitor-width band */}
      <div className="flex items-center gap-2 px-3 py-2 bg-accent-50 border border-accent-200 rounded-xl w-fit max-w-full">
        <span className="text-sm leading-none">🏆</span>
        <p className="text-xs text-accent-700 font-medium">All-time heaviest lift per exercise, sorted by most recent. Weights in kg.</p>
      </div>

      {/* Search — a text box never needs 1900px */}
      <input
        type="text"
        inputMode="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search exercises… (e.g. press, curl)"
        className="w-full max-w-md min-h-[44px] px-3 rounded-xl border border-ink-200 text-sm placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-300"
      />

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        {['All', ...muscleGroups].map(group => (
          <button
            key={group}
            onClick={() => setActiveGroup(group)}
            className={`min-h-[44px] px-2.5 py-0.5 rounded-full text-xs font-medium capitalize transition-colors ${
              activeGroup === group
                ? 'bg-accent-600 text-white'
                : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
            }`}
          >
            {group}
          </button>
        ))}
      </div>

      {/* PR list — dense single-line rows in an auto-packing grid; details
          peek on hover/tap instead of occupying permanent rows. */}
      {sorted.length === 0 && (
        <p className="text-sm text-ink-400 py-6 text-center">No exercises match “{query}”.</p>
      )}
      {/* HORIZONTAL fix: fixed-width columns (15–18rem each) via auto-fill —
          column count derives from available width, rows never stretch to
          fill a monitor, leftover space stays empty on the right. */}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,18rem))] gap-x-3 justify-start">
        {sorted.map(pr => {
          const isOpen = peekId === pr.exercise_template_id
          return (
            <li
              key={pr.exercise_template_id}
              className="relative"
              onMouseEnter={() => setPeekId(pr.exercise_template_id)}
              onMouseLeave={() => setPeekId(p => (p === pr.exercise_template_id ? null : p))}
            >
              <button
                type="button"
                onClick={() => setPeekId(isOpen ? null : pr.exercise_template_id)}
                className={`w-full flex items-center justify-between gap-2 py-1.5 min-h-[44px] px-1.5 rounded-lg text-left transition-colors ${
                  isOpen ? 'bg-cream-100' : 'hover:bg-cream-50'
                }`}
              >
                <span className="font-medium text-xs text-ink-900 truncate">{pr.title}</span>
                <span className="text-xs font-semibold text-ink-700 tabular-nums shrink-0">
                  {pr.max_weight_kg}<span className="text-ink-400 font-normal"> kg</span>
                  {pr.reps_at_max != null && <span className="text-ink-400 font-normal"> ×{pr.reps_at_max}</span>}
                </span>
              </button>

              {/* Peek card — GIF + everything secondary, zero permanent cost */}
              {isOpen && (
                <div className="absolute z-30 left-0 right-0 top-full mt-1 p-3 rounded-xl border border-ink-200 bg-cream-50 shadow-xl flex items-start gap-3 animate-fadeSlideIn">
                  <ExerciseThumb title={pr.title} size={72} />
                  <div className="flex flex-col gap-1 min-w-0 text-xs">
                    <span className="font-semibold text-ink-900">{pr.title}</span>
                    {pr.primary_muscle_group && (
                      <span className="w-fit bg-ink-100 text-ink-500 rounded-full px-2 py-0.5 capitalize">{pr.primary_muscle_group}</span>
                    )}
                    <span className="text-ink-700">
                      Best: <strong>{pr.max_weight_kg} kg{pr.reps_at_max != null ? ` × ${pr.reps_at_max}` : ''}</strong>
                    </span>
                    {est1RM(pr.max_weight_kg, pr.reps_at_max) != null && (
                      <span className="text-ink-500">est. 1RM ≈ <strong className="text-ink-700">{est1RM(pr.max_weight_kg, pr.reps_at_max)} kg</strong></span>
                    )}
                    <span className="text-ink-400">{formatDate(pr.achieved_at)}</span>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
