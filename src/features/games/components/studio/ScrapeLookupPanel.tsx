import { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Combobox, ComboboxInput, ComboboxOptions, ComboboxOption } from '@headlessui/react'
import { lookupScreenScraper, applyMatch, type SearchCandidate, type LookupMode } from '../../api/screenscraperApi'
import { FieldCompare } from './FieldCompare'
import { ConfirmDialog } from '../../../../shared/components/ConfirmDialog'
import { InfoBubble } from '../../../../shared/components/InfoBubble'
import { systemMeta } from '../../systemMeta'
import { toast } from '../../../../app/store'
import { logError } from '../../../../shared/utils/logError'
import { comparableAgreement, compareFields, systemOf, type StudioGame, type FillableField } from '../../screenscraperStudio'
import type { Game } from '../../types'

// Look a game up by whatever you actually know about it.
//
// The first version searched by NAME and nothing else, which is the weakest
// identity a game has — it is a guess, and on a retro library it is a guess
// with a hundred romhacks competing for it. ScreenScraper's own jeuInfos.php
// documents far more, and the reference client (Skyscraper) sends hashes in
// preference to filenames for exactly that reason:
//
//   crc / md5 / sha1  an EXACT identity; one game comes back, or none
//   romnom + romtaille  the filename, sharpened by the file size
//   serialnum         the disc serial, for CD/DVD-based systems
//   gameid            their own id, straight off a screenscraper.fr page
//   recherche         the name — a list of candidates to choose between
//
// Only `recherche` goes through jeuRecherche; everything else goes through
// jeuInfos and answers with one definite game.

const MODES: { mode: LookupMode; label: string; hint: string }[] = [
  { mode: 'name',   label: 'Name',     hint: 'Searches their database and returns candidates to choose between.' },
  { mode: 'rom',    label: 'Filename', hint: 'The ROM filename, which is what the automatic pass matches on. Correcting it, or adding the file size, often fixes a miss.' },
  { mode: 'gameid', label: 'Their id', hint: 'The number in a screenscraper.fr game page URL. Exact — one game comes back or none.' },
  { mode: 'hash',   label: 'Hash',     hint: 'CRC32, MD5 or SHA-1 of the ROM file. The only identity that cannot be wrong. Nothing in this app computes them — paste one from your own tooling.' },
  { mode: 'serial', label: 'Serial',   hint: 'The disc serial printed on CD/DVD games, e.g. SLUS-00001.' },
]

const inputCls = 'w-full min-h-[44px] text-sm px-3 py-2 rounded-lg border border-ink-200 bg-cream-50 focus:outline-none focus:ring-2 focus:ring-accent-400'

/** The ROM filename, stripped of its folders — the real match key. */
function romName(g: Game | null): string | null {
  const p = g?.platforms.find(x => x.is_primary_variant) ?? g?.platforms[0]
  const raw = p?.esde_path
  if (!raw) return null
  const base = raw.replace(/\\/g, '/').split('/').filter(seg => seg && seg !== '.' && seg !== '..').pop()
  return base?.trim() || null
}

