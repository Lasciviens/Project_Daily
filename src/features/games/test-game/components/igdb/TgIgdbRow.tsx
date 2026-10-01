import { useState, type ReactNode } from 'react'
import { Check, ExternalLink, Search } from 'lucide-react'
import { platformInfo, type TgGame } from '../../testGameModel'
import { useIgdbBatch, type IgdbRowState } from '../../../igdb/igdbBatchStore'
import { formatLength, igdbPageUrl, rankCandidates, searchQuery, type ScoredCandidate } from '../../../igdb/igdbMatch'
import { useIgdbSearch } from '../../../igdb/useIgdb'
import { matchTarget } from '../../../igdb/useIgdbRunner'
import { TgCover } from '../TgCover'
import { TgIgdbCandidate } from './TgIgdbCandidate'
import { isIgdbMatched } from './tgIgdbModel'
import { Truncate } from '../../../../../shared/ui/Truncate'

function lengthLine(g: TgGame): string | null {
  const parts = [
    formatLength(g.ttb_main_seconds) && `${formatLength(g.ttb_main_seconds)} to finish`,
    formatLength(g.ttb_full_seconds) && `${formatLength(g.ttb_full_seconds)} for 100 %`,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

/** One library game on the IGDB page. */
export function TgIgdbRow({ game: g, row, ticked, busy, open, onToggle, onLookUp, onSavePick }: {
  game: TgGame
  row: IgdbRowState | undefined
  ticked: boolean
  busy: boolean
  open: boolean
  onToggle: () => void
  onLookUp: () => void
  onSavePick: (c: ScoredCandidate) => Promise<boolean>
}) {
  const set = useIgdbBatch(s => s.set)
  const patchRows = useIgdbBatch(s => s.patchRows)
  const d = row?.decision
  const matched = isIgdbMatched(g)
  const tickable = !!row?.pick && !row.saved && !busy && !matched
  const Row = tickable ? 'label' : 'div'
  const page = igdbPageUrl(g)

  let status: ReactNode
  if (row?.saved) status = <span className="flex items-center gap-1 text-[11.5px] font-semibold text-[var(--tg-green)]"><Check className="h-3.5 w-3.5" aria-hidden /> Saved{row.saved.name ? ` · ${row.saved.name}` : ''}</span>
  else if (matched) status = <Truncate className="text-[11.5px] tg-muted">{`Matched${g.igdb_match === 'steam' ? ' by Steam id' : ''} · ${lengthLine(g) ?? 'no length on IGDB'}${g.igdb_total_rating != null ? ` · score ${Math.round(g.igdb_total_rating)}` : ''}`}</Truncate>
  else if (row?.error) status = <Truncate className="text-[11.5px] text-[var(--tg-red)]">{`${row.error} — try again`}</Truncate>
  else if (busy) status = <span className="text-[11.5px] tg-muted">Looking up…</span>
  else if (!d) status = <span className="text-[11.5px] tg-muted">Not looked up</span>
  else if (d.status === 'none') status = <span className="text-[11.5px] tg-muted">No match on IGDB — search by hand</span>

  return (
    <li className="tg-panel flex flex-col gap-2 p-2">
      <div className="flex items-center gap-2">
        <Row className={`flex min-w-0 flex-1 items-center gap-3 ${tickable ? 'cursor-pointer' : ''}`}>
          <span className="grid h-11 w-8 shrink-0 place-items-center">
            {tickable && (
              <input type="checkbox" checked={ticked} onChange={e => set({ ticked: { ...useIgdbBatch.getState().ticked, [g.id]: e.target.checked } })}
                aria-label={`Save ${row?.pick?.name ?? 'match'} for ${g.title}`} className="h-5 w-5 accent-[var(--tg-accent)]" />
            )}
          </span>
          <span className="relative h-[52px] w-[38px] shrink-0"><TgCover game={g} mode="natural" align="center" /></span>
          <span className="min-w-0 flex-1">
            <Truncate className="text-[13px] font-semibold">{g.title}</Truncate>
            <Truncate className="text-[11.5px] tg-muted">{[platformInfo(g.platformKey).name, g.release_year].filter(Boolean).join(' · ')}</Truncate>
            {status}
            {!matched && !row?.saved && row?.pick && d?.status !== 'none' && (
              <span className="mt-1 block"><TgIgdbCandidate c={row.pick} /></span>
            )}
            {row?.saveError && <span className="block text-[11.5px] text-[var(--tg-red)]">{row.saveError}</span>}
          </span>
        </Row>
        <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center">
          {page && (matched || row?.saved) && (
            <a href={page} target="_blank" rel="noreferrer" className="tg-btn tg-btn-secondary !px-3 !text-[12.5px]" aria-label={`Open ${g.title} on IGDB`}>
              IGDB <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          )}
          {!d && !matched && !row?.saved && (
            <button type="button" onClick={onLookUp} disabled={busy} className="tg-btn tg-btn-secondary !px-3 !text-[12.5px]">Find</button>
          )}
          <button type="button" onClick={onToggle} aria-expanded={open} className="tg-btn tg-btn-secondary !px-3 !text-[12.5px]">
            {open ? 'Close' : matched || row?.saved ? 'Change' : d && d.candidates.length > 1 ? `Results (${d.candidates.length})` : 'Search'}
          </button>
        </div>
      </div>
      {open && (
        <TgIgdbPicker game={g} row={row} onPick={async c => {
          // From a lookup's own results a pick only replaces the tick target;
          // a matched game or a hand search saves at once.
          if (!matched && !row?.saved && d?.candidates.some(x => x.id === c.id)) {
            patchRows({ [g.id]: { pick: c } })
            set({ ticked: { ...useIgdbBatch.getState().ticked, [g.id]: true } })
            onToggle()
            return
          }
          if (await onSavePick(c)) onToggle()
        }} />
      )}
    </li>
  )
}

function TgIgdbPicker({ game, row, onPick }: { game: TgGame; row: IgdbRowState | undefined; onPick: (c: ScoredCandidate) => void }) {
  const [text, setText] = useState(() => searchQuery(game.title))
  const [query, setQuery] = useState('')
  const search = useIgdbSearch(query)
  const found = search.data ? rankCandidates(matchTarget(game), search.data) : null
  const list = found ?? row?.decision?.candidates ?? []
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-[var(--tg-panel-2)] p-2">
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); setQuery(text) }}>
        <input value={text} onChange={e => setText(e.target.value)} aria-label="Search IGDB"
          className="tg-input min-w-0 flex-1 px-3" />
        <button type="submit" className="tg-btn tg-btn-secondary shrink-0 !px-3" disabled={text.trim().length < 2}>
          <Search className={`h-4 w-4 ${search.isFetching ? 'animate-pulse' : ''}`} aria-hidden /> Search
        </button>
      </form>
      {search.error && <p className="text-[12px] text-[var(--tg-red)]">{(search.error as Error).message}</p>}
      {found && found.length === 0 && <p className="text-[12px] tg-muted">Nothing on IGDB for “{query}”.</p>}
      <ul className="flex flex-col gap-1">
        {list.slice(0, 8).map(c => (
          <li key={c.id} className="flex items-center gap-2 rounded-lg bg-[var(--tg-panel)] p-2">
            <span className="min-w-0 flex-1"><TgIgdbCandidate c={c} /></span>
            <button type="button" onClick={() => onPick(c)} className="tg-btn tg-btn-primary shrink-0 !px-3 !text-[12.5px]">Use this</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
