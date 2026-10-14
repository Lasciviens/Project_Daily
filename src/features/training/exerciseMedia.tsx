import { useMemo, useState } from 'react'
import { Pencil } from 'lucide-react'
import { ModalShell, useEntityModal } from '../../shared/modals'
import { Button, Truncate } from '../../shared/ui'
import { useExerciseGifOverrides, useUpsertExerciseGifOverride, useDeleteExerciseGifOverride } from './hooks/useExerciseGifOverrides'
import type { ExerciseMediaChoice } from './exerciseGifResolver'
import { useExerciseImageDb } from './hooks/useExerciseImageDb'
import { useExerciseMedia } from './hooks/useExerciseMedia'

// ─────────────────────────────────────────────────────────────────────────────
//  Exercise pictures and demo GIFs.
//  HEVY FIRST (migration 154, 14.10.2026 — owner: "change that as primarily
//  to Hevy"): Hevy's exercise templates carry `thumbnail_url`, stored by both
//  syncs. The small thumbnail shows Hevy's picture; the popup's large view
//  shows an animated demo when there is one (chooseExerciseMedia in
//  exerciseGifResolver.ts has the order).
//
//  FALLBACK / ANIMATED DEMO: JahelCuadrado/ExerciseGymGifsDB — 1323 animated
//  exercise GIFs with a clean JSON manifest, served CORS-open from jsDelivr (no
//  API key, no proxy, works from a static GitHub Pages client). Hevy exercise
//  names ("Bench Press (Barbell)") don't match the dataset's ("Barbell Bench
//  Press") exactly, so we fuzzy-match at runtime: normalize → token-overlap
//  (Jaccard) + an equipment-hint bonus, best match above a threshold, else
//  null (graceful fallback — never a broken img).
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
//  back to the fuzzy matcher. An override picks the animated DEMO; Hevy's
//  picture stays the thumbnail. `ExerciseGifPicker` is the editor UI — it
//  reuses the SAME already-fetched dataset (useExerciseImageDb) for
//  searching a better match, or accepts any pasted URL for an exercise the
//  dataset has no entry for at all.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An exercise's picture: Hevy's own first, else its demo GIF (a manual
 * override or the name match). Tapping opens the exercise popup (`exercise`:
 * the larger demo, instructions, muscles and Hevy's history of it).
 * Renders nothing when there is no picture at all (graceful — never a broken
 * box); a picture that fails to load gives way to the next one.
 */
export function ExerciseThumb({ title, templateId, size = 48 }: { title: string; templateId: string; size?: number }) {
  const media = useExerciseMedia(templateId, title)
  const modal = useEntityModal()
  // The URLs that failed to load, not a boolean: saving a fixed GIF changes
  // the URL, and the new one must get its chance without a remount.
  const [failed, setFailed] = useState<string[]>([])
  const pick = media.thumbs.find(t => !failed.includes(t.url))
  if (!pick) return null

  return (
    <button
      type="button"
      onClick={() => modal.open({ kind: 'exercise', templateId, title })}
      className="shrink-0 overflow-hidden rounded-lg border border-line bg-surface-2"
      style={{ width: size, height: size }}
      aria-label={`Show ${title}`}
    >
      <img src={pick.url} alt="" loading="lazy" onError={() => setFailed(f => [...f, pick.url])} className="h-full w-full object-cover" />
    </button>
  )
}

const DEMO_SOURCE: Record<string, string> = {
  hevy: 'Picture from Hevy',
  override: 'Demo you set with Fix GIF',
}

/** The popup's large view: the demo (or Hevy's picture), where it comes
 *  from, and the dataset's instructions when it has them. */
export function ExerciseDemo({ demo, title }: { demo: NonNullable<ExerciseMediaChoice['demo']>; title: string }) {
  const [broken, setBroken] = useState<string | null>(null)
  const source = DEMO_SOURCE[demo.source]
    ?? (demo.name.toLowerCase() !== title.toLowerCase() ? `Demo: ${demo.name} · ExerciseGymGifsDB` : 'Demo from ExerciseGymGifsDB')
  return (
    <div className="flex flex-col gap-2">
      {broken !== demo.gifUrl && (
        <img src={demo.gifUrl} alt={title} onError={() => setBroken(demo.gifUrl)}
          className="mx-auto max-h-72 w-full max-w-sm rounded-row border border-line bg-surface-2 object-contain" />
      )}
      <p className="text-micro text-fg-muted">{source}</p>
      {demo.instructions.length > 0 && (
        <ol className="flex list-inside list-decimal flex-col gap-1.5">
          {demo.instructions.map((step, i) => (
            <li key={i} className="text-body leading-relaxed text-fg-2">{step}</li>
          ))}
        </ol>
      )}
    </div>
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
                <Truncate as="p" className="text-micro font-normal text-fg-muted">{existing.gif_url}</Truncate>
              </div>
              <Button size="sm" variant="ghost" className="shrink-0 !text-danger" loading={remove.busy} onClick={() => void remove.run([existing.id], { title: 'Go back to the automatic GIF?', message: title, confirmLabel: 'Revert', done: 'Back to the automatic GIF' })}>
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
                    <Truncate className="flex-1 text-body text-fg-2">{r.name}</Truncate>
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
