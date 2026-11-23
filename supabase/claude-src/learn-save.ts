// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · learning: the owner's save, and the owner's tuning decisions
//
//  The owner's save (`reportSave`, action `learn_save`): the browser sends the call id and what it saved; corrections are
//  worked out against the function's OWN stored values (claimed once), a case is kept, repeated corrections are proposed
//  as rules (never turned on), and the tripwire of a recent change counts the save.
//  The owner's tap in Tuning (`decideTuning`, action `learn_decide`): approve, reject or roll back a job's setup.
// ─────────────────────────────────────────────────────────────────────────────

import { ownValue } from './guard.ts'
import type { RunContext } from './run.ts'
import { sha256Hex } from './chat-rules.ts'
import { addSuggestion } from './suggest-store.ts'
import type { CheckedIdea } from './suggest-rules.ts'
import { plainLine, splitOf, stripHidden } from './learn-text.ts'
import { isLearnObj, LEARN_UUID, learnSpecOf, type LearnSpec } from './learn-specs.ts'
import { diffSave, ruleProposals, saveCorrected } from './learn-diff.ts'
import { tripwireVerdict, SCORE_LIMITS } from './learn-score.ts'
import { LEARN_LIMITS } from './learn-run.ts'
import {
  claimLearnAnswer, insertCase, insertCorrections, proposeRule, readCorrectionHistory, readJobLearning, writeJobLearning,
} from './learn-store.ts'


// ── The owner's save ──────────────────────────────────────────────────────────

export type LearnSaveReply =
  | { ok: true; recorded: number; rules_proposed: number; case_kept: boolean; tripwire: 'none' | 'watch' | 'keep' | 'roll_back' }
  | { ok: false; message: string }

const SAVE_LIMITS = { fields: 200, valueChars: 2000 } as const

/**
 * `{ action: 'learn_save', call_id, saved: { field: value }, unticked: [field], dismissed: boolean }` from the app.
 * The "before" is our own stored copy (claimed once, by call id and verified user); the browser's values are checked by
 * the job's own field rules. Nothing of it changes an answer or a saved row: it is what the app learns from.
 */
export async function reportSave(ctx: RunContext, body: Record<string, unknown>): Promise<LearnSaveReply> {
  if (ctx.caller !== 'app') return { ok: false, message: 'Only the app reports a save.' }
  const callId = ownValue(body, 'call_id')
  if (typeof callId !== 'string' || !LEARN_UUID.test(callId)) return { ok: false, message: 'The save named no AI call.' }
  const savedRaw = ownValue(body, 'saved')
  const untickedRaw = ownValue(body, 'unticked')
  const dismissed = ownValue(body, 'dismissed') === true
  if (savedRaw !== undefined && !isLearnObj(savedRaw)) return { ok: false, message: 'The saved values must be an object.' }
  if (untickedRaw !== undefined && !Array.isArray(untickedRaw)) return { ok: false, message: 'The unticked fields must be a list.' }
  const saved: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(savedRaw ?? {}).slice(0, SAVE_LIMITS.fields)) {
    if (typeof v === 'string' && v.length > SAVE_LIMITS.valueChars) continue
    if (v !== null && typeof v === 'object') continue
    saved[k] = v
  }
  const unticked = (untickedRaw ?? []).filter((f): f is string => typeof f === 'string' && f.length <= 60).slice(0, SAVE_LIMITS.fields)
  const now = ctx.now()
  const answer = await claimLearnAnswer(ctx.adminDb, ctx.userId, callId, now.toISOString())
  if (answer === undefined) return { ok: false, message: 'The save could not be noted for learning. It is saved all the same.' }
  if (answer === null) return { ok: true, recorded: 0, rules_proposed: 0, case_kept: false, tripwire: 'none' }
  const spec = learnSpecOf(answer.job)
  if (!spec) return { ok: true, recorded: 0, rules_proposed: 0, case_kept: false, tripwire: 'none' }

  const { corrections, final } = diffSave(spec, answer.ai_values, saved, unticked, dismissed, answer.input)
  const firstId = await insertCorrections(ctx.adminDb, ctx.userId, spec.job, callId, 'save', corrections)
  if (firstId === undefined) ctx.report('the corrections of a save could not be written')

  // A case: only what the owner saved (owner-typed input, or read text the save confirmed), never a dismissed answer.
  let caseKept = false
  const caseText = dismissed ? null : spec.caseText(answer.input, final)
  if (caseText && Object.keys(final).length) {
    const id = ctx.newId()
    caseKept = await insertCase(ctx.adminDb, {
      id, user_id: ctx.userId, job: spec.job, call_id: callId, input_text: stripHidden(caseText).slice(0, 2000), input: answer.input,
      output: final, diffs: corrections.filter(c => c.kind !== 'kept').slice(0, 60), source_kind: spec.trust, split: splitOf(id),
      expires_at: new Date(now.getTime() + LEARN_LIMITS.caseDays * 86_400_000).toISOString(),
    })
    if (!caseKept) ctx.report('a case could not be kept')
  }

  // Rules: repeated identical corrections are proposed (never turned on: the owner does that in Learn).
  let proposed = 0
  if (corrections.some(c => c.kind === 'edited')) {
    const history = await readCorrectionHistory(ctx.adminDb, ctx.userId, spec.job)
    for (const p of ruleProposals(spec, history ?? []).slice(0, LEARN_LIMITS.rulesPerSave)) {
      if (plainLine(p.value, 200) === null) continue
      if (await proposeRule(ctx.adminDb, ctx.userId, spec.job, p, firstId ?? null)) proposed += 1
    }
  }

  const tripwire = await countTripwire(ctx, spec, saveCorrected(corrections))
  return { ok: true, recorded: corrections.length, rules_proposed: proposed, case_kept: caseKept, tripwire }
}

