import { useMemo, useState } from 'react'
import { Check, Search, Undo2, Wand2 } from 'lucide-react'
import { platformInfo, type TgGame } from '../../testGameModel'
import type { ApplyResult, FindResult } from '../../../scraper/ssApi'
import { useApplyBatch, useFindBatch, useScrapePrefs, useUndoScrape } from '../../../scraper/useScrape'
import { modeCounts } from '../../../scraper/ssPlan'
import { TgBasisBadges, TgCandidateCover, TgFlagChips, TgScrapeCard } from './TgScrapeParts'
import { TgCover } from '../TgCover'
import { primaryVariant } from './tgScrapeModel'

type Filter = 'todo' | 'no_cover' | 'no_desc' | 'all'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'todo', label: 'Not scraped' }, { key: 'no_cover', label: 'No cover' }, { key: 'no_desc', label: 'No description' }, { key: 'all', label: 'All' },
]
const FIND_CHUNK = 10
const APPLY_CHUNK = 5

function matches(g: TgGame, f: Filter) {
  if (f === 'todo') return g.external_source !== 'screenscraper'
  if (f === 'no_cover') return !g.primary_cover_url
  if (f === 'no_desc') return !g.description?.trim()
  return true
}

/**
 * Many games at once: find the best match for each (by ROM file when there is
 * one, else by name), tick the ones that are right, save them with your
 * defaults. Nothing is written until you press Save; exact ROM matches are
 * pre-ticked, name matches are not.
 */
