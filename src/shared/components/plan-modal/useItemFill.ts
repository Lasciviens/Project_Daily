// ─────────────────────────────────────────────────────────────────────────────
//  ✨ on the item screen (step 4 of docs/features/item-screen-plan.md): the ✨
//  button's field ("Describe it…"), the one call (ai-proxy's itemFill), and the
//  review. Nothing saves by itself: the filled fields show marked until the
//  owner keeps them — Add on a new item; "Use these" on an edit, whose
//  autosave waits meanwhile (the screen passes `reviewing` to useItemAutosave)
//  — and Cancel or the toast's Undo puts the screen back exactly as it was
//  before ✨ (the title's text and quick add's state included). An edit saves
//  what waits first, so "as it was" is also what is saved.
// ─────────────────────────────────────────────────────────────────────────────

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from '../../../app/store'
import { fillItemFields } from '../../../features/ai/api/aiApi'
import { cleanItemFill, itemFillTextProblem } from '../../../features/items/itemFill'
import { useMutationWithFeedback } from '../../hooks/useMutationWithFeedback'
import { fillForm, fillWords, type FillField, type FillResult, type FillScreen } from './itemFillForm'
import type { PlanForm } from './planForm'

/** The answer had nothing this screen takes. */
export const FILL_NOTHING_READ = "Couldn't read that — try different words"
/** Messages that already say what to do (aiApi.friendlyError); anything else is said plainly. */
const SAYS_ITSELF = /^(Daily AI limit|AI is not configured|Session error|Type what it is|At most \d+ characters|Plain text on one line)/

type Step = { step: 'closed' } | { step: 'asking' } | { step: 'review'; fields: FillField[]; rows: string[] }
const CLOSED: Step = { step: 'closed' }

export interface ItemFillState {
  step: Step['step']
  busy: boolean
  /** The fields filled and not kept yet. */
  fields: readonly FillField[]
  /** The row labels to mark. */
  rows: ReadonlySet<string>
  /** An edit's autosave waits while this is true. */
  reviewing: boolean
  ask: () => void
  close: () => void
  submit: (text: string) => void
  accept: () => void
  cancel: () => void
}

export function useItemFill<S>({ open, item, form, screen, take, put, fillInto, flush }: {
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
  /** An edit: sends what waits to be saved, before ✨ changes anything. */
  flush?: () => Promise<unknown>
}): ItemFillState {
  const [state, setState] = useState<Step>(CLOSED)
  const [before, setBefore] = useState<S | null>(null)
  // A new opening or another item: the review ends (its fields went with the old form).
  const [seen, setSeen] = useState({ open, item })
  const session = useRef(0)
  if (seen.open !== open || seen.item !== item) {
    setSeen({ open, item })
    setState(CLOSED)
    setBefore(null)
  }
  const latest = useRef({ open, item, form, screen, take, put, fillInto, flush })
  useLayoutEffect(() => {
    if (latest.current.open !== open || latest.current.item !== item) session.current += 1
    latest.current = { open, item, form, screen, take, put, fillInto, flush }
  })

  /** Puts the screen back as it was before ✨ — only while it still shows the same item. */
  const putBack = (taken: S, startedIn: number, said: string) => {
    if (session.current !== startedIn || !latest.current.open) return
    latest.current.put(taken)
    setState(CLOSED)
    setBefore(null)
    toast.success(said)
  }

  const run = useMutationWithFeedback<FillResult & { taken: S; startedIn: number }, string>({
    action: 'fill_item_fields',
    silent: 'useItemFill says the result itself: "Filled … — check them" with its Undo, and the review bar',
    // The sentence may hold personal details; the error log is readable by the assistant.
    logPayload: false,
    mutationFn: async (text) => {
      const why = itemFillTextProblem(text)
      if (why) throw new Error(why)
      const startedIn = session.current
      await latest.current.flush?.()
      let raw: unknown
      try {
        raw = await fillItemFields(text.trim())
      } catch (e) {
        const msg = (e as Error).message ?? ''
        throw new Error(SAYS_ITSELF.test(msg) ? msg : "Couldn't fill the fields — try again in a moment", { cause: e })
      }
      if (session.current !== startedIn || !latest.current.open) throw new Error('The screen changed while ✨ read it — nothing was filled')
      // The server's answer is input too: the same check again, then only rows this screen shows.
      const now = latest.current
      const fill = cleanItemFill(raw, { today: now.screen.today, sentence: text.trim() })
      const out = fillForm(now.form, fill, now.screen)
      if (!out.fields.length) throw new Error(FILL_NOTHING_READ)
      return { ...out, taken: now.take(), startedIn }
    },
    onSuccess: (out) => {
      latest.current.fillInto(out.form)
      setBefore(() => out.taken)
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
    ask: () => setState(s => (s.step === 'closed' ? { step: 'asking' } : s)),
    close: () => setState(s => (s.step === 'asking' ? CLOSED : s)),
    submit: (text) => { if (!run.isPending) run.mutate(text) },
    accept: () => {
      if (state.step !== 'review') return
      const taken = before
      const startedIn = session.current
      setState(CLOSED)
      setBefore(null)
      if (taken !== null) toast.undo('Filled fields kept', () => putBack(taken, startedIn, 'Put back as it was'))
    },
    cancel: () => {
      if (state.step !== 'review' || before === null) return
      putBack(before, session.current, 'Put back as it was')
    },
  }
}