/** The tripwire after an approved change: counts this save, and rolls the change back when the job got worse. */
async function countTripwire(ctx: RunContext, spec: LearnSpec, corrected: boolean): Promise<'none' | 'watch' | 'keep' | 'roll_back'> {
  const state = await readJobLearning(ctx.adminDb, ctx.userId, spec.job)
  if (!state || state.tripwireLeft <= 0 || state.tripwireBaseline === null) return 'none'
  const saves = state.tripwireSaves + 1
  const fixed = state.tripwireCorrected + (corrected ? 1 : 0)
  const verdict = tripwireVerdict(state.tripwireBaseline, saves, fixed)
  const now = ctx.now().toISOString()
  if (verdict === 'watch') {
    await writeJobLearning(ctx.adminDb, ctx.userId, spec.job, { tripwire_saves: saves, tripwire_corrected: fixed, tripwire_left: Math.max(1, state.tripwireLeft - 1) })
    return 'watch'
  }
  if (verdict === 'keep') {
    await writeJobLearning(ctx.adminDb, ctx.userId, spec.job, {
      tripwire_saves: saves, tripwire_corrected: fixed, tripwire_left: 0,
      last_event: `Kept after ${saves} saves: corrected ${fixed} times`, last_event_at: now,
    })
    return 'keep'
  }
  await writeJobLearning(ctx.adminDb, ctx.userId, spec.job, {
    example_strategy: state.previousStrategy ?? 'mmr', examples_k: state.previousK ?? 3, previous_strategy: state.strategy, previous_k: state.k,
    tripwire_saves: saves, tripwire_corrected: fixed, tripwire_left: 0, changed_at: now,
    last_event: `Rolled back by itself: ${fixed} of ${saves} saves needed corrections, more than before`, last_event_at: now,
  })
  try {
    await ctx.push?.({ title: 'AI learning rolled back', body: `A change for ${spec.job.replace(/_/g, ' ')} made more corrections, so the earlier setup is back.`, url: '#/developer?tab=ai&view=learn&learn=memory' })
  } catch { /* the Learn view shows it too */ }
  return 'roll_back'
}

/** The share of a job's saves with at least one correction since a time: the champion's live rate for the tripwire. */
async function liveCorrectionRate(ctx: RunContext, job: string, sinceIso: string): Promise<number> {
  try {
    const { data } = await ctx.adminDb.from('ai_corrections').select('call_id, kind').eq('user_id', ctx.userId).eq('job', job).eq('source', 'save').gte('created_at', sinceIso).limit(5000)
    const calls = new Map<string, boolean>()
    for (const r of Array.isArray(data) ? data : []) {
      if (!isLearnObj(r) || typeof r.call_id !== 'string') continue
      calls.set(r.call_id, (calls.get(r.call_id) ?? false) || r.kind !== 'kept')
    }
    if (!calls.size) return 0
    return [...calls.values()].filter(Boolean).length / calls.size
  } catch {
    return 0
  }
}

// ── The owner's tuning decisions ──────────────────────────────────────────────

export type LearnDecideReply = { ok: true; message: string } | { ok: false; message: string }

/**
 * `{ action: 'learn_decide', run_id, job, decision: 'approve' | 'reject' | 'roll_back' }` — the owner's tap in Tuning.
 * Approve makes the run's winning example setup the job's champion (the old one is kept for a rollback) and starts the
 * tripwire; a winning set of lessons is turned on by the owner's own tap in the app (row level security), and here
 * becomes a suggested change to the job's instructions (`instruction_change`, a reviewed PR). Roll back swaps back.
 */
