import { useState } from 'react'
import { useHevyPRs } from '../hooks/useHevyPRs'
import { fmtTrainingDate as formatDate } from '../dateFormat'

export function HevyPRList() {
  const { data: prs, isLoading } = useHevyPRs()
  const [activeGroup, setActiveGroup] = useState<string>('All')
  const [query, setQuery] = useState('')


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
      {/* Info banner */}
      <div className="flex items-center gap-2 px-3 py-2 bg-accent-50 border border-accent-200 rounded-xl">
        <span className="text-sm leading-none">🏆</span>
        <p className="text-xs text-accent-700 font-medium">All-time heaviest lift per exercise, sorted by most recent. Weights in kg.</p>
      </div>

      {/* Search */}
      <input
        type="text"
        inputMode="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search exercises… (e.g. press, curl)"
        className="w-full min-h-[44px] px-3 rounded-xl border border-ink-200 text-sm placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-300"
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

      {/* PR list */}
      {sorted.length === 0 && (
        <p className="text-sm text-ink-400 py-6 text-center">No exercises match “{query}”.</p>
      )}
      <ul>
        {sorted.map(pr => (
          <li
            key={pr.exercise_template_id}
            className="flex items-center justify-between gap-3 py-2 border-b border-ink-100 last:border-0"
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
