// ─────────────────────────────────────────────────────────────────────────────
//  An edit on the item screen saves by itself (owner's point 11): a change
//  waits a moment (typing, a drag), then goes as ONE item save; the heading's
//  line says "Saving…", then "Saved". One save at a time — a change made while
//  one runs goes right after it, with what it answered (a slot it made). A
//  form that can't be saved (no title, an incomplete repeat, an end before
//  the start, a link that isn't https) says why and waits — once the typing
//  pauses or the field is left (`settle`), so a link being typed never flashes
//  "Not saved". A change held back (itemScreenRules.
//  heldChange: a new list's name being typed, a slot about to go) waits for
//  the screen to close. Closing the screen sends what is left first.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formContentKey, type PlanForm } from './planForm'
import { heldChange } from './itemScreenRules'

/** How long a change waits for the next one (a word being typed, a drag) before it is saved. */
export const AUTOSAVE_DELAY_MS = 700

/** 'kept': the save was declined on the way (a training session planned twice: "Keep one") — nothing was written. */
export type PersistResult = 'saved' | 'kept'

export type AutosaveLine =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'held'; reason: string }
  | { kind: 'saved' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'failed' }

/** What closing found: nothing left, saved now, a form that can't be saved (closing drops it), or a failed save. */
export type FlushResult = { kind: 'done' } | { kind: 'problem'; reason: string } | { kind: 'failed' }

export function useItemAutosave({ enabled, form, problem, persist }: {
  /** An edit whose rows are loaded. */
  enabled: boolean
  form: PlanForm
  /** Why the form can't be saved as it is, or null. */
  problem: string | null
  /** The one save of this form. Throws when it failed (the save's own hook said why). */
  persist: (form: PlanForm) => Promise<PersistResult>
}) {
  const key = formContentKey(form)
  // What the database holds: the form as opened (reset by the screen when it seeds), then as last saved.
  const [savedKey, setSavedKey] = useState(key)
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedOnce, setSavedOnce] = useState(false)
  // The form a problem may be said for: the one that stayed unchanged for the wait, or was there when a field was left.
  const [judgedKey, setJudgedKey] = useState<string | null>(null)
  const latest = useRef({ enabled, form, problem, persist, savedKey })
  useLayoutEffect(() => { latest.current = { enabled, form, problem, persist, savedKey } })
  const inFlight = useRef<Promise<boolean> | null>(null)
  const again = useRef(false)

  /** Saves the latest form when it differs from what is saved; resolves false when the save failed. */
  const run = useCallback((): Promise<boolean> => {
    if (inFlight.current) { again.current = true; return inFlight.current }
    const job = (async () => {
      let ok = true
      do {
        again.current = false
        const { enabled: on, form: f, problem: why, persist: send, savedKey: saved } = latest.current
        const k = formContentKey(f)
        if (!on || why || k === saved) break
        setSaving(true)
        try {
          if (await send(f) === 'saved') {
            latest.current.savedKey = k
            setSavedKey(k)
            setSavedOnce(true)
          }
          setFailedKey(null)
        } catch {
          ok = false
          setFailedKey(k)
        }
      } while (ok && again.current)
      again.current = false
      inFlight.current = null
      setSaving(false)
      return ok
    })()
    inFlight.current = job
    return job
  }, [])

  const dirty = enabled && key !== savedKey
  // Only `flush` sends a held change (when the screen closes).
  const hold = dirty ? heldChange(form, JSON.parse(savedKey) as Partial<PlanForm>) : null
  useEffect(() => {
    if (!dirty || problem || hold || key === failedKey) return
    const id = window.setTimeout(() => { void run() }, AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [dirty, key, problem, hold, failedKey, run])

  useEffect(() => {
    if (!problem || key === judgedKey) return
    const id = window.setTimeout(() => setJudgedKey(key), AUTOSAVE_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [key, problem, judgedKey])
  /** Sends this form now, held or not — asked for (Undo changes), not a stray tap. */
  const saveNow = useCallback((f: PlanForm, why: string | null) => {
    latest.current = { ...latest.current, form: f, problem: why }
    return run()
  }, [run])
  /** A field was left: the form as it is now may be judged at once. */
  const settle = useCallback(() => setJudgedKey(formContentKey(latest.current.form)), [])

  /** Before the screen closes: what waits is sent now. */
  const flush = useCallback(async (): Promise<FlushResult> => {
    if (inFlight.current && !(await inFlight.current)) return { kind: 'failed' }
    const { enabled: on, form: f, problem: why, savedKey: saved } = latest.current
    if (!on || formContentKey(f) === saved) return { kind: 'done' }
    if (why) return { kind: 'problem', reason: why }
    return (await run()) ? { kind: 'done' } : { kind: 'failed' }
  }, [run])

  const line: AutosaveLine = !enabled ? { kind: 'idle' }
    : dirty && problem ? (key === judgedKey ? { kind: 'blocked', reason: problem } : { kind: 'idle' })
    : dirty && key === failedKey && !saving ? { kind: 'failed' }
    : dirty && hold && !saving ? { kind: 'held', reason: hold }
    : saving || dirty ? { kind: 'saving' }
    : savedOnce ? { kind: 'saved' }
    : { kind: 'idle' }

  return { line, flush, retry: () => { setFailedKey(null); void run() }, savedKey, reset: setSavedKey, settle, savedOnce, saveNow }
}
