// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · learning in Ask AI
//
//  · chatNoteLesson — `note_lesson`'s write: the note's words are checked against the person's OWN text of this message
//    (`factInOwnersWords`: a typed message, the note one unbroken run of its words; never a tool result or a page). A plain fact in their words turns on at once; anything else waits
//    for their tap (and the database refuses the function turning it on). The same note is never added twice.
//  · readChatNotes — the "about you" profile: the person's active chat notes (facts and preferences), service role,
//    named by the verified user, for `get_about_me` (delivered as data blocks, never in the instructions).
//  · chatProposalCorrections — the owner's Confirm or Cancel of a proposed write is a correction of the model's proposal:
//    the before is the STORED proposal (`ai_chat_proposals.args`), the after what was written; never the browser's word.
//  Each is best effort: a failure is said in the server log and never changes the chat's answer.
// ─────────────────────────────────────────────────────────────────────────────

import type { RunContext } from './run.ts'
import { LESSON_DAYS, lessonStart, normKey, storedValue, factInOwnersWords, type LessonKind } from './learn-text.ts'
import { insertCorrections, insertLesson, lessonExists, readLessons } from './learn-store.ts'
import type { CorrectionRow } from './learn-diff.ts'
import type { NoteResult, ProfileNote } from './chat-learn-tools.ts'

/** Notes Ask AI may propose in 24 hours (a flood bound, not a limit on what is learned: the owner's own facts are few). */
export const CHAT_NOTES_PER_DAY = 20

export async function chatNoteLesson(ctx: RunContext, kind: LessonKind, text: string, ownerText: string, callId: string): Promise<NoteResult> {
  try {
    const start = lessonStart(kind, 'chat_tool', text, factInOwnersWords(text, ownerText))
    // A flood bound (a steered answer calling the tool again and again): 20 notes from Ask AI a day.
    const since = new Date(ctx.now().getTime() - 86_400_000).toISOString()
    const { count, error } = await ctx.adminDb.from('ai_lessons').select('id', { count: 'exact', head: true }).eq('user_id', ctx.userId).eq('source_kind', 'chat_tool').gte('created_at', since)
    if (error || typeof count !== 'number') return 'error'
    if (count >= CHAT_NOTES_PER_DAY) return 'limit'
    const exists = await lessonExists(ctx.adminDb, ctx.userId, 'chat', text)
    if (exists === null) return 'error'
    if (exists) return 'seen'
    const saved = await insertLesson(ctx.adminDb, {
      user_id: ctx.userId, scope: 'chat', kind, text, source_kind: 'chat_tool', source_ref: 'Ask AI', source_call_id: callId,
      trust: start.trust, state: start.state, expires_at: new Date(ctx.now().getTime() + LESSON_DAYS[kind] * 86_400_000).toISOString(),
    })
    if (saved === 'error') { ctx.report('a note from Ask AI could not be saved'); return 'error' }
    return start.state
  } catch {
    return 'error'
  }
}

const SOURCE_WORDS: Record<string, string> = { owner_typed: 'their own words', owner_data: 'their data', weekly_batch: 'the weekly self-test', chat_tool: 'Ask AI', repo_doc: 'the app\'s docs', web: 'a web page' }

export async function readChatNotes(ctx: RunContext): Promise<ProfileNote[] | null> {
  const rows = await readLessons(ctx.adminDb, ctx.userId, 'chat', 'active', 20)
  if (!rows) return null
  return rows.filter(r => r.kind !== 'instruction').map(r => ({ kind: r.kind, text: r.text, source: SOURCE_WORDS[r.source_kind] ?? 'a note', approvedAt: r.approved_at, createdAt: r.created_at }))
}

/** The owner's decision on a proposal as corrections of its title and date (`final` null: cancelled). */
export async function chatProposalCorrections(ctx: RunContext, tool: string, stored: unknown, final: Record<string, unknown> | null, callId: string | null): Promise<void> {
  try {
    const before = stored !== null && typeof stored === 'object' && !Array.isArray(stored) ? stored as Record<string, unknown> : {}
    const dateKey = tool === 'add_task' ? 'due_date' : 'date'
    const key = normKey(typeof before.title === 'string' ? before.title : '')
    const rows: CorrectionRow[] = []
    for (const [field, from] of [['title', 'title'], ['date', dateKey]] as const) {
      const ai = storedValue(before[from])
      if (ai === null && !final) continue
      const saved = final ? storedValue(final[from]) : null
      rows.push({
        field, match_key: key, ai_value: ai, saved_value: saved,
        kind: !final ? 'dismissed' : (ai ?? '') === (saved ?? '') ? 'kept' : 'edited',
      })
    }
    const written = await insertCorrections(ctx.adminDb, ctx.userId, 'chat', callId, 'chat_proposal', rows)
    if (written === undefined) ctx.report('the corrections of a proposal could not be written')
  } catch {
    ctx.report('the corrections of a proposal could not be worked out')
  }
}
