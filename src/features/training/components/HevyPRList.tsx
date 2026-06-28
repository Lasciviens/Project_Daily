import { useState } from 'react'
import { useHevyPRs } from '../hooks/useHevyPRs'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function HevyPRList() {
  const { data: prs, isLoading } = useHevyPRs()
  const [activeGroup, setActiveGroup] = useState<string>('All')


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

  const filtered = activeGroup === 'All'
    ? prs
    : prs.filter(pr => pr.primary_muscle_group === activeGroup)

  const sorted = [...filtered].sort(
    (a, b) => new Date(b.achieved_at).getTime() - new Date(a.achieved_at).getTime()
  )

  return (
    <div className="flex flex-col gap-3">
      {/* Info banner */}
      <div className="flex items-start gap-2.5 px-3 py-2.5 bg-accent-50 border border-accent-200 rounded-xl">
        <span className="text-base leading-none mt-0.5">🏆</span>
        <div>
          <p className="text-sm font-semibold text-accent-800">Personal Records</p>
          <p className="text-xs text-accent-600 mt-0.5">Your all-time heaviest lift for each exercise, sorted by most recent. Weights in kg.</p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        {['All', ...muscleGroups].map(group => (
          <button
            key={group}
            onClick={() => setActiveGroup(group)}
            className={`min-h-[44px] px-3 py-1 rounded-full text-sm font-medium capitalize transition-colors ${
              activeGroup === group
                ? 'bg-accent-500 text-white'
                : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
            }`}
          >
            {group}
          </button>
        ))}
      </div>

      {/* PR list */}
      <ul>
        {sorted.map(pr => (
          <li
            key={pr.exercise_template_id}
            className="flex items-center justify-between gap-3 py-3 border-b border-ink-100 last:border-0"
          >
            <div className="flex flex-col gap-1 min-w-0">
              <span className="font-medium text-sm text-ink-900 truncate">{pr.title}</span>
              {pr.primary_muscle_group && (
                <span className="inline-block w-fit text-xs bg-ink-100 text-ink-500 rounded-full px-2 py-0.5 capitalize">
                  {pr.primary_muscle_group}
                </span>
              )}
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <span className="text-sm font-medium text-ink-800">
                {pr.max_weight_kg} kg{pr.reps_at_max != null ? ` × ${pr.reps_at_max} reps` : ''}
              </span>
              <span className="text-xs text-ink-400">{formatDate(pr.achieved_at)}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