export function TgScrapeBatch({ games, loading, onOpenGame }: { games: TgGame[]; loading: boolean; onOpenGame: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>('todo')
  const [system, setSystem] = useState('')
  const [found, setFound] = useState<Record<string, FindResult>>({})
  const [saved, setSaved] = useState<Record<string, ApplyResult>>({})
  const [ticked, setTicked] = useState<Record<string, boolean>>({})
  const [runId, setRunId] = useState<string | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const find = useFindBatch()
  const applyBatch = useApplyBatch()
  const undo = useUndoScrape()
  const { prefs } = useScrapePrefs()
  const counts = modeCounts(prefs)

  const systems = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of games) { const s = primaryVariant(g)?.esde_system; if (s) m.set(s, (m.get(s) ?? 0) + 1) }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [games])
  const list = useMemo(
    () => games.filter(g => matches(g, filter) && (!system || primaryVariant(g)?.esde_system === system)).sort((a, b) => a.title.localeCompare(b.title)),
    [games, filter, system],
  )
  const next = list.filter(g => !found[g.id] && !saved[g.id]).slice(0, FIND_CHUNK)
  const toSave = list.filter(g => ticked[g.id] && found[g.id]?.outcome === 'match' && !saved[g.id])

  const findNext = () => {
    if (!next.length) return
    find.mutate(next.map(g => g.id), {
      onSuccess: (r) => {
        if (r.status === 'quota_exhausted') { setRemaining(r.remaining_today ?? 0); return }
        const add: Record<string, FindResult> = {}
        const tick: Record<string, boolean> = {}
        for (const x of r.results ?? []) {
          add[x.game_id] = x
          if (x.outcome === 'match') tick[x.game_id] = x.basis !== 'name'
        }
        setFound(s => ({ ...s, ...add }))
        setTicked(s => ({ ...s, ...tick }))
        setRemaining(r.remaining_today ?? null)
      },
    })
  }

  const saveTicked = async () => {
    const run = runId ?? crypto.randomUUID()
    setRunId(run)
    for (let i = 0; i < toSave.length; i += APPLY_CHUNK) {
      const chunk = toSave.slice(i, i + APPLY_CHUNK)
      const items = chunk.map(g => {
        const f = found[g.id]!
        return { game_id: g.id, jeu_id: f.candidate!.jeu_id, system: f.system?.id ?? null, rom_filename: f.rom_filename ?? null, matched_by: f.candidate!.matched_by }
      })
      try {
        const r = await applyBatch.mutateAsync({ items, runId: run })
        setSaved(s => ({ ...s, ...Object.fromEntries(r.results.map(x => [x.game_id, x])) }))
        setRemaining(r.remaining_today ?? null)
      } catch { break } // the mutation already toasted
    }
  }

  const savedIds = Object.keys(saved).filter(id => saved[id].outcome === 'applied')

  return (
    <div className="flex flex-col gap-4">
      <TgScrapeCard title="Which games">
        <div role="group" aria-label="Show" className="tg-scroll-x -mx-1 flex gap-1.5 px-1">
          {FILTERS.map(f => (
            <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}
              className={`tg-tab !h-[36px] shrink-0 !px-3 !text-[12.5px] ${filter === f.key ? 'is-active' : 'bg-[var(--tg-panel-2)]'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <label className="mt-3 flex items-center justify-between gap-3 text-[13px]">
          <span className="font-medium">System</span>
          <select value={system} onChange={e => setSystem(e.target.value)} className="tg-input !w-auto max-w-[60%] px-3">
            <option value="">All systems</option>
            {systems.map(([s, n]) => <option key={s} value={s}>{platformInfo(s).name === s ? s : `${platformInfo(s).name} (${s})`} · {n}</option>)}
          </select>
        </label>
        <p className="mt-3 text-[12px] leading-snug tg-muted">
          {loading ? 'Loading…' : `${list.length} game${list.length === 1 ? '' : 's'}.`} Saving uses your defaults from “What to save”: {counts.store} image types saved, {counts.on_demand} linked{prefs.snapshot ? ', full record kept' : ''}, empty fields filled. Each lookup is one ScreenScraper request.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <button type="button" onClick={findNext} disabled={!next.length || find.isPending} className="tg-btn tg-btn-secondary">
            <Search className={`h-4 w-4 ${find.isPending ? 'animate-pulse' : ''}`} aria-hidden />
            {find.isPending ? 'Looking…' : next.length ? `Find matches for the next ${next.length}` : 'All looked up'}
          </button>
          <button type="button" onClick={saveTicked} disabled={!toSave.length || applyBatch.isPending} className="tg-btn tg-btn-primary">
            <Wand2 className={`h-4 w-4 ${applyBatch.isPending ? 'animate-pulse' : ''}`} aria-hidden />
            {applyBatch.isPending ? 'Saving…' : `Save ${toSave.length} ticked`}
          </button>
        </div>
        {remaining != null && <p className="mt-2 text-[11.5px] tabular-nums tg-faint">{remaining.toLocaleString('en-GB')} ScreenScraper requests left today</p>}
        {runId && savedIds.length > 0 && (
          <button type="button" onClick={() => undo.mutate({ runId, gameIds: savedIds }, { onSuccess: () => { setSaved({}); setRunId(null) } })}
            disabled={undo.isPending} className="mt-2 inline-flex min-h-[40px] items-center gap-1.5 text-[12.5px] font-semibold text-[var(--tg-accent)]">
            <Undo2 className="h-4 w-4" aria-hidden /> Undo this batch ({savedIds.length})
          </button>
        )}
      </TgScrapeCard>

      <ul className="flex flex-col gap-2">
        {list.slice(0, 200).map(g => {
          const f = found[g.id]
          const s = saved[g.id]
          const c = f?.candidate
          return (
            <li key={g.id} className="tg-panel flex items-center gap-3 p-2.5">
              {f?.outcome === 'match' && !s ? (
                <input type="checkbox" checked={!!ticked[g.id]} onChange={e => setTicked(t => ({ ...t, [g.id]: e.target.checked }))}
                  aria-label={`Save ${c?.values.title ?? 'match'} to ${g.title}`} className="h-5 w-5 shrink-0 accent-[var(--tg-accent)]" />
              ) : <span className="w-5 shrink-0" aria-hidden />}
              <span className="relative h-[52px] w-[38px] shrink-0"><TgCover game={g} mode="natural" align="center" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{g.title}</span>
                {!f && <span className="block truncate text-[11.5px] tg-muted">{platformInfo(g.platformKey).name} · not looked up</span>}
                {f && f.outcome !== 'match' && (
                  <span className="block truncate text-[11.5px] tg-muted">{f.outcome === 'no_match' ? 'No match' : f.outcome === 'unmatchable' ? (f.reason ?? 'Nothing to search with') : (f.reason ?? 'Error')}</span>
                )}
                {c && (
                  <span className="mt-0.5 flex min-w-0 items-center gap-2">
                    <TgCandidateCover candidate={c} regions={prefs.regions} width={80} className="h-[34px] w-[25px] shrink-0 overflow-hidden rounded" />
                    <span className="min-w-0">
                      <span className="block truncate text-[12px]">→ {String(c.values.title ?? '')} <span className="tg-muted">· {c.system.name ?? ''} {c.values.release_year ?? ''}</span></span>
                      <span className="flex flex-wrap gap-1"><TgBasisBadges basis={c.matched_by} /><TgFlagChips flags={c.flags} /></span>
                    </span>
                  </span>
                )}
                {s && (
                  <span className={`mt-0.5 flex items-center gap-1 text-[11.5px] font-semibold ${s.outcome === 'applied' ? 'text-[var(--tg-green)]' : 'text-[var(--tg-red)]'}`}>
                    {s.outcome === 'applied' ? <><Check className="h-3.5 w-3.5" aria-hidden /> Saved · {s.written?.length ?? 0} fields</> : (s.reason ?? s.outcome)}
                  </span>
                )}
              </span>
              <button type="button" onClick={() => onOpenGame(g.id)} className="tg-btn tg-btn-secondary !min-h-[40px] shrink-0 !px-3 !text-[12.5px]">Open</button>
            </li>
          )
        })}
        {list.length > 200 && <li className="py-2 text-center text-[12px] tg-muted">Showing the first 200 — narrow by system to see the rest.</li>}
      </ul>
    </div>
  )
}
