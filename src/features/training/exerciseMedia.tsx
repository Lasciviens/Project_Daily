import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'

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
//  swap `GIF_SOURCE`) — the matching/UI code below doesn't change.
// ─────────────────────────────────────────────────────────────────────────────

const GIF_SOURCE = 'https://cdn.jsdelivr.net/gh/JahelCuadrado/ExerciseGymGifsDB@v1.1.0'
const MANIFEST_URL = `${GIF_SOURCE}/api/en/exercises.json`

interface RawExercise {
  name: string
  equipment: string | null
  gifUrl: string
  instructions?: string[]
}
interface IndexedExercise {
  name: string
  tokens: Set<string>
  equipment: string | null
  gifUrl: string
  instructions: string[]
}

// Tokens that add noise rather than identity when matching exercise names.
const NOISE = new Set([
  'the', 'with', 'grip', 'medium', 'wide', 'close', 'standing', 'seated',
  'machine', 'exercise', 'a', 'of', 'to', 'and', 'or', 'bar', 'v', 'up',
])
const EQUIP = ['barbell', 'dumbbell', 'cable', 'machine', 'kettlebell', 'band', 'bodyweight', 'smith']

function normalizeTokens(title: string): { tokens: Set<string>; equip: string | null } {
  const lower = title.toLowerCase()
  const paren = lower.match(/\(([^)]+)\)/)?.[1] ?? ''
  let equip: string | null = null
  for (const e of EQUIP) {
    if (paren.includes(e) || lower.includes(e)) { equip = e; break }
  }
  const cleaned = lower.replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ')
  const tokens = new Set(cleaned.split(/\s+/).filter(t => t.length > 1 && !NOISE.has(t)))
  return { tokens, equip }
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

// Fetched + indexed once, cached forever (the dataset is static).
function useExerciseImageDb() {
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

function matchExercise(hevyTitle: string, db: IndexedExercise[]): IndexedExercise | null {
  const { tokens, equip } = normalizeTokens(hevyTitle)
  if (tokens.size === 0) return null
  let best: { ex: IndexedExercise; s: number } | null = null
  for (const ex of db) {
    let s = jaccard(tokens, ex.tokens)
    if (equip && ex.equipment === equip) s += 0.15
    if (!best || s > best.s) best = { ex, s }
  }
  if (!best || best.s < 0.5) return null
  return best.ex
}

/**
 * Looping demo GIF thumbnail for an exercise, matched by name to
 * ExerciseGymGifsDB. Tapping opens a larger view with the instructions.
 * Renders nothing on no-match or load error (graceful — never a broken box).
 */
export function ExerciseThumb({ title, size = 48 }: { title: string; size?: number }) {
  const { data: db } = useExerciseImageDb()
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const match = useMemo(() => (db ? matchExercise(title, db) : null), [title, db])

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
        <DialogBackdrop transition className="fixed inset-0 bg-ink-900/50 transition duration-200 data-[closed]:opacity-0" />
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
              {match.name.toLowerCase() !== title.toLowerCase() && (
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
