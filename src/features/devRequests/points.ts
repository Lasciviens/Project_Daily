// Pure: a request's points and how each fared after it was sent to Claude.
//   points      every paragraph of the text (pointText.ts), plus older
//               "- [ ]" checkpoints; a ticked old checkpoint reads as Fixed
//   reviews     Fixed / Not fixed (+ a note of what is still wrong) / Moved,
//               stored as `[[review …]]` lines in the description
//   re-check    Not fixed points are collected into ONE follow-up request per
//               original ("Re-check: <title>"), with their picked spots and a
//               back-reference; the original's point then reads Moved.
// Everything stays plain text in dev_requests.description (no migration).
// Pure (imports only other pure modules) so the verify script can require it.

import {
  REF_RE, composeDescription, encodeMark, foldCheckpoints, parseDescription, pointTexts,
  type Mark, type ParsedDescription, type PickMark, type PointReview, type ReviewState,
} from './devRequestMarks'
import { pointKeys } from './pointText'

export interface Point {
  key: string
  /** 1-based, as shown and as the prompt numbers it (1.2 = item 1, point 2). */
  n: number
  text: string
  review: PointReview | null
  /** Fixed / Not fixed / Moved; null = not reviewed yet. */
  state: ReviewState | null
}

export function requestPoints(p: Pick<ParsedDescription, 'body' | 'checkpoints' | 'reviews'>): Point[] {
  const texts = pointTexts(p)
  const keys = pointKeys(texts)
  const firstCp = texts.length - p.checkpoints.filter(c => c.text.trim()).length
  const cps = p.checkpoints.filter(c => c.text.trim())
  return texts.map((text, i) => {
    const review = p.reviews.find(r => r.key === keys[i]) ?? null
    const oldTick = i >= firstCp && cps[i - firstCp]?.done
    return { key: keys[i], n: i + 1, text, review, state: review?.state ?? (oldTick ? 'fixed' : null) }
  })
}

export const pointsOf = (description: string | null | undefined): Point[] => requestPoints(parseDescription(description))

/** Points can be reviewed once the request went to Claude (or is being worked on / done). */
export const isReviewable = (row: { status: string; prompted_at?: string | null }): boolean =>
  !!row.prompted_at || row.status === 'in_progress' || row.status === 'done'

export interface ReviewCounts { total: number; fixed: number; notFixed: number; moved: number; open: number }

export function reviewCounts(points: readonly Point[]): ReviewCounts {
  const c = { total: points.length, fixed: 0, notFixed: 0, moved: 0, open: 0 }
  for (const p of points) {
    if (p.state === 'fixed') c.fixed++
    else if (p.state === 'not_fixed') c.notFixed++
    else if (p.state === 'moved') c.moved++
    else c.open++
  }
  return c
}

/** "2 of 5 fixed · 1 not fixed · 1 moved"; '' before anything was reviewed. */
export function reviewProgress(points: readonly Point[]): string {
  const c = reviewCounts(points)
  if (c.fixed + c.notFixed + c.moved === 0) return ''
  return [`${c.fixed} of ${c.total} fixed`, c.notFixed ? `${c.notFixed} not fixed` : '', c.moved ? `${c.moved} moved` : ''].filter(Boolean).join(' · ')
}

/** Every point is Fixed or moved to a re-check: the request itself can be closed. */
export const allResolved = (points: readonly Point[]): boolean =>
  points.length > 0 && points.every(p => p.state === 'fixed' || p.state === 'moved')

/**
 * Sets (or with null clears) the review of one point. Older checkpoints are
 * folded into the text first, so a cleared review of a ticked one really
 * clears. A key the text no longer has changes nothing.
 */
export function setReview(text: string, key: string, review: Omit<PointReview, 'key'> | null): string {
  const p = foldCheckpoints(parseDescription(text))
  if (!requestPoints(p).some(pt => pt.key === key)) return text
  const reviews = p.reviews.filter(r => r.key !== key)
  if (review) reviews.push({ ...review, key })
  return composeDescription({ ...p, reviews })
}

// ── Re-check requests ─────────────────────────────────────────────────────────

