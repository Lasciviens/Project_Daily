// ─────────────────────────────────────────────────────────────────────────────
//  ✨ on the item screen (step 4 of docs/features/item-screen-plan.md): the ✨
//  button's field ("Describe it…"), the one call (the `claude` function's
//  `item_fill` job, on Claude Haiku — docs/features/ai.md), and the
//  review. Nothing saves by itself: the filled fields show marked until the
//  owner keeps them — Add on a new item; "Use these" on an edit — and Cancel
//  or the toast's Undo puts the screen back exactly as it was before ✨ (the
//  title's text and quick add's state included). Meanwhile an edit's autosave
//  works on the screen as it was before ✨ (`before`): what waited then is
//  saved or held as usual, and closing the screen keeps that, never the fill.
// ─────────────────────────────────────────────────────────────────────────────

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from '../../../app/store'
import { cleanItemFill, itemFillTextProblem } from '../../../features/items/itemFill'
import { useMutationWithFeedback } from '../../hooks/useMutationWithFeedback'
import { fillForm, fillWords, type FillField, type FillResult, type FillScreen } from './itemFillForm'
import type { PlanForm } from './planForm'

/** The answer had nothing this screen takes. */
export const FILL_NOTHING_READ = "Couldn't read that — try different words"
/** Said for a failure that has no sentence of its own (the function's code didn't load, an error nobody named). */
export const FILL_FAILED = "Couldn't fill the fields — try again in a moment"

/**
 * The sentence to show for a failed fill. A run the function stopped or couldn't finish (ClaudeJobError: the
 * job is switched off, a budget is reached, too many calls, no key, the model declined, a cut-off or unusable
 * answer) carries the function's own plain sentence, which says what to do — shown as it is.
 */
export function fillFailureText(e: unknown): string {
  const err = e as { name?: unknown; message?: unknown } | null
  const said = err?.name === 'ClaudeJobError' && typeof err.message === 'string' ? err.message.trim() : ''
  return said || FILL_FAILED
}

type Step = { step: 'closed' } | { step: 'asking' } | { step: 'review'; fields: FillField[]; rows: string[] }
const CLOSED: Step = { step: 'closed' }

export interface ItemFillState<S = unknown> {
  step: Step['step']
  busy: boolean
  /** The fields filled and not kept yet. */
  fields: readonly FillField[]
  /** The row labels to mark. */
  rows: ReadonlySet<string>
  /** An edit's autosave waits while this is true. */
  reviewing: boolean
  /** While a fill waits: the screen as it was before ✨ (what an edit's autosave saves meanwhile). */
  before: S | null
  ask: () => void
  close: () => void
  submit: (text: string) => void
  accept: () => void
  cancel: () => void
  /**
   * The item was saved (Add, or an edit's autosave): after "Use these", the fields ✨ filled are reported with the values
   * the item was SAVED with, so the AI learns from what was kept and what was changed (critic 1). Never before a save.
   */
  reportSaved: (form: PlanForm) => void
}

/** The saved form's value of each field ✨ fills, in the learning layer's names (a field with no plain value is left out). */
function savedFields(form: PlanForm): Record<string, string | number | boolean | null> {
  return {
    title: form.title.trim() || null, date: form.date, start_time: form.time, duration_minutes: form.duration, place: form.place?.name ?? null,
    notes: form.notes.trim() || null, priority: form.priority, show_as: form.showAs, travel_minutes: form.travelMinutes,
    deadline_date: form.deadlineDate || null, deadline_time: form.deadlineTime || null, do_from: form.startDate || null,
  }
}

// The fill's fields in the learning layer's names (supabase/claude-src/learn-specs.ts, item_fill): what the owner kept.
const LEARN_FILL_FIELDS: Readonly<Record<string, string>> = {
  title: 'title', date: 'date', startTime: 'start_time', endTime: 'end_time', durationMinutes: 'duration_minutes', allDay: 'all_day',
  repeat: 'repeat', place: 'place', travelMinutes: 'travel_minutes', showAs: 'show_as', notes: 'notes', deadlineDate: 'deadline_date',
  deadlineTime: 'deadline_time', doFrom: 'do_from', priority: 'priority',
}

/** The kept fill as the learning layer reads it: plain values of the fields it reviews. */
function learnedFill(fill: object): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(fill)) {
    const field = LEARN_FILL_FIELDS[key]
    if (field && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) out[field] = value
  }
  return out
}

