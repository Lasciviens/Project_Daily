import { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Combobox, ComboboxInput, ComboboxOptions, ComboboxOption } from '@headlessui/react'
import { searchScreenScraper, applyMatch, type SearchCandidate } from '../api/screenscraperApi'
import { ConfirmDialog } from '../../../shared/components/ConfirmDialog'
import { systemMeta } from '../systemMeta'
import { toast } from '../../../app/store'
import { logError } from '../../../shared/utils/logError'
import type { Game } from '../types'

// Search ScreenScraper by name and pick the right entry by hand.
//
// This is the answer to the automatic matcher being wrong or finding nothing:
// it matches on a ROM filename, which is all it has, so "Contra (USA).zip"
// landing on Contra III is a normal failure rather than a bug to fix once. Here
// you read the candidates and choose.
//
// NO CANDIDATE IMAGE IS SHOWN. Every ScreenScraper media URL carries the
// developer credentials in its query string, so artwork cannot be handed to the
// browser at all — a candidate can only report that it HAS a cover. The chosen
// one's images are downloaded server-side and re-hosted when it is applied.

/** The ROM filename, stripped of its folders — the real match key. */
function romName(g: Game | null): string | null {
  const p = g?.platforms.find(x => x.is_primary_variant) ?? g?.platforms[0]
  const raw = p?.esde_path
  if (!raw) return null
  const base = raw.replace(/\\/g, '/').split('/').filter(seg => seg && seg !== '.' && seg !== '..').pop()
  return base?.trim() || null
}

