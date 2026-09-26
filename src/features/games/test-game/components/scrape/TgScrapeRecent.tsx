import { useState } from 'react'
import { ChevronDown, Undo2 } from 'lucide-react'
import { useRecentRuns, useUndoScrape } from '../../../scraper/useScrape'
import { formatDay } from '../../testGameModel'

// "26 Sep 2026, 08:10" — the day via formatDay (CLDR would print "Sept").
const when = (iso: string) => {
  const d = new Date(iso)
  return `${formatDay(iso)}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * The last saves, one per run, each with Undo — read from the journal, so an
 * undo never depends on still being on the screen that made the save.
 */
export function TgScrapeRecent() {
  const [open, setOpen] = useState(false)
  const runs = useRecentRuns(true)
  const undo = useUndoScrape()
  const list = runs.data ?? []
  if (!list.length) return null
  const live = list.filter(r => !r.undone)
  return (
    <section className="tg-panel">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex min-h-[48px] w-full items-center justify-between gap-3 px-4 text-left">
        <span className="tg-section-label">Recent saves · {live.length}</span>
        <ChevronDown className={`h-4 w-4 tg-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <ul className="flex flex-col divide-y divide-[var(--tg-border)] border-t border-[var(--tg-border)]">
          {list.map(r => (
            <li key={r.run_id} className="flex items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">
                  {r.games.length === 1 ? (r.games[0].title ?? 'One game') : `${r.games.length} games`}
                </p>
                <p className="text-[11.5px] tg-muted">{when(r.created_at)}{r.undone ? ' · undone' : ''}</p>
              </div>
              {!r.undone && (
                <button
                  type="button"
                  onClick={() => undo.mutate({ runId: r.run_id, gameIds: r.games.map(g => g.game_id) })}
                  disabled={undo.isPending}
                  className="tg-btn tg-btn-secondary shrink-0 !px-3 !text-[12.5px]"
                >
                  <Undo2 className="h-4 w-4" aria-hidden /> Undo
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
