#!/usr/bin/env node
/*
 * Verification — Trakt notes ↔ personal_note (docs/trakt/PLAN.md §12),
 * against the real src/features/media/trakt/traktNotes.ts via sucrase:
 * the 500-character rule, reading Trakt's notes list (only a title's own
 * note, the newest per title, a broken answer counted, never read as "no
 * notes"), the three-way plan (who changed what since the last sync, Trakt
 * wins a real conflict, an edit is never lost to a delete, waiting changes
 * are left alone, an outage changes nothing, a second run plans nothing) and
 * the outbox drain step (update vs add, 404 = recreate is the caller's,
 * deletes, a removed entry's note).
 */
require('sucrase/register')
const assert = require('node:assert/strict')
const N = require('../src/features/media/trakt/traktNotes')

let n = 0
const ok = (actual, expected, msg) => { assert.deepStrictEqual(actual, expected, msg); n++ }

// ── The 500-character rule ───────────────────────────────────────────────────
ok(N.TRAKT_NOTE_MAX, 500, 'Trakt keeps notes up to 500 characters')
ok(N.noteForTrakt(null), null, 'null is no note')
ok(N.noteForTrakt(undefined), null, 'undefined is no note')
ok(N.noteForTrakt(''), null, 'empty is no note')
ok(N.noteForTrakt(' \n\t '), null, 'whitespace only is no note')
ok(N.noteForTrakt('  Watch in IMAX!  '), 'Watch in IMAX!', 'trimmed')
ok(N.noteForTrakt('a\r\nb\rc'), 'a\nb\nc', 'line breaks become \\n')
ok(N.noteForTrakt('ş'.repeat(500)), 'ş'.repeat(500), 'exactly 500 characters (Turkish letters count once) is kept whole')
{
  const cut = N.noteForTrakt('x'.repeat(501))
  ok(cut.length, 500, 'a longer note is cut to 500')
  ok(cut, `${'x'.repeat(499)}…`, 'the first 499 characters and "…"')
  const emoji = N.noteForTrakt(`${'x'.repeat(498)}😀${'y'.repeat(10)}`)
  ok(emoji, `${'x'.repeat(498)}…`, 'an emoji across the cut is left out whole, never split')
  ok(emoji.length <= 500, true, 'still within 500')
  ok(N.noteForTrakt(`${'x'.repeat(497)}😀${'y'.repeat(10)}`), `${'x'.repeat(497)}😀…`, 'an emoji just before the cut stays whole')
  ok(N.noteForTrakt(`${'x'.repeat(490)}         ${'y'.repeat(20)}`), `${'x'.repeat(490)}…`, 'spaces before the cut are dropped')
  ok(N.noteForTrakt(N.noteForTrakt('z'.repeat(800))), N.noteForTrakt('z'.repeat(800)), 'cutting is stable: the cut form stays the same')
}
ok(N.traktNoteKey('movie', 272), 'note:movie:272', 'outbox key for a movie note')
ok(N.traktNoteKey('show', 1399), 'note:show:1399', 'outbox key for a show note')

