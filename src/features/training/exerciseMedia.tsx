import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'
import { useExerciseGifOverrides, useUpsertExerciseGifOverride, useDeleteExerciseGifOverride } from './hooks/useExerciseGifOverrides'
import { resolveExerciseGif, normalizeTokens, type IndexedExercise } from './exerciseGifResolver'

// ─────────────────────────────────────────────────────────────────────────────
//  Exercise demo GIFs.
//  Source: JahelCuadrado/ExerciseGymGifsDB — 1323 animated exercise GIFs with a
//  clean JSON manifest, served CORS-open from jsDelivr (no API key, no proxy,
//  works from a static GitHub Pages client). Hevy exercise names
//  ("Bench Press (Barbell)") don't match the dataset's ("Barbell Bench Press")
//  exactly, so we fuzzy-match at runtime: normalize → token-overlap (Jaccard) +
//  an equipment-hint bonus, best match above a threshold, else null (graceful
//  fallback — never a broken img). Each card shows a small looping thumbnail;
//  tapping it opens a larger view with the movement instructions.
//
//  SELF-HOST PATH: the dataset's own gifUrl is used as-is, so every GIF URL is
//  anchored to `GIF_SOURCE`. To move off the public CDN onto our own Supabase
//  Storage later, mirror the repo's gifs into a bucket and rewrite `gifUrl` (or
//  swap `GIF_SOURCE`) — the matching/UI code below doesn't change. This is a
//  separate concern from the manual-override table below: overrides only ever
//  store a URL, never binary GIF data, so self-hosting the DATASET and
//  overriding individual MATCHES can be done independently of each other.
//
//  MANUAL OVERRIDES (migration 082, exercise_gif_overrides) — the fuzzy
//  matcher has no ground truth to correct itself against, so a wrong match
//  (or a real exercise this 1323-entry dataset just doesn't have) had no fix
//  short of a code change. `resolveExerciseGif` checks a per-user override
//  table FIRST, keyed on the exercise's stable `exercise_template_id` (never
//  its title, which the user can rename inside Hevy itself) before falling
//  back to the fuzzy matcher. `ExerciseGifPicker` is the editor UI — it
//  reuses the SAME already-fetched dataset (useExerciseImageDb) for
//  searching a better match, or accepts any pasted URL for an exercise the
//  dataset has no entry for at all.
// ─────────────────────────────────────────────────────────────────────────────

const GIF_SOURCE = 'https://cdn.jsdelivr.net/gh/JahelCuadrado/ExerciseGymGifsDB@v1.1.0'
const MANIFEST_URL = `${GIF_SOURCE}/api/en/exercises.json`

interface RawExercise {
  name: string
  equipment: string | null
  gifUrl: string
  instructions?: string[]
}

// Fetched + indexed once, cached forever (the dataset is static). Exported so
// the manual-override picker below can search the SAME already-loaded
// dataset rather than fetching it a second time.
export function useExerciseImageDb() {
  return useQuery({
    queryKey: ['exercise-gif-db'],
    queryFn: async (): Promise<IndexedExercise[]> => {
      const res = await fetch(MANIFEST_URL)
      if (!res.ok) throw new Error(`exercise-gif-db ${res.status}`)
      // Manifest is { count, exercises: [...] } — not a bare array.
      const json = await res.json()
      const raw: RawExercise[] = Array.isArray(json) ? json : (json.exercises ?? [])
      return raw
        .filter(e => e.gifUrl)
        .map(e => ({
          name: e.name,
          tokens: normalizeTokens(e.name).tokens,
          equipment: e.equipment,
          gifUrl: e.gifUrl,
          instructions: e.instructions ?? [],
        }))
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  })
}

/**
 * Looping demo GIF thumbnail for an exercise, matched by name to
 * ExerciseGymGifsDB (or a manual override, if one exists for this
 * `templateId`). Tapping opens a larger view with the instructions.
 * Renders nothing on no-match or load error (graceful — never a broken box).
 * `templateId` is optional so existing call sites keep working unchanged;
 * omitting it just means this render can never pick up a manual override.
 */
export function ExerciseThumb({ title, templateId, size = 48 }: { title: string; templateId?: string; size?: number }) {
  const { data: db } = useExerciseImageDb()
  const { data: overrides } = useExerciseGifOverrides()
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const overridesByTemplateId = useMemo(() => new Map((overrides ?? []).map(o => [o.exercise_template_id, o.gif_url])), [overrides])
  const match = useMemo(() => (db ? resolveExerciseGif(templateId, title, overridesByTemplateId, db) : null), [title, templateId, overridesByTemplateId, db])

  if (!match || failed) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-lg overflow-hidden border border-ink-200 bg-cream-100 focus:outline-none focus:ring-2 focus:ring-accent-400"
        style={{ width: size, height: size }}
        aria-label={`Show ${title} demo`}
      >
        <img
          src={match.gifUrl}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover"
        />
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} className="relative z-[70]">
        <DialogBackdrop transition className="fixed inset-0 bg-ink-900/50 backdrop-blur-sm transition duration-200 data-[closed]:opacity-0" />
        <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <DialogPanel transition className="w-full sm:max-w-md max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-cream-50 border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95">
            <div className="flex items-center justify-between px-4 py-3 border-b border-ink-100 sticky top-0 bg-cream-50">
              <h3 className="text-sm font-semibold text-ink-800 truncate pr-2">{title}</h3>
              <button
                onClick={() => setOpen(false)}
                className="w-9 h-9 flex items-center justify-center text-ink-400 hover:text-ink-700 text-xl leading-none shrink-0"
              >
                ×
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <img
                src={match.gifUrl}
                alt={title}
                className="w-full rounded-xl border border-ink-100 bg-cream-100"
              />
              {match.overridden && (
                <p className="text-[11px] text-accent-700">✎ Manually set for this exercise.</p>
              )}
              {!match.overridden && match.name.toLowerCase() !== title.toLowerCase() && (
                <p className="text-[11px] text-ink-400">Demo: {match.name}</p>
              )}
              {match.instructions.length > 0 && (
                <ol className="flex flex-col gap-1.5 list-decimal list-inside">
                  {match.instructions.map((step, i) => (
                    <li key={i} className="text-xs text-ink-600 leading-relaxed">{step}</li>
                  ))}
                </ol>
              )}
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  )
}

