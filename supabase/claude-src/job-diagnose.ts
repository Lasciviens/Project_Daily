// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · the job `diagnose`
//
//  The tiny answer of Developer → AI → How it works → Diagnose: one fixed
//  question, "Reply with the word OK.", with no answer shape. It exists so the
//  third check of Diagnose goes through the normal run path (reserved, sent,
//  written to the ledger) and shows up in Calls like every other call. The app
//  cannot start it by itself in any other way: it takes no input, and it is
//  asked only by diagnose.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { JobDefinition } from './types.ts'

const DIAGNOSE_JOB_VERSION = '2026-11-22.1'

export const DIAGNOSE_INSTRUCTIONS = 'You are a connection test. Do what the message says, in as few words as possible.'
export const DIAGNOSE_QUESTION = 'Reply with the word OK.'

export const DIAGNOSE_JOB: JobDefinition = {
  name: 'diagnose',
  title: 'Diagnose: a tiny answer',
  what: 'The third check of Diagnose: a question with a one-word answer and no answer shape, to see how fast the smallest possible request comes back. It is started only by the Diagnose button.',
  kind: 'one_shot',
  callers: ['app'],
  version: DIAGNOSE_JOB_VERSION,
  defaults: { model: 'claude-haiku-5-5', effort: 'low', maxOutputTokens: 512 },
  instructions: DIAGNOSE_INSTRUCTIONS,
  answerSchema: null,
  sourceFiles: ['supabase/claude-src/job-diagnose.ts', 'supabase/claude-src/diagnose.ts'],

  // It takes no input: whatever the request sent is ignored, and the question is always the same.
  prepare() {
    return {
      userText: DIAGNOSE_QUESTION,
      read(answerText: string) {
        return { ok: true as const, result: { text: answerText.trim().slice(0, 200) } }
      },
    }
  },
}