export const RECHECK_PREFIX = 'Re-check: '
export const recheckTitle = (title: string) => `${RECHECK_PREFIX}${title.trim().replace(/^(Re-check: )+/, '')}`
/** The line a collected point carries under the original's words. */
export const STILL_RE = /^Still not fixed\b/

/**
 * The open re-check request already collecting points of `originalId` (the
 * newest one); a done or dismissed one is not added to — a new one starts.
 */
export function findRecheck<T extends { id: string; status: string; description: string | null; created_at?: string }>(
  requests: readonly T[], originalId: string,
): T | null {
  const open = requests.filter(r => (r.status === 'open' || r.status === 'in_progress') && parseDescription(r.description).recheck?.of === originalId)
  open.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  return open[0] ?? null
}

function shortId(taken: Set<string>): string {
  for (;;) {
    const id = Math.random().toString(36).slice(2, 7)
    if (id.length >= 2 && !taken.has(id)) return id
  }
}

/**
 * The re-check request's description with `keys` (Not fixed points of the
 * original) added: each becomes a point of its own — the original words
 * (links included: the picks they point at are copied along, so Go there and
 * the prompt's footnotes still work) and a "Still not fixed: …" line. Points
 * collected before are skipped, so a retry after a failed second write never
 * doubles one. `existing` null = a new re-check request (it also takes the
 * page the original was written on).
 */
export function collectForRecheck(
  existing: string | null,
  original: { id: string; title: string; description: string | null },
  keys: readonly string[],
): { description: string; added: string[] } {
  const src = parseDescription(original.description)
  const points = requestPoints(src)
  const dst = existing != null ? parseDescription(existing) : null
  const recheck = dst?.recheck ?? { of: original.id, title: original.title, keys: [] }
  const body = dst ? foldCheckpoints(dst).body.replace(/\s+$/, '') : ''
  const marks: Mark[] = dst ? [...dst.marks] : src.marks.filter(m => m.type === 'page').slice(0, 1)
  const srcPicks = new Map(src.marks.flatMap(m => (m.type === 'pick' && m.id ? [[m.id, m] as const] : [])))
  const taken = new Set(marks.flatMap(m => (m.type === 'pick' && m.id ? [m.id] : [])))
  const renamed = new Map<string, string>()
  const paras: string[] = []
  const added: string[] = []
  for (const key of keys) {
    const pt = points.find(p => p.key === key)
    if (!pt || recheck.keys.includes(key)) continue
    const text = pt.text.replace(REF_RE, (whole, id: string) => {
      const pick = srcPicks.get(id)
      if (!pick) return whole
      const again = renamed.get(id)
      if (again) return `[[@${again}]]`
      const same = marks.find((m): m is PickMark => m.type === 'pick' && m.id === id)
      if (same && encodeMark(same) === encodeMark(pick)) return whole
      // Copied once; an id the re-check request already uses for another spot gets a new one.
      const nid = same ? shortId(taken) : id
      taken.add(nid)
      renamed.set(id, nid)
      marks.push({ ...pick, id: nid })
      return `[[@${nid}]]`
    })
    const note = pt.review?.note?.trim()
    paras.push(`${text}\n${note ? `Still not fixed: ${note.replace(/\s*\n\s*/g, ' ')}` : 'Still not fixed.'}`)
    added.push(key)
  }
  const description = composeDescription({
    body: [body, ...paras].filter(Boolean).join('\n\n'),
    checkpoints: [],
    marks,
    reviews: dst ? foldCheckpoints(dst).reviews : [],
    recheck: { ...recheck, keys: [...recheck.keys, ...added] },
  })
  return { description, added }
}

/** The original after its points went to re-check request `toId`: each reads Moved (its note kept). */
export function markMoved(text: string, keys: readonly string[], toId: string, at?: string): string {
  let next = text
  for (const key of keys) {
    const prev = pointsOf(next).find(p => p.key === key)?.review
    next = setReview(next, key, { state: 'moved', to: toId, ...(prev?.note ? { note: prev.note } : {}), ...(at ? { at } : {}) })
  }
  return next
}

/** Not fixed points that are still here (not moved yet). */
export const notFixedKeys = (points: readonly Point[]) => points.filter(p => p.state === 'not_fixed').map(p => p.key)
