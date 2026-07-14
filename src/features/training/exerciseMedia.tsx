import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

// ─────────────────────────────────────────────────────────────────────────────
//  Exercise demo images — TEST integration.
//  Source: yuhonas/free-exercise-db — public-domain (Unlicense) dataset of ~873
//  exercises with static demo photos, served CORS-open from jsDelivr (no API
//  key, no proxy, works from a static GitHub Pages client). Hevy exercise names
//  ("Bench Press (Barbell)") don't match the dataset's names
//  ("Barbell Bench Press - Medium Grip") exactly, so we fuzzy-match at runtime:
//  normalize → token-overlap (Jaccard) + an equipment-hint bonus, best match
//  above a threshold, else null (graceful no-image fallback — never a broken img).
//
//  This is a lightweight test (runtime match, no DB). If we keep it, the durable
//  version bakes the matched slug onto hevy_exercise_templates so runtime is a
//  pure lookup (see the research notes / a future migration).
// ─────────────────────────────────────────────────────────────────────────────

const DATA_URL = 'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/dist/exercises.json'
const IMG_BASE = 'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises'

interface RawExercise { id: string; name: string; equipment: string | null; images: string[] }
interface IndexedExercise { id: string; tokens: Set<string>; equipment: string | null }

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
    queryKey: ['exercise-image-db'],
    queryFn: async (): Promise<IndexedExercise[]> => {
      const res = await fetch(DATA_URL)
      if (!res.ok) throw new Error(`exercise-db ${res.status}`)
      const raw: RawExercise[] = await res.json()
      return raw
        .filter(e => e.images?.length)
        .map(e => ({ id: e.id, equipment: e.equipment, tokens: normalizeTokens(e.name).tokens }))
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  })
}

function matchExerciseImage(hevyTitle: string, db: IndexedExercise[]): string | null {
  const { tokens, equip } = normalizeTokens(hevyTitle)
  if (tokens.size === 0) return null
  let best: { id: string; s: number } | null = null
  for (const ex of db) {
    let s = jaccard(tokens, ex.tokens)
    if (equip && ex.equipment === equip) s += 0.15
    if (!best || s > best.s) best = { id: ex.id, s }
  }
  if (!best || best.s < 0.5) return null
  return `${IMG_BASE}/${best.id}/0.jpg`
}

/**
 * Small demo thumbnail for an exercise, matched by name to free-exercise-db.
 * Renders nothing on no-match or image error (graceful — never a broken box).
 */
export function ExerciseThumb({ title, size = 44 }: { title: string; size?: number }) {
  const { data: db } = useExerciseImageDb()
  const [failed, setFailed] = useState(false)
  const url = useMemo(() => (db ? matchExerciseImage(title, db) : null), [title, db])

  if (!url || failed) return null
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      style={{ width: size, height: size }}
      className="rounded-lg object-cover border border-ink-200 bg-cream-100 shrink-0"
    />
  )
}