/**
 * The manual-override editor — search the same ExerciseGymGifsDB dataset
 * ExerciseThumb already loads for a better match, or paste any GIF URL for
 * an exercise the dataset has no entry for at all. Rendered as an "✎ Fix
 * GIF" affordance next to a thumbnail; deliberately only wired into
 * ExerciseTemplatesTab (the one canonical list of every exercise) rather
 * than every ExerciseThumb call site — one clear place to manage overrides
 * beats a pencil icon on every card in five different tabs.
 */
export function ExerciseGifPicker({ templateId, title }: { templateId: string; title: string }) {
  const { data: db } = useExerciseImageDb()
  const { data: overrides } = useExerciseGifOverrides()
  const upsert = useUpsertExerciseGifOverride()
  const remove = useDeleteExerciseGifOverride()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [customUrl, setCustomUrl] = useState('')

  const existing = overrides?.find(o => o.exercise_template_id === templateId)

  const results = useMemo(() => {
    if (!db || !query.trim()) return []
    const q = query.trim().toLowerCase()
    return db.filter(e => e.name.toLowerCase().includes(q)).slice(0, 20)
  }, [db, query])

  function pick(gifUrl: string, source: 'manual' | 'exercisegymgifsdb') {
    upsert.mutate({ templateId, gifUrl, source }, { onSuccess: () => setOpen(false) })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] font-semibold text-ink-400 hover:text-accent-700 min-h-[32px] px-1 shrink-0"
      >
        {existing ? '✎ GIF (fixed)' : '✎ Fix GIF'}
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} className="relative z-[70]">
        <DialogBackdrop transition className="fixed inset-0 bg-ink-900/50 backdrop-blur-sm transition duration-200 data-[closed]:opacity-0" />
        <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <DialogPanel transition className="w-full sm:max-w-md max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-cream-50 border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95">
            <div className="flex items-center justify-between px-4 py-3 border-b border-ink-100 sticky top-0 bg-cream-50">
              <h3 className="text-sm font-semibold text-ink-800 truncate pr-2">Fix GIF — {title}</h3>
              <button onClick={() => setOpen(false)} className="w-9 h-9 flex items-center justify-center text-ink-400 hover:text-ink-700 text-xl leading-none shrink-0">×</button>
            </div>

            <div className="p-4 flex flex-col gap-4">
              {existing && (
                <div className="flex items-center gap-3 p-2.5 rounded-lg border border-ink-200 bg-cream-100">
                  <img src={existing.gif_url} alt="" className="w-14 h-14 rounded-md object-cover border border-ink-200" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-ink-700">Currently manually set</p>
                    <p className="text-[11px] text-ink-400 truncate">{existing.gif_url}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove.mutate(templateId)}
                    className="text-[11px] font-semibold text-red-600 hover:text-red-700 min-h-[36px] px-2 shrink-0"
                  >
                    Revert
                  </button>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-ink-600">Search the demo GIF library</label>
                <input
                  type="search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="e.g. incline dumbbell press"
                  className="w-full min-h-[44px] bg-cream-50 border border-ink-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400"
                />
                {results.length > 0 && (
                  <div className="flex flex-col gap-1 max-h-56 overflow-y-auto border border-ink-200 rounded-lg divide-y divide-ink-100">
                    {results.map(r => (
                      <button
                        key={r.name}
                        type="button"
                        onClick={() => pick(r.gifUrl, 'exercisegymgifsdb')}
                        className="flex items-center gap-2.5 p-2 min-h-[44px] hover:bg-cream-100 text-left"
                      >
                        <img src={r.gifUrl} alt="" loading="lazy" className="w-10 h-10 rounded object-cover border border-ink-200 shrink-0" />
                        <span className="text-xs text-ink-700 flex-1 min-w-0 truncate">{r.name}</span>
                      </button>
                    ))}
                  </div>
                )}
                {query.trim() && results.length === 0 && (
                  <p className="text-xs text-ink-400">No matches in the demo library — paste a GIF URL below instead.</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-ink-600">Or paste a GIF URL directly</label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={customUrl}
                    onChange={e => setCustomUrl(e.target.value)}
                    placeholder="https://…"
                    className="flex-1 min-w-0 min-h-[44px] bg-cream-50 border border-ink-200 rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-400"
                  />
                  <button
                    type="button"
                    disabled={!customUrl.trim()}
                    onClick={() => pick(customUrl.trim(), 'manual')}
                    className="min-h-[44px] px-3 rounded-lg bg-ink-950 text-white text-xs font-semibold disabled:opacity-40"
                  >
                    Save
                  </button>
                </div>
                <p className="text-[11px] text-ink-300">For an exercise the demo library doesn&apos;t have at all — any public, direct GIF/image URL works.</p>
              </div>
            </div>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  )
}