export function useItemFill<S>({ open, item, form, screen, take, put, fillInto }: {
  /** The screen is open, on this saved item (null: a new one) — a change ends the review, and an old Undo does nothing. */
  open: boolean
  item: unknown
  form: PlanForm
  screen: FillScreen
  /** The screen's state now: the form, the title's text, quick add's state. */
  take: () => S
  /** Puts a taken state back. */
  put: (s: S) => void
  /** Shows a filled form (the title's text = its title; quick add stops reading it). */
  fillInto: (form: PlanForm) => void
}): ItemFillState<S> {
  const [state, setState] = useState<Step>(CLOSED)
  const [before, setBefore] = useState<S | null>(null)
  // A new opening or another item: the review ends (its fields went with the old form).
  const [seen, setSeen] = useState({ open, item })
  const session = useRef(0)
  // ✨'s learning (below): the fill on screen, and a kept fill waiting for the item's own save.
  const learned = useRef<{ callId: string; saved: Record<string, string | number | boolean> } | null>(null)
  const kept = useRef<{ callId: string; fields: string[] } | null>(null)
  if (seen.open !== open || seen.item !== item) {
    setSeen({ open, item })
    setState(CLOSED)
    setBefore(null)
  }
  const latest = useRef({ open, item, form, screen, take, put, fillInto })
  useLayoutEffect(() => {
    if (latest.current.open !== open || latest.current.item !== item) {
      session.current += 1
      // Another opening or another item: a fill kept on the old one is never reported with this one's save.
      learned.current = null
      kept.current = null
    }
    latest.current = { open, item, form, screen, take, put, fillInto }
  })

  /** Puts the screen back as it was before ✨ — only while it still shows the same item. */
  const putBack = (taken: S, startedIn: number, said: string) => {
    if (session.current !== startedIn || !latest.current.open) return
    latest.current.put(taken)
    setState(CLOSED)
    setBefore(null)
    // Put back as it was: nothing of this fill is learned from (no case), whatever is saved next.
    learned.current = null
    kept.current = null
    toast.success(said)
  }

  // The AI call of the fill on screen and what it filled. Cancel reports it dismissed at once; "Use these" keeps only the call
  // id and the fields, and the item's OWN save reports the values it was saved with (`reportSaved`). Undo, or never saving,
  // reports nothing: no case is made of a fill the owner did not keep (Developer → AI → Learned).
  const learn = useMutationWithFeedback<number, { callId: string; saved: Record<string, string | number | boolean | null>; dismissed: boolean }>({
    action: 'ai_learn_save',
    silent: 'a background note for Developer → AI → Learned; the item\'s save and Cancel say their own result',
    logPayload: false,
    mutationFn: async (report) => {
      // Loaded only once ✨ was used, like the function's own client.
      const { reportAiSave } = await import('../../../features/ai/claude/learnSave')
      return reportAiSave(report)
    },
    invalidates: ['aiLearn'],
  })
  const reportDismissed = () => {
    const it = learned.current
    learned.current = null
    kept.current = null
    if (it) learn.mutate({ ...it, dismissed: true })
  }
  const keepForSave = () => {
    const it = learned.current
    learned.current = null
    kept.current = it ? { callId: it.callId, fields: Object.keys(it.saved) } : null
  }
  const reportSaved = (form: PlanForm) => {
    const it = kept.current
    if (!it) return
    kept.current = null
    const all = savedFields(form)
    const saved = Object.fromEntries(it.fields.filter(f => f in all).map(f => [f, all[f]]))
    if (Object.keys(saved).length) learn.mutate({ callId: it.callId, saved, dismissed: false })
  }

  const run = useMutationWithFeedback<(FillResult & { taken: S; startedIn: number; callId: string | null; learnFields: Record<string, string | number | boolean> }) | null, string>({
    action: 'fill_item_fields',
    silent: 'useItemFill says the result itself: "Filled … — check them" with its Undo, and the review bar',
    // The sentence may hold personal details; the error log is readable by the assistant.
    logPayload: false,
    // Every call — answered, refused or stopped at the budget — is a row in the ledger (Developer → AI).
    invalidates: ['aiLedger'],
    mutationFn: async (text) => {
      const why = itemFillTextProblem(text)
      if (why) throw new Error(why)
      const startedIn = session.current
      let raw: unknown
      let callId: string | null
      try {
        // The function's client loads only when ✨ is used (the item screen opens on every page).
        const { runClaudeJob } = await import('../../../features/ai/claude/claudeApi')
        const { result, call } = await runClaudeJob<{ fill?: unknown } | null>('item_fill', { text: text.trim() })
        raw = result && typeof result === 'object' ? result.fill : undefined
        callId = call?.id ?? null
      } catch (e) {
        throw new Error(fillFailureText(e), { cause: e })
      }
      // Closed, or another item opened, while it read: the answer belongs to no screen now — nothing is filled.
      if (session.current !== startedIn || !latest.current.open) return null
      // The server's answer is input too: the same check again, then only rows this screen shows.
      const now = latest.current
      const fill = cleanItemFill(raw, { today: now.screen.today, sentence: text.trim() })
      const out = fillForm(now.form, fill, now.screen)
      if (!out.fields.length) throw new Error(FILL_NOTHING_READ)
      return { ...out, taken: now.take(), startedIn, callId, learnFields: learnedFill(fill) }
    },
    onSuccess: (out) => {
      if (!out) return
      latest.current.fillInto(out.form)
      setBefore(() => out.taken)
      learned.current = out.callId ? { callId: out.callId, saved: out.learnFields } : null
      setState({ step: 'review', fields: out.fields, rows: out.rows })
      toast.undo(`Filled ${fillWords(out.fields)} — check them`, () => putBack(out.taken, out.startedIn, 'Put back as it was'))
    },
  })

  const rows = useMemo(() => new Set(state.step === 'review' ? state.rows : []), [state])
  return {
    step: state.step,
    busy: run.isPending,
    fields: state.step === 'review' ? state.fields : [],
    rows,
    reviewing: state.step === 'review',
    before: state.step === 'review' ? before : null,
    ask: () => setState(s => (s.step === 'closed' ? { step: 'asking' } : s)),
    close: () => setState(s => (s.step === 'asking' ? CLOSED : s)),
    submit: (text) => { if (!run.isPending) run.mutate(text) },
    accept: () => {
      if (state.step !== 'review') return
      const taken = before
      const startedIn = session.current
      setState(CLOSED)
      setBefore(null)
      keepForSave()
      if (taken !== null) toast.undo('Filled fields kept', () => putBack(taken, startedIn, 'Put back as it was'))
    },
    reportSaved,
    cancel: () => {
      if (state.step !== 'review' || before === null) return
      reportDismissed()
      putBack(before, session.current, 'Put back as it was')
    },
  }
}