// ── Reading GET /users/me/notes/{type} (API blueprint "Get notes" rows) ──────
const row = (type, tmdb, id, notes, updatedAt = '2026-09-07T20:10:56.000Z', attached = type) => ({
  attached_to: attached === 'history' ? { type: 'history', id: 3253454 } : { type: attached },
  type,
  [type]: { title: 'T', year: 2005, ids: { trakt: 1, slug: 's', imdb: 'tt1', tmdb } },
  note: { id, notes, privacy: 'private', spoiler: false, created_at: updatedAt, updated_at: updatedAt, user: { username: 'u' } },
})
{
  const p = N.parseTraktNotes([
    row('movie', 272, 49, 'Only watch the extended edition.'),
    row('movie', 272, 50, 'Saw this in Dolby Cinema!', '2026-09-08T10:00:00.000Z', 'history'),
    row('movie', 272, 51, 'Rated it after a rewatch', '2026-09-09T10:00:00.000Z', 'rating'),
    row('movie', 9340, 60, 'Older note', '2026-01-01T00:00:00.000Z'),
    row('movie', 9340, 61, 'Newer note', '2026-02-01T00:00:00.000Z'),
    row('movie', null, 70, 'No TMDB id'),
  ], 'movie')
  ok(p.unreadable, 0, 'every documented row is readable')
  ok(p.notes.find(x => x.tmdb === 272), { type: 'movie', tmdb: 272, id: 49, text: 'Only watch the extended edition.', updatedAt: '2026-09-07T20:10:56.000Z' },
    'the note on the movie itself is read; a play\'s or a rating\'s note on the same movie is not')
  ok(p.notes.find(x => x.tmdb === 9340).id, 61, 'two notes on one title: the newest wins')
  ok(p.notes.length, 2, 'a note without a TMDB id can\'t be matched and is left out')
}
{
  const ep = { attached_to: { type: 'episode' }, type: 'episode', episode: { season: 1, number: 1, ids: { tmdb: 975968 } }, show: { ids: { tmdb: 60708 } }, note: { id: 48, notes: 'x' } }
  ok(N.parseTraktNotes([ep], 'show').notes, [], 'an episode note never lands on its show')
  ok(N.parseTraktNotes([row('show', 1399, 9, 'Winter')], 'show').notes[0].tmdb, 1399, 'a show note is read for its show')
  ok(N.parseTraktNotes([row('show', 1399, 9, 'Winter')], 'movie').notes, [], 'a show note is never read as a movie note')
}
{
  const p = N.parseTraktNotes([{ id: 5, notes: 'flat shape' }, { attached_to: { type: 'movie' }, type: 'movie', movie: { ids: { tmdb: 1 } } }, null], 'movie')
  ok(p.unreadable, 3, 'rows without attached_to/type/note.id are counted as unreadable, never as "no note"')
  ok(N.parseTraktNotes({ error: 'x' }, 'movie'), { notes: [], unreadable: 0 }, 'a non-list answer reads as nothing (getAll fails first in the function)')
  ok(N.parseTraktNotes([row('movie', 1, 2, null)], 'movie').notes[0].text, '', 'a null note text reads as empty')
}

// ── The three-way plan ───────────────────────────────────────────────────────
const tn = (tmdb, id, text, type = 'movie') => ({ type, tmdb, id, text, updatedAt: null })
const ln = (tmdb, note, noteId = null, synced = null, type = 'movie') => ({ type, tmdb, note, noteId, synced })
const none = new Set()
const plan = (trakt, local, pending = none) => N.buildNotePlan(trakt, local, pending)
const only = p => p.actions

// Nothing synced yet (first import, or the first sync after migration 136)
ok(only(plan([], [ln(1, 'Mine')])), [{ type: 'movie', tmdb: 1, kind: 'push', id: null, text: 'Mine' }], 'a note only here is sent to Trakt (added)')
ok(only(plan([tn(1, 11, 'Theirs')], [ln(1, null)])), [{ type: 'movie', tmdb: 1, kind: 'pull', id: 11, text: 'Theirs' }], 'a note only on Trakt is written here')
ok(only(plan([tn(1, 11, 'Same')], [ln(1, 'Same ')])), [{ type: 'movie', tmdb: 1, kind: 'link', id: 11, text: 'Same' }], 'the same note on both sides is linked, nothing sent')
{
  const p = plan([tn(1, 11, 'Theirs')], [ln(1, 'Mine')])
  ok(only(p), [{ type: 'movie', tmdb: 1, kind: 'pull', id: 11, text: 'Theirs', conflict: true }], 'a different note on each side, no history: Trakt wins (the import rule)')
  ok(p.conflicts, 1, 'and it is counted as a conflict')
  ok(p.replaced, 1, '…and as a note typed here that Trakt\'s text replaces (the card says so; the audit log keeps it)')
}
ok(plan([tn(1, 11, 'Theirs v2')], [ln(1, null, 11, 'Base')]).replaced, 0, 'cleared here, edited on Trakt: nothing typed here is replaced')
ok(plan([], [ln(1, 'Mine v2', 11, 'Base')]).replaced, 0, 'edited here, deleted on Trakt: the edit is kept, nothing replaced')
ok(plan([tn(1, 11, 'Edited on Trakt')], [ln(1, 'Base', 11, 'Base')]).replaced, 0, 'a plain Trakt edit replaces only the synced text')
ok(only(plan([], [ln(1, null)])), [], 'no note anywhere: nothing')
ok(plan([], [ln(1, null)]).same, 0, '…and not counted as the same note')

