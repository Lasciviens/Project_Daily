import { useState, useMemo, useCallback, useEffect } from 'react'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { useAllGames } from '../../hooks/useGames'
import {
  scrapeBatch, applyReviewed, undoRun, fetchScreenScraperStatus,
  refreshScreenScraperSystems, fetchScrapeDecisions, recordRejections,
  type ScrapeResult,
} from '../../api/screenscraperApi'
import { ScrapeFilters, QueueCard } from './ScrapeQueue'
import { ScrapeResultCard } from './ScrapeResultCard'
import { ScrapeSearchPanel } from '../ScrapeSearchPanel'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { toast } from '../../../../app/store'
import { logError } from '../../../../shared/utils/logError'
import {
  selectCandidates, systemOf, estimateRequests, checkQuota, defaultAcceptedFields,
  missingFields, EMPTY_FILTERS,
  type StudioGame, type StudioFilters, type FillableField,
} from '../../screenscraperStudio'

// The ScreenScraper workbench.
//
// It replaces a flow whose entire interface was a button reading "look up next
// 6" — it chose the six itself, so the one thing worth knowing (WHICH six) only
// became visible once the answers came back and it was too late not to ask.
//
// Three steps, always in that order and all visible at once: choose from the
// library → read what each match would actually write → save only what you
// approved. Plus the three things the earlier version had no answer for: what
// a run COSTS against a shared daily quota before it starts, how to TAKE BACK
// a batch that went wrong, and how to remember any of it after a reload.

const MAX_BATCH = 6
const MEDIA_COLUMNS: FillableField[] = ['primary_cover_url', 'screenshot_url', 'fanart_url']

type Handled = 'saved' | 'skipped' | 'no_match'

