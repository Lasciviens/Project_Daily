import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button, SectionLabel, Skeleton, Truncate, cx } from '../../../shared/ui'
import { todayStr } from '../../../shared/utils/dateUtils'
import type { FbMatch } from '../footballModel'
import { byDayAndLeague, dayLabel, type LeagueGroup } from '../footballView'
import { MatchRow } from './MatchRow'

/** A day of the list in rem: its heading (1 + 0.25), a competition's label (1.25) and three 2.5rem rows. */
const DAY_REM = 10
const DAY_GAP_REM = 0.75

/**
 * The list's loading copy on its own spacing: a day's heading, a competition's label and match rows (a
 * competition shows three before it folds), as many days as fit `rem` — the room the list keeps while ESPN
 * answers (FootballPage) — with `rows` rows in a short one.
 */
export function MatchListSkeleton({ rem, rows = 3 }: { rem: number; rows?: number }) {
  const days = Math.max(1, Math.floor((rem + DAY_GAP_REM) / (DAY_REM + DAY_GAP_REM)))
  return (
    <div aria-hidden className="flex max-w-[40rem] flex-col gap-3">
      {Array.from({ length: days }, (_, d) => (
        <div key={d} className="flex flex-col gap-1">
          <span className="flex h-4 items-center"><Skeleton className="h-3 w-28" /></span>
          <div className="flex flex-col">
            <span className="flex h-5 items-end px-3"><Skeleton className="h-2.5 w-24" /></span>
            {Array.from({ length: days > 1 ? 3 : rows }, (_, r) => <span key={r} className="flex h-10 items-center px-3 [@media(pointer:coarse)]:h-11"><Skeleton className="h-3.5 w-full" /></span>)}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Matches by day ("Today", "Wed 21.10.2026") and, inside a day, by
 * competition. A followed team's match always shows; the rest of a busy
 * competition folds into "Champions League · 8 more", opened in place
 * (footballView.byDayAndLeague). The first `days` days show; "Show all" opens
 * the rest.
 */
export function MatchList({ matches, planned, featured, keep = 3, days = 6 }: {
  matches: readonly FbMatch[]
  planned: ReadonlyMap<string, string>
  /** Followed teams: their matches are never folded away. */
  featured: ReadonlySet<string>
  /** How many of a competition's matches show when no followed team plays in it (Infinity: all). */
  keep?: number
  days?: number
}) {
  const [all, setAll] = useState(false)
  const grouped = byDayAndLeague(matches, featured, keep)
  const shown = all ? grouped : grouped.slice(0, days)
  const today = todayStr()
  return (
    <div className="flex max-w-[40rem] flex-col gap-3">
      {shown.map(day => (
        <section key={day.date} className="flex flex-col gap-1">
          <h3 className="text-meta font-semibold text-fg-muted tabular-nums">{dayLabel(day.date, today)}</h3>
          {day.leagues.map(g => <Competition key={g.league} group={g} planned={planned} />)}
        </section>
      ))}
      {grouped.length > days && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setAll(v => !v)}>
          {all ? 'Show fewer days' : `Show all ${grouped.length} days`}
        </Button>
      )}
    </div>
  )
}

function Competition({ group, planned }: { group: LeagueGroup; planned: ReadonlyMap<string, string> }) {
  const [open, setOpen] = useState(false)
  const rows = open ? [...group.matches, ...group.more] : group.matches
  return (
    <div className="flex flex-col">
      <SectionLabel className="px-3 pt-1"><Truncate>{group.name}</Truncate></SectionLabel>
      {rows.map(m => <MatchRow key={m.id} match={m} planned={planned.has(m.id)} />)}
      {group.more.length > 0 && (
        <button
          type="button" aria-expanded={open} onClick={() => setOpen(v => !v)}
          className="row row-interactive w-full justify-center gap-1 text-meta font-medium text-fg-muted"
        >
          <Truncate>{open ? 'Fewer' : `${group.more.length} more`}</Truncate>
          <ChevronDown aria-hidden className={cx('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
        </button>
      )}
    </div>
  )
}