// With a last synced note (base)
const B = 'Base text'
ok(plan([tn(1, 11, B)], [ln(1, B, 11, B)]).same, 1, 'unchanged on both sides: same')
ok(only(plan([tn(1, 11, B)], [ln(1, B, 11, B)])), [], 'unchanged: nothing to do')
ok(only(plan([tn(1, 11, B)], [ln(1, 'Edited here', 11, B)])), [{ type: 'movie', tmdb: 1, kind: 'push', id: 11, text: 'Edited here' }], 'edited here: Trakt\'s note 11 is updated')
ok(only(plan([tn(1, 11, 'Edited on Trakt')], [ln(1, B, 11, B)])), [{ type: 'movie', tmdb: 1, kind: 'pull', id: 11, text: 'Edited on Trakt' }], 'edited on Trakt: written here')
ok(only(plan([], [ln(1, B, 11, B)])), [{ type: 'movie', tmdb: 1, kind: 'pull', id: null, text: null }], 'deleted on Trakt (and unchanged here): cleared here')
ok(only(plan([tn(1, 11, B)], [ln(1, null, 11, B)])), [{ type: 'movie', tmdb: 1, kind: 'remove', id: 11 }], 'cleared here: Trakt\'s note 11 is deleted')
ok(only(plan([tn(1, 11, 'Theirs v2')], [ln(1, 'Mine v2', 11, B)])), [{ type: 'movie', tmdb: 1, kind: 'pull', id: 11, text: 'Theirs v2', conflict: true }], 'edited on both sides: Trakt wins')
ok(only(plan([], [ln(1, 'Mine v2', 11, B)])), [{ type: 'movie', tmdb: 1, kind: 'push', id: null, text: 'Mine v2', conflict: true }], 'edited here while deleted on Trakt: the edit is kept and added again')
ok(only(plan([tn(1, 11, 'Theirs v2')], [ln(1, null, 11, B)])), [{ type: 'movie', tmdb: 1, kind: 'pull', id: 11, text: 'Theirs v2', conflict: true }], 'cleared here while edited on Trakt: the edit is kept (written here)')
ok(only(plan([tn(1, 11, 'X')], [ln(1, 'X', 11, 'Old')])), [{ type: 'movie', tmdb: 1, kind: 'link', id: 11, text: 'X' }], 'both changed to the same text: just the link moves on')
ok(only(plan([tn(1, 12, B)], [ln(1, B, 11, B)])), [{ type: 'movie', tmdb: 1, kind: 'link', id: 12, text: B }], 'same text under a new Trakt note id: relinked')
ok(only(plan([], [ln(1, null, 11, null)])), [{ type: 'movie', tmdb: 1, kind: 'unlink' }], 'a stale link with no note anywhere is dropped')
ok(only(plan([tn(1, 11, B)], [ln(1, B, 11, B)], new Set(['note:movie:1']))), [], 'a note change waiting in the outbox is left alone')
ok(plan([tn(1, 11, 'Edited on Trakt')], [ln(1, B, 11, B)], new Set(['note:movie:1'])).kept, ['note:movie:1'], 'and listed as kept')
ok(only(plan([tn(1, 11, 'Edited on Trakt')], [ln(1, B, 11, B)], new Set(['movie:1', 'fav:movie:1']))).length, 1, 'only the note key holds a note back (not the title\'s or favorite\'s)')
ok(only(plan([tn(1, 11, 'Show note', 'show')], [ln(1, null, null, null, 'movie')])), [], 'a show note never reaches the movie with the same TMDB id')
{
  const long = 'L'.repeat(700)
  const cut = N.noteForTrakt(long)
  ok(only(plan([tn(1, 11, cut)], [ln(1, long, 11, cut)])), [], 'a long note here and its 500-character cut on Trakt are the same note')
  ok(only(plan([], [ln(1, long)])), [{ type: 'movie', tmdb: 1, kind: 'push', id: null, text: cut }], 'a long note goes to Trakt cut')
}
ok(plan([tn(5, 50, 'Not here'), tn(6, 60, 'Show', 'show')], [ln(1, null)]).notInLibrary, 2, 'Trakt notes on titles not in the library are left on Trakt (a note alone never adds a title)')

