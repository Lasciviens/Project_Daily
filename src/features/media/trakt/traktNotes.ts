// Trakt notes ↔ personal_note (docs/trakt/PLAN.md §12 has the API facts).
// Pure and import-free (scripts/verify-trakt-notes.cjs), shared into the
// trakt-api edge function by scripts/sync-trakt-shared.mjs.
//
// One note per title: personal_note on a movie or show entry IS the Trakt
// note attached to that movie or show itself (POST /notes with a movie or
// show object). Notes Trakt attaches to a play, a rating, a collection item,
// a season, an episode or a person are never read or written here, and
// episode notes stay app-only.
//
// The sync is three-way: trakt_note_text keeps the note as both sides held it
// at the last sync (null = no note on either side then), so a sync can tell
// which side changed it. The side that changed wins; when both changed,
// Trakt wins (the owner's import rule) — except that a note edited on one
// side is never lost to a delete on the other: the edit is kept. A title
// whose note change is still waiting in the outbox (key note:<type>:<tmdb>)
// is left alone until it has gone out.
//
// Length: Trakt keeps notes up to 500 characters. A longer note goes to Trakt
// cut to its first 499 characters + "…" (never splitting an emoji); the app
// keeps the whole note, and the two count as the same note.

export const TRAKT_NOTE_MAX = 500
/** Trakt answering no notes of a type while this many here are linked is read as an outage. */
export const NOTE_OUTAGE_LINKED = 3

export type TraktNoteType = 'movie' | 'show'

/** The outbox key of a title's note (its own key: a waiting note never holds back the title's mirror). */
export const traktNoteKey = (type: TraktNoteType, tmdb: number) => `note:${type}:${tmdb}`

/** The note as Trakt holds it: trimmed, line breaks as \n, cut to 500 characters. null = no note. */
export function noteForTrakt(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null
  const t = text.replace(/\r\n?/g, '\n').trim()
  if (!t) return null
  if (t.length <= TRAKT_NOTE_MAX) return t
  let cut = TRAKT_NOTE_MAX - 1
  // Never end on the first half of a surrogate pair (an emoji).
  const last = t.charCodeAt(cut - 1)
  if (last >= 0xd800 && last <= 0xdbff) cut--
  return `${t.slice(0, cut).trimEnd()}…`
}

/** One note attached to a movie or show itself, read from Trakt. */
export interface TraktNote {
  type: TraktNoteType
  tmdb: number
  id: number
  text: string
  updatedAt: string | null
}

const isNewerNote = (a: TraktNote, b: TraktNote) =>
  (a.updatedAt ?? '') > (b.updatedAt ?? '') || ((a.updatedAt ?? '') === (b.updatedAt ?? '') && a.id > b.id)

/**
 * The rows of GET /users/me/notes/{movies|shows} (API blueprint, "Get
 * notes"): {attached_to: {type}, type, movie|show: {ids}, note: {id, notes,
 * updated_at}}. Keeps the notes attached to the movie or show itself, one per
 * title (the newest). `unreadable` counts rows without that shape — the
 * caller then leaves every note alone instead of reading a broken answer as
 * "no notes".
 */
export function parseTraktNotes(rows: unknown, type: TraktNoteType): { notes: TraktNote[]; unreadable: number } {
  const best = new Map<number, TraktNote>()
  let unreadable = 0
  for (const raw of Array.isArray(rows) ? rows : []) {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const attached = (r.attached_to && typeof r.attached_to === 'object' ? r.attached_to : null) as Record<string, unknown> | null
    const note = (r.note && typeof r.note === 'object' ? r.note : null) as Record<string, unknown> | null
    const id = Number(note?.id)
    if (!attached || typeof attached.type !== 'string' || typeof r.type !== 'string' || !note || !Number.isSafeInteger(id) || id <= 0) {
      unreadable++
      continue
    }
    // A note on a play, a rating or a collection item is not the title's own note.
    if (attached.type !== type || r.type !== type) continue
    const media = (r[type] && typeof r[type] === 'object' ? r[type] : null) as Record<string, unknown> | null
    const tmdb = Number((media?.ids as Record<string, unknown> | undefined)?.tmdb)
    // Without a TMDB id the title can't be found in the library.
    if (!Number.isSafeInteger(tmdb) || tmdb <= 0) continue
    const n: TraktNote = {
      type, tmdb, id,
      text: typeof note.notes === 'string' ? note.notes : '',
      updatedAt: typeof note.updated_at === 'string' ? note.updated_at : null,
    }
    const had = best.get(tmdb)
    if (!had || isNewerNote(n, had)) best.set(tmdb, n)
  }
  return { notes: [...best.values()], unreadable }
}

/** A library entry's note, as the sync sees it. */
export interface LocalNote {
  type: TraktNoteType
  tmdb: number
  /** personal_note — the whole note, any length. */
  note: string | null
  /** trakt_note_id — the Trakt note it is linked to. */
  noteId: number | null
  /** trakt_note_text — the note as both sides held it at the last sync (null = no note on either side). */
  synced: string | null
}

