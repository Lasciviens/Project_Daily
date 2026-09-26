import { useMemo } from 'react'
import { Check, RotateCcw, Search, Undo2, Wand2 } from 'lucide-react'
import { platformInfo, type TgGame } from '../../testGameModel'
import { useTestGameStore, type ScrapeBatchState } from '../../testGameStore'
import type { FindResult } from '../../../scraper/ssApi'
import { EXACT_BASES, modeCounts } from '../../../scraper/ssPlan'
import { useApplyBatch, useFindBatch, useKnownNoMatches, useScrapePrefs, useUndoScrape } from '../../../scraper/useScrape'
import { toast } from '../../../../../app/store'
import { TgDropdown } from '../TgDropdown'
import { TgCover } from '../TgCover'
import { TgBasisBadges, TgCandidateCover, TgFlagChips, TgScrapeCard } from './TgScrapeParts'
import { isScraped, primaryVariant } from './tgScrapeModel'

type Filter = ScrapeBatchState['filter']
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'todo', label: 'Not scraped' }, { key: 'old', label: 'Old matches' }, { key: 'no_cover', label: 'No cover' },
  { key: 'no_desc', label: 'No description' }, { key: 'all', label: 'All' },
]
const FIND_CHUNK = 10
const APPLY_CHUNK = 5
const CAP = 200

function matches(g: TgGame, f: Filter) {
  if (f === 'todo') return !isScraped(g)
  // Matched by the old scraper: an id, but never saved by this version.
  if (f === 'old') return isScraped(g) && !g.ss_scraped_at
  if (f === 'no_cover') return !g.primary_cover_url
  if (f === 'no_desc') return !g.description?.trim()
  return true
}
/** A match safe to pre-tick: ROM identity (or the previous match), and no
 *  marker that exposes a wrong one. */
const safeToTick = (f: FindResult) => {
  const c = f.candidate
  if (!c) return false
  const exact = c.matched_by.some(b => EXACT_BASES.includes(b) || b === 'previous')
  const flagged = c.flags.some(x => x !== 'best dump')
  return exact && !flagged
}

/**
 * Many games at once: find the best match for each (their previous match,
 * else the ROM file, else the title), tick the right ones, save them with your
 * defaults. Nothing is written before Save; only exact matches without a
 * hack/beta/demo marker start ticked. The whole session lives in the page
 * store — switching to one game and back keeps every lookup.
 */