export async function decideTuning(ctx: RunContext, body: Record<string, unknown>): Promise<LearnDecideReply> {
  if (ctx.caller !== 'app') return { ok: false, message: 'Only the app decides.' }
  const job = ownValue(body, 'job')
  const decision = ownValue(body, 'decision')
  if (typeof job !== 'string' || !learnSpecOf(job)) return { ok: false, message: 'That job learns nothing this way.' }
  if (decision !== 'approve' && decision !== 'reject' && decision !== 'roll_back') return { ok: false, message: 'Approve, reject or roll back.' }
  const now = ctx.now().toISOString()
  if (decision === 'roll_back') {
    const state = await readJobLearning(ctx.adminDb, ctx.userId, job)
    if (!state) return { ok: false, message: 'The setup could not be read. Try again in a moment.' }
    if (!state.previousStrategy) return { ok: false, message: 'There is no earlier setup to go back to.' }
    const ok = await writeJobLearning(ctx.adminDb, ctx.userId, job, {
      example_strategy: state.previousStrategy, examples_k: state.previousK ?? 3, previous_strategy: state.strategy, previous_k: state.k,
      tripwire_left: 0, changed_at: now, last_event: 'Rolled back by the owner', last_event_at: now,
    })
    return ok ? { ok: true, message: 'Rolled back to the earlier setup' } : { ok: false, message: 'The rollback could not be saved. Try again in a moment.' }
  }
  const runId = ownValue(body, 'run_id')
  if (typeof runId !== 'string' || !LEARN_UUID.test(runId)) return { ok: false, message: 'The decision named no self-test.' }
  const { data, error } = await ctx.adminDb.from('ai_eval_runs').select('id, result, decision_state').eq('id', runId).eq('user_id', ctx.userId).maybeSingle()
  if (error || !isLearnObj(data) || !isLearnObj(data.result)) return { ok: false, message: 'That self-test could not be read.' }
  const jobs = Array.isArray(data.result.jobs) ? data.result.jobs : []
  const entry = jobs.find(j => isLearnObj(j) && j.job === job) as Record<string, unknown> | undefined
  if (!entry || entry.decision !== 'proposed' || !isLearnObj(entry.winner)) return { ok: false, message: 'There is nothing waiting for a decision on that job.' }
  const winner = entry.winner
  entry.decision = decision === 'approve' ? 'approved' : 'rejected'
  entry.decided_at = now
  if (decision === 'approve') {
    const strategy = winner.strategy === 'knn' || winner.strategy === 'mmr' || winner.strategy === 'none' ? winner.strategy : null
    const k = typeof winner.k === 'number' && Number.isInteger(winner.k) && winner.k >= 0 && winner.k <= 5 ? winner.k : null
    const state = await readJobLearning(ctx.adminDb, ctx.userId, job)
    if (!state || !strategy || k === null) return { ok: false, message: 'The winning setup could not be read.' }
    const baseline = await liveCorrectionRate(ctx, job, new Date(ctx.now().getTime() - 30 * 86_400_000).toISOString())
    const ok = await writeJobLearning(ctx.adminDb, ctx.userId, job, {
      example_strategy: strategy, examples_k: k, previous_strategy: state.strategy, previous_k: state.k, changed_by_run: runId, changed_at: now,
      tripwire_left: SCORE_LIMITS.tripwireCalls, tripwire_baseline: Math.round(baseline * 10000) / 10000, tripwire_saves: 0, tripwire_corrected: 0,
      last_event: `Approved by the owner: ${strategy === 'none' ? 'no examples' : `${k} examples by ${strategy}`}`, last_event_at: now,
    })
    if (!ok) return { ok: false, message: 'The new setup could not be saved. Try again in a moment.' }
    // A winning set of lessons: each becomes a suggested change to the job's instructions (code, a reviewed PR).
    for (const text of (Array.isArray(winner.lessons) ? winner.lessons : []).slice(0, 3)) {
      const lesson = plainLine(text, 300, 3)
      if (!lesson) continue
      const idea: CheckedIdea = {
        kind: 'instruction_change' as CheckedIdea['kind'], title: `Add a learned note to ${job.replace(/_/g, ' ')}`.slice(0, 120),
        why: `It won the weekly self-test. The note: ${lesson}`.slice(0, 400), benefit: 'The note would become part of the job\'s reviewed instructions.', complexity: 'small',
      }
      const key = await sha256Hex(`instruction_change\n${job}\n${lesson.toLowerCase()}`)
      const added = await addSuggestion(ctx.adminDb, ctx.userId, idea, key, 'weekly', { times: 1, tokens: 0, cost: 0 }, null)
      if (added === 'error' || added === 'invalid') ctx.report('a suggested instruction change could not be written')
    }
  }
  const stillOpen = jobs.some(j => isLearnObj(j) && j.decision === 'proposed')
  const { error: e } = await ctx.adminDb.from('ai_eval_runs').update({ result: data.result, decision_state: stillOpen ? 'proposed' : decision === 'approve' ? 'approved' : 'rejected' })
    .eq('id', runId).eq('user_id', ctx.userId)
  if (e) return { ok: false, message: 'The decision could not be saved. Try again in a moment.' }
  return { ok: true, message: decision === 'approve' ? 'Approved: the new setup is in use, watched for 20 saves' : 'Rejected: the setup stays as it is' }
}