export function ScrapeSearchPanel({ games, initialTarget, onApplied }: {
  games: Game[]
  /** Open pre-aimed at one game — how a failed automatic match hands over. */
  initialTarget?: string | null
  onApplied?: () => void
}) {
  const qc = useQueryClient()
  const [target, setTarget] = useState<Game | null>(null)
  const [gameQuery, setGameQuery] = useState('')
  const [query, setQuery] = useState('')
  const [system, setSystem] = useState<string | null>(null)
  const [results, setResults] = useState<SearchCandidate[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [picked, setPicked] = useState<SearchCandidate | null>(null)
  const [busy, setBusy] = useState(false)
  const [aimedAt, setAimedAt] = useState<string | null>(null)

  // Adjust-during-render (the FoodLogModal `wasOpen` precedent) rather than an
  // effect: the caller hands over a game id and this picks it up exactly once,
  // so a later manual change is never clobbered by a re-render.
  if (initialTarget && initialTarget !== aimedAt) {
    setAimedAt(initialTarget)
    const g = games.find(x => x.id === initialTarget)
    if (g) chooseTarget(g)
  }

  const gameMatches = useMemo(() => {
    const q = gameQuery.trim().toLowerCase()
    const pool = q ? games.filter(g => g.title.toLowerCase().includes(q)) : games
    return pool.slice(0, 20)
  }, [games, gameQuery])

  function chooseTarget(g: Game | null) {
    setTarget(g)
    setResults(null); setNote(null); setPicked(null)
    if (g) {
      // Its own title and its own system are the right starting point — the
      // whole reason we are here is that they did not match automatically.
      setQuery(g.title)
      const plat = g.platforms.find(p => p.is_primary_variant) ?? g.platforms[0]
      setSystem(plat?.esde_system ?? plat?.system ?? null)
    }
  }

  async function runSearch() {
    const q = query.trim()
    if (!q) return
    setBusy(true); setResults(null); setNote(null)
    const tid = toast.loading(`Searching "${q}"…`)
    try {
      const res = await searchScreenScraper(q, system)
      toast.dismiss(tid)
      if (res.status !== 'ok') { toast.warning(res.message ?? 'ScreenScraper is not configured'); return }
      setResults(res.results ?? [])
      setNote(res.message ?? null)
    } catch (e) {
      toast.dismiss(tid)
      const msg = (e as Error).message
      logError(`screenscraper_search: ${msg}`)
      toast.error(msg)
    } finally { setBusy(false) }
  }

  async function apply() {
    if (!target || !picked?.jeu_id) return
    setBusy(true)
    const tid = toast.loading(`Saving ${picked.title ?? ''}…`)
    try {
      const res = await applyMatch({ gameId: target.id, jeuId: picked.jeu_id, query: query.trim(), system })
      toast.dismiss(tid)
      if (res.status !== 'ok') { toast.warning(res.message ?? 'Could not apply that match'); return }
      if (res.outcome !== 'matched') { toast.warning(res.message ?? 'That result could not be applied'); return }
      const bits = [
        res.filled?.length ? `${res.filled.length} field${res.filled.length === 1 ? '' : 's'}` : null,
        res.media?.length ? `${res.media.length} image${res.media.length === 1 ? '' : 's'}` : null,
      ].filter(Boolean)
      toast.success(bits.length ? `${target.title}: ${bits.join(' + ')} ✓` : `${target.title}: nothing was missing`)
      qc.invalidateQueries({ queryKey: ['games'] })
      onApplied?.()
      setPicked(null)
    } catch (e) {
      toast.dismiss(tid)
      const msg = (e as Error).message
      logError(`screenscraper_apply_match: ${msg}`)
      toast.error(msg)
    } finally { setBusy(false) }
  }

  const inputCls = 'w-full min-h-[44px] text-sm px-3 py-2 rounded-lg border border-ink-200 bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400'

  return (
    <div className="rounded-xl border border-ink-200 bg-cream-50 p-4 space-y-3">
      <div>
        <h3 className="text-sm font-bold text-ink-900">Search — find the right entry yourself</h3>
        <p className="text-xs text-ink-500 mt-0.5">
          For a game the automatic match got wrong or could not find. Pick the game, read the
          candidates, choose one. Only fields your game is missing get filled.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-ink-400 mb-1 block">Your game</label>
          <Combobox value={target} onChange={chooseTarget} immediate>
            <ComboboxInput className={inputCls} placeholder="Search your library…"
              displayValue={(g: Game | null) => g?.title ?? ''}
              onChange={e => setGameQuery(e.target.value)} />
            <ComboboxOptions anchor="bottom start"
              className="w-[var(--input-width)] max-h-64 overflow-y-auto rounded-lg border border-ink-200 bg-cream-50 shadow-lg z-[70] empty:hidden">
              {gameMatches.map(g => (
                <ComboboxOption key={g.id} value={g}
                  className="px-3 py-2 text-sm text-ink-700 cursor-pointer data-[focus]:bg-accent-50">
                  <span className="truncate block">{g.title}</span>
                </ComboboxOption>
              ))}
            </ComboboxOptions>
          </Combobox>
        </div>
        <div>
          <label className="text-xs text-ink-400 mb-1 block">
            Search ScreenScraper for{system ? ` (in ${systemMeta(system).label})` : ' (all systems)'}
          </label>
          <div className="flex gap-2">
            <input value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runSearch() }}
              placeholder="Game name" className={inputCls} />
            <button type="button" onClick={runSearch} disabled={busy || !query.trim()}
              className="min-h-[44px] px-3 text-sm font-semibold bg-accent-500 hover:bg-accent-600 text-white rounded-lg disabled:opacity-40 flex-shrink-0 transition-colors">
              {busy ? '…' : 'Search'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {system && (
          <button type="button" onClick={() => setSystem(null)} className="min-h-[36px] text-xs text-ink-500 underline">
            Search every system instead
          </button>
        )}
        {/* The ROM filename is the string that ACTUALLY failed to match — the
            title is ES-DE's already-cleaned display name. Both are one tap. */}
        {romName(target) && (
          <button type="button" onClick={() => setQuery(romName(target)!)}
            className="min-h-[36px] px-2 text-xs rounded-lg border border-ink-200 text-ink-500 hover:border-accent-300">
            Use the ROM filename
          </button>
        )}
        {target && query !== target.title && (
          <button type="button" onClick={() => setQuery(target.title)}
            className="min-h-[36px] px-2 text-xs rounded-lg border border-ink-200 text-ink-500 hover:border-accent-300">
            Use the title
          </button>
        )}
      </div>

      {note && <p className="text-xs text-ink-500">{note}</p>}

      {results && results.length > 0 && (
        <ul className="space-y-1.5">
          {results.map(r => (
            <li key={r.jeu_id ?? r.title}
              className="rounded-lg border border-ink-200 p-2.5 flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink-800">{r.title ?? '—'}</p>
                <p className="text-[11px] text-ink-500">
                  {[r.system, r.release_year, r.publisher].filter(Boolean).join(' · ') || 'no details'}
                  {r.has_cover ? ' · has cover art' : ' · no cover art'}
                </p>
                {r.description && <p className="text-[11px] text-ink-400 mt-0.5 line-clamp-2">{r.description}</p>}
              </div>
              <button type="button" onClick={() => setPicked(r)} disabled={!target || !r.jeu_id}
                title={target ? undefined : 'Pick one of your games first'}
                className="min-h-[36px] px-2.5 text-xs font-semibold rounded-lg border border-ink-200 text-ink-600 hover:border-accent-400 hover:text-accent-700 disabled:opacity-40 flex-shrink-0">
                Use this
              </button>
            </li>
          ))}
        </ul>
      )}
      {results && results.length === 0 && !note && <p className="text-xs text-ink-500">No candidates came back.</p>}

      <ConfirmDialog
        open={!!picked}
        title="Save this match?"
        confirmLabel="Save"
        message={
          `"${target?.title ?? ''}" will take its metadata from "${picked?.title ?? ''}"`
          + (picked?.system ? ` (${picked.system}).` : '.')
          + '\n\nOnly fields your game is missing are written; anything you have already entered stays. '
          + 'Artwork is downloaded and re-hosted, and the Needs Review flag is cleared.'
        }
        onConfirm={apply}
        onClose={() => setPicked(null)}
      />
    </div>
  )
}