type NoteRef = { type: TraktNoteType; tmdb: number }

export type NoteAction =
  /** Write Trakt's note here (text null: Trakt deleted it, so it is cleared here). */
  | NoteRef & { kind: 'pull'; id: number | null; text: string | null; conflict?: true }
  /** Both sides hold the same text: keep the link only. */
  | NoteRef & { kind: 'link'; id: number; text: string }
  /** Neither side holds a note any more: drop a stale link. */
  | NoteRef & { kind: 'unlink' }
  /** Send the note here to Trakt: update note `id`, or add a note when id is null. */
  | NoteRef & { kind: 'push'; id: number | null; text: string; conflict?: true }
  /** The note was cleared here: delete Trakt's note `id`. */
  | NoteRef & { kind: 'remove'; id: number }

export interface NotePlan {
  actions: NoteAction[]
  /** Titles left alone: a note change is still waiting to go out. */
  kept: string[]
  /** Same text on both sides, already linked. */
  same: number
  /** Changed on both sides since the last sync. */
  conflicts: number
  /** Of those, notes typed here that Trakt's text replaces (kept in the audit log, Developer → Activity). */
  replaced: number
  /** Trakt notes on titles not in the library (left on Trakt; a note alone never adds a title). */
  notInLibrary: number
  /** Set when Trakt answered no notes of that type while several here are linked: nothing is planned. */
  outage: TraktNoteType | null
}

export function buildNotePlan(trakt: TraktNote[], local: LocalNote[], pending: Set<string>): NotePlan {
  const plan: NotePlan = { actions: [], kept: [], same: 0, conflicts: 0, replaced: 0, notInLibrary: 0, outage: null }
  for (const type of ['movie', 'show'] as const) {
    const linked = local.filter(l => l.type === type && l.noteId !== null).length
    if (linked >= NOTE_OUTAGE_LINKED && !trakt.some(t => t.type === type)) { plan.outage = type; return plan }
  }
  const theirs = new Map(trakt.map(t => [traktNoteKey(t.type, t.tmdb), t]))
  const mine = new Set<string>()
  for (const l of local) {
    const key = traktNoteKey(l.type, l.tmdb)
    mine.add(key)
    if (pending.has(key)) { plan.kept.push(key); continue }
    const t = theirs.get(key) ?? null
    const ref: NoteRef = { type: l.type, tmdb: l.tmdb }
    const here = noteForTrakt(l.note)
    const there = t ? noteForTrakt(t.text) : null
    const base = noteForTrakt(l.synced)

    if (here === there) {
      if (there === null) { if (l.noteId !== null || base !== null) plan.actions.push({ ...ref, kind: 'unlink' }) }
      else if (l.noteId !== t!.id || base !== there) plan.actions.push({ ...ref, kind: 'link', id: t!.id, text: there })
      else plan.same++
      continue
    }
    const changedHere = here !== base
    const changedThere = there !== base
    const conflict = changedHere && changedThere
    if (conflict) plan.conflicts++
    if (changedHere && (!changedThere || there === null)) {
      // Changed here only — or edited here while Trakt deleted it: the edit is kept.
      if (here === null) plan.actions.push({ ...ref, kind: 'remove', id: t!.id })
      else plan.actions.push({ ...ref, kind: 'push', id: t?.id ?? null, text: here, ...(conflict ? { conflict: true as const } : {}) })
    } else {
      // Changed on Trakt (or on both sides: Trakt wins).
      if (conflict && here !== null) plan.replaced++
      plan.actions.push({ ...ref, kind: 'pull', id: there === null ? null : t!.id, text: there, ...(conflict ? { conflict: true as const } : {}) })
    }
  }
  for (const key of theirs.keys()) if (!mine.has(key)) plan.notInLibrary++
  return plan
}

/** What the outbox drain does for one title: send this text (update note `id`, or add one), delete these notes. */
export interface NoteDrainStep {
  send: { id: number | null; text: string } | null
  deletes: number[]
}

const validNoteId = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x > 0

/**
 * The outbox drain, for one title's queued note changes (all at once): make
 * Trakt hold the note as it is here now. `local` = the entry now (null: it
 * left the library); `removedIds` = the Trakt note ids the queued removals
 * captured. A 404 on the update means the note is gone on Trakt: it is added
 * again (the caller's job).
 */
export function noteDrainStep(local: { note: string | null; noteId: number | null; synced: string | null } | null, removedIds: number[]): NoteDrainStep {
  const ids = [...new Set([local?.noteId, ...removedIds].filter(validNoteId))]
  const text = local ? noteForTrakt(local.note) : null
  if (text === null) return { send: null, deletes: ids }
  // Reuse the linked note, else the newest one a queued removal captured (same title).
  const target = validNoteId(local?.noteId) ? local!.noteId! : ids.length ? ids[ids.length - 1] : null
  const deletes = ids.filter(x => x !== target)
  // Already on Trakt exactly like this: nothing to send.
  if (target !== null && target === local?.noteId && noteForTrakt(local.synced) === text) return { send: null, deletes }
  return { send: { id: target, text }, deletes }
}