export function ScrapeLookupPanel({ games, target: aim, onApplied }: {
  games: Game[]
  /** Open pre-aimed at one game. The nonce is what lets the SAME game be
   *  re-aimed: an id compared against itself never changes. */
  target?: { id: string; nonce: number } | null
  onApplied?: () => void
}) {
  const qc = useQueryClient()
  const [target, setTarget] = useState<Game | null>(null)
  const [gameQuery, setGameQuery] = useState('')
  const [mode, setMode] = useState<LookupMode>('name')
  const [query, setQuery] = useState('')
  const [romnom, setRomnom] = useState('')
  const [romsize, setRomsize] = useState('')
  const [gameRef, setGameRef] = useState('')
  const [hashKind, setHashKind] = useState<'crc' | 'md5' | 'sha1'>('crc')
  const [hash, setHash] = useState('')
  const [serial, setSerial] = useState('')
  const [system, setSystem] = useState<string | null>(null)
  const [results, setResults] = useState<SearchCandidate[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [picked, setPicked] = useState<SearchCandidate | null>(null)
  const [accepted, setAccepted] = useState<FillableField[]>([])
  const [busy, setBusy] = useState(false)
  const [aimedAt, setAimedAt] = useState<number | null>(null)

  function chooseTarget(g: Game | null) {
    setTarget(g)
    setResults(null); setNote(null); setPicked(null)
    if (g) {
      // Its own title, filename and system are the right starting point — the
      // whole reason we are here is that they did not match automatically.
      setQuery(g.title)
      setRomnom(romName(g) ?? '')
      setSystem(systemOf(g as unknown as StudioGame))
    }
  }

  // Adjust-during-render (the FoodLogModal `wasOpen` precedent) rather than an
  // effect: the caller hands over a game and this picks it up exactly once.
  if (aim && aim.nonce !== aimedAt) {
    setAimedAt(aim.nonce)
    const g = games.find(x => x.id === aim.id)
    if (g) chooseTarget(g)
  }

  const gameMatches = useMemo(() => {
    const q = gameQuery.trim().toLowerCase()
    const pool = q ? games.filter(g => g.title.toLowerCase().includes(q)) : games
    return pool.slice(0, 20)
  }, [games, gameQuery])

  const canRun =
    mode === 'name' ? !!query.trim()
      : mode === 'rom' ? !!romnom.trim()
        : mode === 'gameid' ? /^\d+$/.test(gameRef.trim())
          : mode === 'hash' ? !!hash.trim()
            : !!serial.trim()

  async function run() {
    if (!canRun) return
    setBusy(true); setResults(null); setNote(null)
    const tid = toast.loading('Asking ScreenScraper…')
    try {
      const res = await lookupScreenScraper({
        mode, system,
        query: query.trim(),
        romnom: romnom.trim(),
        romtaille: romsize.trim() ? Number(romsize.trim()) : null,
        gameRef: gameRef.trim(),
        hashKind, hash: hash.trim(),
        serial: serial.trim(),
      })
      toast.dismiss(tid)
      if (res.status !== 'ok') { toast.warning(res.message ?? 'ScreenScraper is not configured'); return }
      setResults(res.results ?? [])
      setNote(res.message ?? null)
    } catch (e) {
      toast.dismiss(tid)
      const msg = (e as Error).message
      logError(`screenscraper_lookup_${mode}: ${msg}`)
      toast.error(msg)
    } finally { setBusy(false) }
  }

  function pick(c: SearchCandidate) {
    setPicked(c)
    // Everything they can fill, ticked — untick from the comparison.
    const rows = compareFields(
      (target ?? {}) as Partial<Record<FillableField, unknown>>,
      c as unknown as Partial<Record<FillableField, unknown>>,
    )
    setAccepted(rows.filter(r => r.verdict === 'only_theirs').map(r => r.field))
  }

  async function apply() {
    if (!target || !picked?.jeu_id) return
    setBusy(true)
    const tid = toast.loading(`Saving ${picked.title ?? ''}…`)
    try {
      const res = await applyMatch({
        gameId: target.id, jeuId: picked.jeu_id,
        // Only a fallback now: the entry is fetched by its id first.
        query: mode === 'name' ? query.trim() : undefined,
        system, fields: accepted,
      })
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

  const activeHint = MODES.find(m => m.mode === mode)?.hint ?? ''

  return (
    <div className="rounded-xl border border-ink-200 bg-cream-50 p-4 space-y-3">
      <div>
        <h3 className="text-sm font-bold text-ink-900">Look one up yourself</h3>
        <p className="text-xs text-ink-500">
          For a game the automatic match got wrong or could not find. Only fields your game is
          missing are ever written.
        </p>
      </div>

      <div>
        <label className="text-xs text-ink-400 mb-1 block">Your game</label>
        <Combobox value={target} onChange={chooseTarget} immediate>
          <ComboboxInput className={`${inputCls} max-w-md`} placeholder="Search your library…"
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

      {/* How to ask. Name is the weakest and was the only one offered. */}
      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-xs text-ink-400">Look up by</span>
          <InfoBubble label="Which is best?">
            A hash is an exact identity and cannot be wrong. A serial is nearly as good for disc
            games. A filename is a guess that the file size sharpens. A name is a guess competing
            with every romhack that shares it — which is how this library ended up matched against
            hack collections in the first place.
          </InfoBubble>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {MODES.map(m => (
            <button key={m.mode} type="button" onClick={() => { setMode(m.mode); setResults(null); setNote(null) }}
              className={`min-h-[36px] px-2.5 text-xs font-medium rounded-lg border transition-colors ${
                mode === m.mode ? 'bg-accent-500 text-white border-accent-500' : 'bg-cream-50 text-ink-600 border-ink-200 hover:border-accent-300'
              }`}>{m.label}</button>
          ))}
        </div>
        <p className="text-[11px] text-ink-400 mt-1">{activeHint}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {mode === 'name' && (
          <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run() }}
            placeholder="Game name" className={inputCls} />
        )}
        {mode === 'rom' && (
          <>
            <input value={romnom} onChange={e => setRomnom(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run() }}
              placeholder="Contra (USA).zip" className={`${inputCls} font-mono`} />
            <input value={romsize} onChange={e => setRomsize(e.target.value.replace(/[^\d]/g, ''))}
              inputMode="numeric" placeholder="File size in bytes (optional)" className={inputCls} />
          </>
        )}
        {mode === 'gameid' && (
          <input value={gameRef} onChange={e => setGameRef(e.target.value.replace(/[^\d]/g, ''))}
            inputMode="numeric" onKeyDown={e => { if (e.key === 'Enter') run() }}
            placeholder="e.g. 19017" className={inputCls} />
        )}
        {mode === 'hash' && (
          <>
            <div className="flex gap-1.5">
              {(['crc', 'md5', 'sha1'] as const).map(k => (
                <button key={k} type="button" onClick={() => setHashKind(k)}
                  className={`min-h-[44px] px-3 text-xs font-semibold rounded-lg border uppercase transition-colors ${
                    hashKind === k ? 'bg-accent-500 text-white border-accent-500' : 'bg-cream-50 text-ink-600 border-ink-200'
                  }`}>{k}</button>
              ))}
            </div>
            <input value={hash} onChange={e => setHash(e.target.value.trim())} onKeyDown={e => { if (e.key === 'Enter') run() }}
              placeholder={hashKind === 'crc' ? '8 hex characters' : hashKind === 'md5' ? '32 hex characters' : '40 hex characters'}
              className={`${inputCls} font-mono`} />
          </>
        )}
        {mode === 'serial' && (
          <input value={serial} onChange={e => setSerial(e.target.value.toUpperCase())} onKeyDown={e => { if (e.key === 'Enter') run() }}
            placeholder="SLUS-00001" className={`${inputCls} font-mono`} />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={run} disabled={busy || !canRun}
          className="min-h-[44px] px-4 text-sm font-semibold bg-accent-500 hover:bg-accent-600 text-white rounded-lg disabled:opacity-40 transition-colors">
          {busy ? 'Asking…' : 'Look up'}
        </button>
        <span className="text-xs text-ink-500">
          {system ? `in ${systemMeta(system).label}` : 'across every system'}
        </span>
        {system && (
          <button type="button" onClick={() => setSystem(null)} className="min-h-[36px] px-2 text-xs text-ink-500 underline">
            Search every system
          </button>
        )}
        {!system && target && systemOf(target as unknown as StudioGame) && (
          <button type="button" onClick={() => setSystem(systemOf(target as unknown as StudioGame))}
            className="min-h-[36px] px-2 text-xs text-ink-500 underline">
            Only its own system
          </button>
        )}
      </div>

      {note && <p className="text-xs text-ink-500">{note}</p>}

      {results && results.length > 0 && (
        <ul className="space-y-2">
          {results.map(r => {
            const rows = compareFields(
              (target ?? {}) as Partial<Record<FillableField, unknown>>,
              r as unknown as Partial<Record<FillableField, unknown>>,
            )
            const { agree, comparable } = comparableAgreement(rows)
            return (
              <li key={r.jeu_id ?? r.title} className="rounded-lg border border-ink-200 p-2.5 space-y-1.5">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink-800">{r.title ?? '—'}</p>
                    <p className="text-[11px] text-ink-500">
                      {[r.system, r.release_year, r.publisher].filter(Boolean).join(' · ') || 'no details'}
                      {r.has_cover ? ' · has cover art' : ' · no cover art'}
                    </p>
                    <div className="flex items-center gap-1 flex-wrap mt-0.5">
                      {comparable > 0 && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                          agree === comparable ? 'bg-green-100 text-green-700 border-green-200'
                            : agree === 0 ? 'bg-red-100 text-red-600 border-red-200'
                              : 'bg-amber-100 text-amber-700 border-amber-200'
                        }`}>{agree}/{comparable} of your fields agree</span>
                      )}
                      {r.flags?.map(f => (
                        <span key={f} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                          /hack|not a game|proto|beta|demo/.test(f)
                            ? 'bg-red-100 text-red-600 border-red-200'
                            : 'bg-ink-100 text-ink-500 border-ink-200'
                        }`}>{f}</span>
                      ))}
                    </div>
                  </div>
                  <button type="button" onClick={() => pick(r)} disabled={!target || !r.jeu_id}
                    title={target ? undefined : 'Pick one of your games first'}
                    className="min-h-[36px] px-2.5 text-xs font-semibold rounded-lg border border-ink-200 text-ink-600 hover:border-accent-400 hover:text-accent-700 disabled:opacity-40 flex-shrink-0">
                    Use this
                  </button>
                </div>
                {target && <FieldCompare game={target as unknown as StudioGame} candidate={r as unknown as Partial<Record<FillableField, unknown>>} />}
              </li>
            )
          })}
        </ul>
      )}
      {results && results.length === 0 && !note && <p className="text-xs text-ink-500">Nothing came back.</p>}

      <ConfirmDialog
        open={!!picked}
        title="Save this match?"
        confirmLabel="Save"
        message={
          `"${target?.title ?? ''}" will take ${accepted.length} field${accepted.length === 1 ? '' : 's'} from "${picked?.title ?? ''}"`
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