export function ScreenScraperStudio() {
  const qc = useQueryClient()
  const { data: allGames = [], isLoading } = useAllGames()
  const status = useQuery({
    queryKey: ['screenscraper', 'status'], queryFn: fetchScreenScraperStatus,
    staleTime: 60_000, retry: false,
  })
  const journal = useQuery({
    queryKey: ['screenscraper', 'decisions'], queryFn: () => fetchScrapeDecisions(),
    staleTime: 30_000, retry: false,
  })

  const [filters, setFilters] = useState<StudioFilters>(EMPTY_FILTERS)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [withMedia, setWithMedia] = useState(true)
  const [results, setResults] = useState<ScrapeResult[] | null>(null)
  const [accepted, setAccepted] = useState<Record<string, FillableField[] | null>>({})
  const [focusIdx, setFocusIdx] = useState(0)
  const [searchFor, setSearchFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const games = allGames as unknown as StudioGame[]
  const systems = useMemo(
    () => [...new Set(games.map(systemOf).filter(Boolean) as string[])].sort(),
    [games],
  )

  // Progress survives a reload because the journal does. At six a batch and
  // ~1150 games this is roughly 190 sittings; a session-only Set re-offered
  // every rejection the moment the tab was refreshed.
  // Its own useMemo so the two below get a stable dependency — a fresh []
  // every render would recompute the whole history on every keystroke.
  const decisions = useMemo(() => journal.data ?? [], [journal.data])
  const handled = useMemo(() => {
    const map: Record<string, Handled> = {}
    // Oldest first, so a later decision (an undo, a re-review) wins.
    for (const d of [...decisions].reverse()) {
      if (d.decision === 'applied') map[d.game_id] = 'saved'
      else if (d.decision === 'rejected') map[d.game_id] = 'skipped'
      else if (d.decision === 'no_match' || d.decision === 'unmatchable') map[d.game_id] = 'no_match'
      else if (d.decision === 'undone') delete map[d.game_id]
    }
    return map
  }, [decisions])
  const handledIds = useMemo(() => new Set(Object.keys(handled)), [handled])

  const candidates = useMemo(() => selectCandidates(games, filters, handledIds), [games, filters, handledIds])
  const gameById = useMemo(() => new Map(games.map(g => [g.id, g])), [games])
  const selectedGames = useMemo(
    () => [...selected].map(id => gameById.get(id)).filter(Boolean) as StudioGame[],
    [selected, gameById],
  )

  const cost = estimateRequests(selectedGames, withMedia)
  const quota = checkQuota(cost, status.data?.remaining_today)

  const toggle = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < MAX_BATCH) next.add(id)
      else toast.warning(`${MAX_BATCH} at a time — review these first.`)
      return next
    })
  }, [])

  function selectFirstFree() {
    const next = new Set<string>()
    for (const g of candidates) {
      if (next.size >= MAX_BATCH) break
      if (missingFields(g).length) next.add(g.id)
    }
    if (!next.size) toast.warning('Nothing in this filter is missing anything.')
    setSelected(next)
  }

  // ── Step 2: ask, without writing ──────────────────────────────────────────
  async function lookUp() {
    if (!selectedGames.length || !quota.ok) return
    setBusy(true)
    const tid = toast.loading(`Looking up ${selectedGames.length} games…`)
    try {
      const res = await scrapeBatch({
        limit: MAX_BATCH, gameIds: selectedGames.map(g => g.id), dryRun: true, media: withMedia,
      })
      toast.dismiss(tid)
      if (res.status !== 'ok') { toast.warning(res.message ?? `Cannot scrape right now (${res.status})`); return }
      const rows = res.results ?? []
      setResults(rows)
      setFocusIdx(0)
      setAccepted(Object.fromEntries(rows.map(r => [
        r.id,
        r.outcome === 'matched'
          ? defaultAcceptedFields({ gameId: r.id, matchedTitle: r.matched_title ?? null, system: r.system ?? null, wouldFill: r.would_fill ?? [] })
          : null,
      ])))
      // A miss is already decided — there is nothing to approve — so it is
      // journalled now rather than waiting for a Save that will never include it.
      const misses = rows.filter(r => r.outcome !== 'matched')
      if (misses.length) {
        await recordRejections(crypto.randomUUID(), misses.map(r => ({
          gameId: r.id,
          decision: r.outcome === 'unmatchable' ? 'unmatchable' : 'no_match',
          systemUsed: r.system ?? null,
        })))
        journal.refetch()
      }
      status.refetch()
    } catch (e) {
      toast.dismiss(tid)
      const msg = (e as Error).message
      logError(`screenscraper_studio_lookup: ${msg}`)
      toast.error(msg)
    } finally { setBusy(false) }
  }

  // ── Step 3: write exactly what was approved ───────────────────────────────
  async function save() {
    const items = (results ?? [])
      .filter(r => r.outcome === 'matched' && (accepted[r.id]?.length ?? 0) > 0)
      .map(r => {
        const fields = accepted[r.id] ?? []
        return {
          game_id: r.id,
          // Carried so the server can prove it is writing the entry that was
          // reviewed, not whatever a second lookup happens to return.
          jeu_id: r.jeu_id ?? null,
          fields: fields.filter(f => !MEDIA_COLUMNS.includes(f)),
          media_roles: fields.filter(f => MEDIA_COLUMNS.includes(f)),
        }
      })
    if (!items.length) return
    setBusy(true)
    const tid = toast.loading(`Saving ${items.length} games…`)
    try {
      const res = await applyReviewed(items)
      toast.dismiss(tid)
      if (res.status !== 'ok') { toast.warning(res.message ?? 'Could not save'); return }
      const rows = res.results ?? []
      const saved = rows.filter(r => r.outcome === 'matched')
      const stale = rows.filter(r => r.outcome === 'stale_proposal')

      // Everything offered and not saved is a rejection, and rejections are
      // worth remembering: they are what stops a game being offered forever.
      const rejected = (results ?? [])
        .filter(r => r.outcome === 'matched' && !saved.some(s => s.id === r.id) && !stale.some(s => s.id === r.id))
      if (rejected.length) {
        await recordRejections(res.run_id ?? crypto.randomUUID(), rejected.map(r => ({
          gameId: r.id, decision: 'rejected', jeuId: r.jeu_id ?? null,
          matchedTitle: r.matched_title ?? null, systemUsed: r.system ?? null,
        })))
      }

      if (stale.length) {
        toast.warning(`${stale.length} match${stale.length === 1 ? '' : 'es'} changed since you reviewed them — look those up again.`)
      }
      toast.success(`${saved.length} game${saved.length === 1 ? '' : 's'} updated ✓`)
      qc.invalidateQueries({ queryKey: ['games'] })
      journal.refetch(); status.refetch()
      setResults(null); setAccepted({}); setSelected(new Set())
    } catch (e) {
      toast.dismiss(tid)
      const msg = (e as Error).message
      logError(`screenscraper_studio_save: ${msg}`)
      toast.error(msg)
    } finally { setBusy(false) }
  }

  function skipAll() {
    const rows = results ?? []
    const offered = rows.filter(r => r.outcome === 'matched')
    if (offered.length) {
      recordRejections(crypto.randomUUID(), offered.map(r => ({
        gameId: r.id, decision: 'rejected', jeuId: r.jeu_id ?? null,
        matchedTitle: r.matched_title ?? null, systemUsed: r.system ?? null,
      }))).then(() => journal.refetch())
    }
    setResults(null); setAccepted({}); setSelected(new Set())
  }

  // ── Undo a whole run ──────────────────────────────────────────────────────
  async function undo(runId: string) {
    setBusy(true)
    const tid = toast.loading('Undoing that run…')
    try {
      const res = await undoRun(runId)
      toast.dismiss(tid)
      if (res.status === 'no_journal') { toast.warning(res.message ?? 'No record of that run'); return }
      toast.success(`${res.reverted ?? 0} game${res.reverted === 1 ? '' : 's'} reverted ✓`)
      if (res.skipped?.length) toast.warning(`${res.skipped.length} could not be reverted — see the error log.`)
      qc.invalidateQueries({ queryKey: ['games'] })
      journal.refetch()
    } catch (e) {
      toast.dismiss(tid)
      const msg = (e as Error).message
      logError(`screenscraper_studio_undo: ${msg}`)
      toast.error(msg)
    } finally { setBusy(false) }
  }

  async function fetchSystems() {
    setBusy(true)
    const tid = toast.loading('Fetching ScreenScraper system ids…')
    try {
      const r = await refreshScreenScraperSystems()
      toast.dismiss(tid)
      toast.success(`${r.systems} systems cached (${r.with_retropie_name} with a folder name) ✓`)
      status.refetch()
    } catch (e) {
      toast.dismiss(tid)
      toast.error((e as Error).message)
    } finally { setBusy(false) }
  }

  // ── Keyboard review ───────────────────────────────────────────────────────
  // At six a batch and ~1150 games even three seconds a decision is an hour of
  // uninterrupted choices; mouse round trips triple it. Purely additive — the
  // 44px tap targets are untouched — and scoped to this component, disabled
  // while a text field has focus, and never able to APPLY on its own.
  useEffect(() => {
    if (!results?.length) return
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const rows = results ?? []
      const cur = rows[focusIdx]
      const k = e.key.toLowerCase()
      if (k === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setFocusIdx(i => Math.min(rows.length - 1, i + 1)) }
      else if (k === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setFocusIdx(i => Math.max(0, i - 1)) }
      else if (k === 'a' && cur) {
        e.preventDefault()
        setAccepted(prev => ({
          ...prev,
          [cur.id]: defaultAcceptedFields({ gameId: cur.id, matchedTitle: cur.matched_title ?? null, system: cur.system ?? null, wouldFill: cur.would_fill ?? [] }),
        }))
        setFocusIdx(i => Math.min(rows.length - 1, i + 1))
      } else if (k === 'r' && cur) {
        e.preventDefault()
        setAccepted(prev => ({ ...prev, [cur.id]: null }))
        setFocusIdx(i => Math.min(rows.length - 1, i + 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [results, focusIdx])

  const acceptedCount = Object.values(accepted).filter(v => v && v.length > 0).length
  const st = status.data

  // Runs that are still revertible, newest first.
  const runs = useMemo(() => {
    const undone = new Set(decisions.filter(d => d.decision === 'undone').map(d => d.run_id))
    const byRun = new Map<string, { runId: string; at: string; titles: string[]; fields: number }>()
    for (const d of decisions) {
      if (d.decision !== 'applied' || undone.has(d.run_id)) continue
      const cur = byRun.get(d.run_id) ?? { runId: d.run_id, at: d.created_at, titles: [], fields: 0 }
      cur.titles.push(d.matched_title ?? '')
      cur.fields += d.fields_written?.length ?? 0
      byRun.set(d.run_id, cur)
    }
    return [...byRun.values()].slice(0, 8)
  }, [decisions])

  return (
    <div className="space-y-4">
      {/* ── Account + budget, above everything it constrains ─────────────── */}
      <div className="rounded-xl border border-ink-200 bg-cream-50 p-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-bold text-ink-900 flex items-center gap-1.5">
              🎲 ScreenScraper
              {st?.premium && <span className="text-[10px] font-bold bg-yellow-400 text-yellow-900 px-1.5 py-0.5 rounded-full">PREMIUM</span>}
            </p>
            {status.isLoading && <p className="text-xs text-ink-400">Checking the account…</p>}
            {st?.status === 'not_configured' && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Credentials are not set in Vault yet — nothing can be looked up.
              </p>
            )}
            {st?.account && (
              <p className="text-xs text-ink-500">
                {st.remaining_today?.toLocaleString('en-GB')} of {st.account.requests_max.toLocaleString('en-GB')} requests left today
                · {st.account.threads} threads
                <InfoBubble label="Shared with what?">
                  The daily counter belongs to the ACCOUNT, not to this app — the handheld's own
                  scraping spends from the same allowance, and their counter is coarse (three real
                  calls have been observed moving it by ten). Treat it as a ceiling, never as an
                  exact budget, which is why a run is costed before it starts and refuses to eat
                  into the last 500.
                </InfoBubble>
              </p>
            )}
            {st != null && st.systems_known === 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                No system ids cached yet — nothing can be matched until they are fetched.
              </p>
            )}
            {journal.data && journal.data.length === 0 && (
              <p className="text-[11px] text-ink-400 mt-1">
                No decision history yet. (If it never appears, migration 097 is not applied — the
                workbench still works, it just forgets between reloads.)
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={fetchSystems} disabled={busy}
              className="min-h-[44px] px-3 text-sm rounded-lg border border-ink-200 bg-cream-50 text-ink-600 hover:border-accent-300 disabled:opacity-40">
              Fetch system ids
            </button>
            <button type="button" onClick={() => { status.refetch(); journal.refetch() }} disabled={busy}
              className="min-h-[44px] px-3 text-sm rounded-lg border border-ink-200 bg-ink-50 text-ink-600 hover:border-accent-300 disabled:opacity-40">
              🔄
            </button>
          </div>
        </div>
      </div>

      {/* ── Step 1: choose ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-ink-200 bg-cream-50 p-3 space-y-3">
        <div>
          <h3 className="text-sm font-bold text-ink-900">1 · Choose games</h3>
          <p className="text-xs text-ink-500">
            Tap a card to select it — up to {MAX_BATCH} at a time, so every answer can actually be read.
          </p>
        </div>

        <ScrapeFilters filters={filters} onChange={setFilters} systems={systems}
          total={games.length} shown={candidates.length} />

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" onClick={selectFirstFree} disabled={busy || !candidates.length}
            className="min-h-[44px] px-3 text-xs font-semibold rounded-lg border border-ink-200 text-ink-600 hover:border-accent-300 disabled:opacity-40">
            Select first {MAX_BATCH} with gaps
          </button>
          {selected.size > 0 && (
            <button type="button" onClick={() => setSelected(new Set())}
              className="min-h-[44px] px-3 text-xs text-ink-500 underline">Clear selection</button>
          )}
          <label className="flex items-center gap-1.5 text-xs text-ink-600 min-h-[44px] cursor-pointer">
            <input type="checkbox" checked={withMedia} onChange={e => setWithMedia(e.target.checked)}
              className="w-4 h-4 accent-current text-accent-500" />
            Artwork
            <InfoBubble label="Why turn it off?">
              Artwork is a separate request per image, so it is most of a run's cost. With it off a
              run is one request per game and fills text only — useful when the daily allowance is
              nearly spent. With it on, a candidate cover is fetched for the REVIEW as well, which
              is the fastest way to spot a wrong match.
            </InfoBubble>
          </label>
        </div>

        {isLoading ? (
          <p className="text-sm text-ink-400 py-6 text-center">Loading your library…</p>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-ink-400 py-6 text-center">No games match these filters.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 xl:grid-cols-12 gap-2 max-h-[28rem] overflow-y-auto">
            {candidates.slice(0, 180).map(g => (
              <QueueCard key={g.id} game={g} selected={selected.has(g.id)}
                onToggle={() => toggle(g.id)} handled={handled[g.id]} />
            ))}
          </div>
        )}
        {candidates.length > 180 && (
          <p className="text-[11px] text-ink-400">
            Showing the first 180 of {candidates.length} — narrow the filters to reach the rest.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-ink-100">
          <button type="button" onClick={lookUp} disabled={busy || !selected.size || !quota.ok}
            className="min-h-[44px] px-4 text-sm font-semibold bg-accent-500 hover:bg-accent-600 text-white rounded-lg disabled:opacity-40 transition-colors">
            {busy ? 'Working…' : `Look up ${selected.size || ''} selected`}
          </button>
          {selected.size > 0 && (
            <span className={`text-xs ${quota.ok ? 'text-ink-500' : 'text-red-600'}`}>
              ≈ {cost} request{cost === 1 ? '' : 's'}{quota.reason ? ` · ${quota.reason}` : ''}
            </span>
          )}
        </div>
      </div>

      {/* ── Step 2: review ───────────────────────────────────────────────── */}
      {results && (
        <div className="rounded-xl border border-accent-300 bg-cream-50 p-3 space-y-2">
          <div>
            <h3 className="text-sm font-bold text-ink-900">2 · Review {results.length} result{results.length === 1 ? '' : 's'}</h3>
            <p className="text-xs text-ink-500">
              Nothing is written yet. Show values to read what each field would actually say,
              untick anything wrong, or search by hand for a better match.
            </p>
            <p className="hidden sm:block text-[11px] text-ink-400 mt-0.5">
              Keys: <kbd>J</kbd>/<kbd>K</kbd> move · <kbd>A</kbd> accept · <kbd>R</kbd> reject
            </p>
          </div>
          {results.map((r, i) => (
            <ScrapeResultCard key={r.id} result={r} game={gameById.get(r.id)} focused={i === focusIdx}
              accepted={accepted[r.id] ?? null}
              onToggleField={f => setAccepted(prev => {
                const cur = prev[r.id] ?? []
                return { ...prev, [r.id]: cur.includes(f) ? cur.filter(x => x !== f) : [...cur, f] }
              })}
              onAcceptAll={() => setAccepted(prev => ({
                ...prev,
                [r.id]: defaultAcceptedFields({ gameId: r.id, matchedTitle: r.matched_title ?? null, system: r.system ?? null, wouldFill: r.would_fill ?? [] }),
              }))}
              onRejectAll={() => setAccepted(prev => ({ ...prev, [r.id]: null }))}
              onSearchManually={() => setSearchFor(r.id)}
            />
          ))}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" onClick={save} disabled={busy || acceptedCount === 0}
              className="min-h-[44px] px-4 text-sm font-semibold bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-40 transition-colors">
              Save {acceptedCount} approved
            </button>
            <button type="button" onClick={skipAll} disabled={busy}
              className="min-h-[44px] px-3 text-sm text-ink-500 rounded-lg border border-ink-200 disabled:opacity-40">
              Skip all
            </button>
          </div>
        </div>
      )}

      {/* ── Runs, and how to take one back ────────────────────────────────── */}
      {runs.length > 0 && (
        <div className="rounded-xl border border-ink-200 bg-cream-50 p-3 space-y-2">
          <div>
            <h3 className="text-sm font-bold text-ink-900">Recent runs</h3>
            <p className="text-xs text-ink-500">
              Undo clears exactly the fields a run filled. It can never touch anything you entered
              yourself — a scrape only ever writes into empty fields — and it skips any field you
              have changed since.
            </p>
          </div>
          {runs.map(run => (
            <div key={run.runId} className="flex items-center gap-2 rounded-lg border border-ink-200 p-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ink-800 truncate">
                  {run.titles.length} game{run.titles.length === 1 ? '' : 's'} · {run.fields} field{run.fields === 1 ? '' : 's'}
                </p>
                <p className="text-[11px] text-ink-500 truncate">
                  {new Date(run.at).toLocaleString('en-GB')} · {run.titles.filter(Boolean).slice(0, 3).join(', ')}
                  {run.titles.length > 3 ? ` +${run.titles.length - 3}` : ''}
                </p>
              </div>
              <button type="button" onClick={() => undo(run.runId)} disabled={busy}
                className="min-h-[36px] px-2.5 text-xs font-semibold rounded-lg border border-ink-200 text-ink-600 hover:border-red-300 hover:text-red-600 disabled:opacity-40 flex-shrink-0">
                ↶ Undo run
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Search by hand, for whatever the automatic pass got wrong ─────── */}
      <ScrapeSearchPanel games={allGames} initialTarget={searchFor}
        onApplied={() => { qc.invalidateQueries({ queryKey: ['games'] }); journal.refetch(); status.refetch() }} />
    </div>
  )
}
