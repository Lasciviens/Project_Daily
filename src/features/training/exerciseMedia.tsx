import { useMemo, useState } from 'react'
import { Pencil } from 'lucide-react'
import { ModalShell } from '../../shared/modals'
import { Button } from '../../shared/ui'
import { useExerciseGifOverrides, useUpsertExerciseGifOverride, useDeleteExerciseGifOverride } from './hooks/useExerciseGifOverrides'
import { resolveExerciseGif } from './exerciseGifResolver'
import { useExerciseImageDb } from './hooks/useExerciseImageDb'

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
        className="shrink-0 overflow-hidden rounded-lg border border-line bg-surface-2"
        style={{ width: size, height: size }}
        aria-label={`Show ${title} demo`}
      >
        <img src={match.gifUrl} alt="" loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      </button>

      <ModalShell open={open} onClose={() => setOpen(false)} title={title} size="sm">
        <div className="flex flex-col gap-3">
          <img src={match.gifUrl} alt={title} className="w-full rounded-row border border-line bg-surface-2" />
          {match.overridden && <p className="text-meta text-fg-muted">Manually set for this exercise.</p>}
          {!match.overridden && match.name.toLowerCase() !== title.toLowerCase() && (
            <p className="text-meta text-fg-muted">Demo: {match.name}</p>
          )}
          {match.instructions.length > 0 && (
            <ol className="flex list-inside list-decimal flex-col gap-1.5">
              {match.instructions.map((step, i) => (
                <li key={i} className="text-body leading-relaxed text-fg-2">{step}</li>
              ))}
            </ol>
          )}
        </div>
      </ModalShell>
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
        className="btn-ghost btn-sm shrink-0 gap-1 self-start px-2 text-meta text-fg-muted"
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden />
        {existing ? 'GIF (fixed)' : 'Fix GIF'}
      </button>

      <ModalShell open={open} onClose={() => setOpen(false)} title={`Fix GIF — ${title}`} size="sm">
        <div className="flex flex-col gap-4">
          {existing && (
            <div className="flex items-center gap-3 rounded-row border border-line bg-surface-2 p-2.5">
              <img src={existing.gif_url} alt="" className="h-14 w-14 rounded-md border border-line object-cover" />
              <div className="min-w-0 flex-1">
                <p className="text-meta font-semibold text-fg-2">Currently manually set</p>
                <p className="truncate text-micro font-normal text-fg-muted">{existing.gif_url}</p>
              </div>
              <Button size="sm" variant="ghost" className="shrink-0 !text-danger" loading={remove.isPending} onClick={() => remove.mutate(templateId)}>
                Revert
              </Button>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`gif-search-${templateId}`} className="field-label">Search the demo GIF library</label>
            <input
              id={`gif-search-${templateId}`}
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="e.g. incline dumbbell press"
              className="input w-full"
            />
            {results.length > 0 && (
              <div className="flex max-h-56 flex-col divide-y divide-line overflow-y-auto rounded-row border border-line">
                {results.map(r => (
                  <button
                    key={r.name}
                    type="button"
                    onClick={() => pick(r.gifUrl, 'exercisegymgifsdb')}
                    className="flex min-h-[44px] items-center gap-2.5 p-2 text-left hover:bg-surface-hover"
                  >
                    <img src={r.gifUrl} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded border border-line object-cover" />
                    <span className="min-w-0 flex-1 truncate text-body text-fg-2">{r.name}</span>
                  </button>
                ))}
              </div>
            )}
            {query.trim() && results.length === 0 && (
              <p className="text-meta text-fg-muted">No matches in the demo library — paste a GIF URL below instead.</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`gif-url-${templateId}`} className="field-label">Or paste a GIF URL directly</label>
            <div className="flex gap-2">
              <input
                id={`gif-url-${templateId}`}
                type="url"
                value={customUrl}
                onChange={e => setCustomUrl(e.target.value)}
                placeholder="https://…"
                className="input min-w-0 flex-1"
              />
              <Button variant="primary" disabled={!customUrl.trim()} loading={upsert.isPending} onClick={() => pick(customUrl.trim(), 'manual')}>
                Save
              </Button>
            </div>
            <p className="text-meta text-fg-muted">For an exercise the demo library doesn&apos;t have at all — any public, direct GIF/image URL works.</p>
          </div>
        </div>
      </ModalShell>
    </>
  )
}