export function TgScrapeBatch({ games, loading, onOpenGame }: { games: TgGame[]; loading: boolean; onOpenGame: (id: string) => void }) {
  const batch = useTestGameStore(s => s.scrapeBatch)
  const update = useTestGameStore(s => s.updateScrapeBatch)
  const { filter, system, found, ticked, saved, runId } = batch
  const find = useFindBatch()
  const applyBatch = useApplyBatch()
  const undo = useUndoScrape()
  const noMatches = useKnownNoMatches(true)
  const { prefs } = useScrapePrefs()
  const counts = modeCounts(prefs)
  const replaceFields = Object.entries(prefs.fields).filter(([, p]) => p === 'replace').length

  const systems = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of games) { const s = primaryVariant(g)?.esde_system; if (s) m.set(s, (m.get(s) ?? 0) + 1) }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [games])
  // Rows touched this session stay put (a saved game no longer matches "Not
  // scraped", but its confirmation must not vanish).
  const list = useMemo(
    () => games.filter(g => (found[g.id] || saved[g.id] || matches(g, filter)) && (!system || primaryVariant(g)?.esde_system === system))
      .sort((a, b) => a.title.localeCompare(b.title)),
    [games, filter, system, found, saved],
  )
  const known = noMatches.data ?? new Set<string>()
  const touched = list.filter(g => found[g.id] || saved[g.id])
  const fresh = list.filter(g => !found[g.id] && !saved[g.id] && !known.has(g.id))
  const earlierMisses = list.filter(g => !found[g.id] && !saved[g.id] && known.has(g.id))
  // What is rendered is exactly what lookups and saves may touch.
  const visible = [...touched, ...fresh.slice(0, Math.max(0, CAP - touched.length))].sort((a, b) => a.title.localeCompare(b.title))
  const retryable = visible.filter(g => found[g.id]?.outcome === 'error')
  const next = [...retryable, ...visible.filter(g => !found[g.id] && !saved[g.id])].slice(0, FIND_CHUNK)
  const toSave = visible.filter(g => ticked[g.id] && found[g.id]?.outcome === 'match' && !saved[g.id])

  const findNext = (ids = next.map(g => g.id)) => {
    if (!ids.length) return
    find.mutate(ids, {
      onSuccess: (r) => {
        if (r.status === 'quota_exhausted') { toast.warning(r.message ?? "Today's ScreenScraper allowance is nearly used up."); return }
        update(b => {
          const f = { ...b.found }; const t = { ...b.ticked }
          for (const x of r.results ?? []) { f[x.game_id] = x; if (x.outcome === 'match') t[x.game_id] = safeToTick(x) }
          return { found: f, ticked: t }
        })
      },
    })
  }

  const saveTicked = async () => {
    const run = runId ?? crypto.randomUUID()
    update({ runId: run })
    for (let i = 0; i < toSave.length; i += APPLY_CHUNK) {
      const items = toSave.slice(i, i + APPLY_CHUNK).map(g => {
        const f = found[g.id]!
        return { game_id: g.id, jeu_id: f.candidate!.jeu_id, system: f.system?.id ?? null, rom_filename: f.rom_filename ?? null, matched_by: f.candidate!.matched_by }
      })
      try {
        const r = await applyBatch.mutateAsync({ items, runId: run })
        update(b => ({ saved: { ...b.saved, ...Object.fromEntries(r.results.map(x => [x.game_id, x])) } }))
        if (r.not_started?.length) { toast.warning(`${r.not_started.length} game${r.not_started.length === 1 ? '' : 's'} not started (time limit) — press Save again.`); break }
      } catch { break } // the mutation already toasted
    }
  }

  const savedIds = Object.keys(saved).filter(id => saved[id].outcome === 'applied')

  return (
    <div className="flex flex-col gap-4">
      <TgScrapeCard title="Which games">
        <div role="group" aria-label="Show" className="tg-scroll-x -mx-1 flex gap-1.5 px-1">
          {FILTERS.map(f => (
            <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => update({ filter: f.key })}
              className={`tg-tab min-h-[44px] shrink-0 !px-3 !text-[12.5px] ${filter === f.key ? 'is-active' : 'bg-[var(--tg-panel-2)]'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 text-[13px]">
          <span className="font-medium">System</span>
          <TgDropdown
            value={system || 'all'}
            options={[{ value: 'all', label: 'All systems' }, ...systems.map(([s, n]) => ({ value: s, label: platformInfo(s).name === s ? s : `${platformInfo(s).name} (${s})`, count: n }))]}
            onChange={v => update({ system: v === 'all' ? '' : v })}
            buttonLabel={system ? (platformInfo(system).name === system ? system : platformInfo(system).name) : 'All systems'}
            ariaLabel="System"
            align="end"
          />
        </div>
        <p className="mt-3 text-[12px] leading-snug tg-muted">
          {loading ? 'Loading…' : `${list.length} game${list.length === 1 ? '' : 's'}${earlierMisses.length ? ` · ${earlierMisses.length} had no match last time (set apart)` : ''}.`}{' '}
          Saves use “What to save”: {counts.store} image types copied, {counts.on_demand} online{prefs.snapshot ? ', full record' : ''};
          {replaceFields ? <b className="font-semibold text-[var(--tg-red)]"> {replaceFields} field{replaceFields === 1 ? ' is' : 's are'} set to Replace</b> : ' fields only fill empty ones'}.
          Each lookup is one ScreenScraper request.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <button type="button" onClick={() => findNext()} disabled={!next.length || find.isPending} className="tg-btn tg-btn-secondary">
            <Search className={`h-4 w-4 ${find.isPending ? 'animate-pulse' : ''}`} aria-hidden />
            {find.isPending ? 'Looking…' : next.length ? `Find matches for the next ${next.length}` : 'All shown games looked up'}
          </button>
          <button type="button" onClick={saveTicked} disabled={!toSave.length || applyBatch.isPending} className="tg-btn tg-btn-primary">
            <Wand2 className={`h-4 w-4 ${applyBatch.isPending ? 'animate-pulse' : ''}`} aria-hidden />
            {applyBatch.isPending ? 'Saving…' : `Save ${toSave.length} ticked`}
          </button>
        </div>
        {earlierMisses.length > 0 && (
          <button type="button" onClick={() => findNext(earlierMisses.slice(0, FIND_CHUNK).map(g => g.id))} disabled={find.isPending} className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 text-[12.5px] font-semibold text-[var(--tg-accent)]">
            <RotateCcw className="h-4 w-4" aria-hidden /> Try the earlier misses again ({Math.min(earlierMisses.length, FIND_CHUNK)})
          </button>
        )}
        {runId && savedIds.length > 0 && (
          <button type="button" onClick={() => undo.mutate({ runId, gameIds: savedIds }, { onSuccess: (r) => {
            const kept = new Set((r.skipped ?? []).map(s => s.game_id))
            if (r.status === 'ok' && r.reverted) update(b => ({ saved: Object.fromEntries(Object.entries(b.saved).filter(([id]) => kept.has(id))), runId: kept.size ? b.runId : null }))
          } })} disabled={undo.isPending} className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 text-[12.5px] font-semibold text-[var(--tg-accent)]">
            <Undo2 className="h-4 w-4" aria-hidden /> Undo this batch ({savedIds.length})
          </button>
        )}
      </TgScrapeCard>

      <ul className="flex flex-col gap-2">
        {visible.map(g => {
          const f = found[g.id]
          const s = saved[g.id]
          const c = f?.candidate
          const tickable = f?.outcome === 'match' && !s
          const Row = tickable ? 'label' : 'div'
          return (
            <li key={g.id} className="tg-panel flex items-center gap-2 p-2">
              <Row className={`flex min-w-0 flex-1 items-center gap-3 ${tickable ? 'cursor-pointer' : ''}`}>
                <span className="grid h-11 w-8 shrink-0 place-items-center">
                  {tickable && (
                    <input type="checkbox" checked={!!ticked[g.id]} onChange={e => update(b => ({ ticked: { ...b.ticked, [g.id]: e.target.checked } }))}
                      aria-label={`Save ${c?.values.title ?? 'match'} to ${g.title}`} className="h-5 w-5 accent-[var(--tg-accent)]" />
                  )}
                </span>
                <span className="relative h-[52px] w-[38px] shrink-0"><TgCover game={g} mode="natural" align="center" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{g.title}</span>
                  {!f && <span className="block truncate text-[11.5px] tg-muted">{platformInfo(g.platformKey).name} · not looked up</span>}
                  {f && f.outcome !== 'match' && (
                    <span className={`block truncate text-[11.5px] ${f.outcome === 'error' ? 'text-[var(--tg-red)]' : 'tg-muted'}`}>
                      {f.outcome === 'no_match' ? 'No match' : f.outcome === 'unmatchable' ? (f.reason ?? 'Nothing to search with') : `${f.reason ?? 'Error'} — will retry`}
                    </span>
                  )}
                  {c && (
                    <span className="mt-0.5 flex min-w-0 items-center gap-2">
                      <TgCandidateCover candidate={c} regions={prefs.regions} width={120} className="h-[34px] w-[25px] shrink-0 overflow-hidden rounded" />
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
              </Row>
              <button type="button" onClick={() => onOpenGame(g.id)} className="tg-btn tg-btn-secondary shrink-0 !px-3 !text-[12.5px]">Open</button>
            </li>
          )
        })}
        {fresh.length > visible.length - touched.length && <li className="py-2 text-center text-[12px] tg-muted">Showing {visible.length} — narrow by system to see the rest.</li>}
      </ul>
    </div>
  )
}
