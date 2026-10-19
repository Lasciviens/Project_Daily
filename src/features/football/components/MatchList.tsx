import { useState } from 'react'
import { Button, SectionLabel, Truncate } from '../../../shared/ui'
import { todayStr } from '../../../shared/utils/dateUtils'
import type { FbMatch } from '../footballModel'
import { byDayAndLeague, dayLabel } from '../footballView'
import { MatchRow } from './MatchRow'

/**
 * Matches by day ("Today", "Wed 21.10.2026") and, inside a day, by
 * competition. The first `limit` show; "Show all" opens the rest in place.
 */
export function MatchList({ matches, planned, limit = 8 }: {
  matches: readonly FbMatch[]; planned: ReadonlyMap<string, string>; limit?: number
}) {
  const [all, setAll] = useState(false)
  const shown = all ? matches : matches.slice(0, limit)
  const today = todayStr()
  return (
    <div className="flex max-w-[40rem] flex-col gap-3">
      {byDayAndLeague(shown).map(day => (
        <section key={day.date} className="flex flex-col gap-1">
          <h3 className="text-meta font-semibold text-fg-muted tabular-nums">{dayLabel(day.date, today)}</h3>
          {day.leagues.map(g => (
            <div key={g.league} className="flex flex-col">
              <SectionLabel className="px-3 pt-1"><Truncate>{g.name}</Truncate></SectionLabel>
              {g.matches.map(m => <MatchRow key={m.id} match={m} planned={planned.has(m.id)} />)}
            </div>
          ))}
        </section>
      ))}
      {matches.length > limit && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setAll(v => !v)}>
          {all ? 'Show fewer' : `Show all ${matches.length}`}
        </Button>
      )}
    </div>
  )
}