// Outage guard: Trakt answers no notes while several here are linked
{
  const linked = [ln(1, 'a', 11, 'a'), ln(2, 'b', 12, 'b'), ln(3, 'c', 13, 'c')]
  const p = plan([tn(9, 90, 'x', 'show')], linked)
  ok(p.outage, 'movie', 'no movie notes from Trakt while 3 here are linked: read as an outage')
  ok(p.actions, [], 'an outage plans nothing (no note is cleared)')
  ok(plan([], linked.slice(0, 2)).outage, null, 'two linked: a real deletion on Trakt is followed')
  ok(only(plan([], linked.slice(0, 2))).map(a => a.kind), ['pull', 'pull'], '…clearing them here')
}

// A second run after applying the plan plans nothing
{
  const trakt = [tn(1, 11, 'T1'), tn(2, 12, 'Same'), tn(3, 13, 'Theirs')]
  let local = [ln(1, null), ln(2, 'Same'), ln(3, 'Mine'), ln(4, 'Only here')]
  const first = plan(trakt, local)
  ok(first.actions.map(a => `${a.kind}:${a.tmdb}`), ['pull:1', 'link:2', 'pull:3', 'push:4'], 'first run: pull, link, Trakt wins, send')
  // What the function writes for each action (push gets id 14 from Trakt).
  const traktAfter = [...trakt, tn(4, 14, 'Only here')]
  local = local.map(l => {
    const a = first.actions.find(x => x.tmdb === l.tmdb)
    if (!a) return l
    if (a.kind === 'pull') return { ...l, note: a.text, noteId: a.id, synced: a.text }
    if (a.kind === 'link') return { ...l, noteId: a.id, synced: a.text }
    if (a.kind === 'push') return { ...l, noteId: 14, synced: a.text }
    return l
  })
  const second = plan(traktAfter, local)
  ok(second.actions, [], 'second run: nothing to do')
  ok(second.same, 4, 'second run: all four the same')
}

// ── The outbox drain step ────────────────────────────────────────────────────
const D = N.noteDrainStep
ok(D({ note: 'New', noteId: null, synced: null }, []), { send: { id: null, text: 'New' }, deletes: [] }, 'a new note is added')
ok(D({ note: 'Edited', noteId: 7, synced: 'Old' }, []), { send: { id: 7, text: 'Edited' }, deletes: [] }, 'an edited note updates note 7 (a 404 there means: add it again)')
ok(D({ note: 'Same', noteId: 7, synced: 'Same' }, []), { send: null, deletes: [] }, 'already on Trakt like this: nothing sent')
ok(D({ note: null, noteId: 7, synced: 'Old' }, [7]), { send: null, deletes: [7] }, 'cleared here: note 7 is deleted')
ok(D({ note: '  ', noteId: 7, synced: 'Old' }, []), { send: null, deletes: [7] }, 'a blank note counts as cleared')
ok(D(null, [7]), { send: null, deletes: [7] }, 'removed from the library: its note goes too')
ok(D(null, [Number.NaN, 0, -1]), { send: null, deletes: [] }, 'a removal that never reached Trakt deletes nothing')
ok(D({ note: 'Back', noteId: null, synced: null }, [7]), { send: { id: 7, text: 'Back' }, deletes: [] }, 'removed then added back with a note: note 7 is reused')
ok(D({ note: 'Mine', noteId: 5, synced: 'x' }, [7, 5]), { send: { id: 5, text: 'Mine' }, deletes: [7] }, 'the linked note is updated; an older one a removal captured is deleted')
ok(D({ note: 'L'.repeat(600), noteId: null, synced: null }, []).send.text, N.noteForTrakt('L'.repeat(600)), 'a long note is sent cut')

console.log(`verify-trakt-notes: ${n} assertions passed`)
