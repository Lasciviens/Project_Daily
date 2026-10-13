// THE delete flow (owner, 12.10.2026 + 13.10.2026): every delete asks first,
// tells you what happened, and offers Undo that puts the same rows back.
// Pure — the question and the toasts are passed in — so
// scripts/verify-delete-flow.cjs can run it; confirmDelete (deleteFlow.ts)
// wires the app's real ones.
//
// The delete's own answer decides what is said (the "sy-subrc" check): a
// delete that RETURNS the rows it removed tells us whether anything was
// there — no second read. Those rows are also the Undo snapshot.

export interface DeleteFlow<S> {
  /** The question: "Delete this task?" */
  title: string
  /** One line under the question ("Its schedule slot goes too."). */
  message?: string
  /** Default "Delete". */
  confirmLabel?: string
  /** false: the user already confirmed (a selection bar's own dialog). */
  ask?: boolean
  /**
   * Deletes and returns what was deleted. Errors are the caller's mutation's
   * to show (useMutationWithFeedback toasts them), so the flow stays quiet
   * and only reports nothing was deleted.
   */
  remove: () => Promise<S>
  /** Nothing was there to delete (default: null, undefined or an empty list). */
  isEmpty?: (snapshot: S) => boolean
  /**
   * Puts the snapshot back with the same ids. Leave it out only when a delete
   * cannot be undone (it lives outside the app) — the question then says so.
   * Like remove, a mutation that shows its own errors. It may resolve with a
   * note on what could not come back ("Not brought back: price history").
   */
  restore?: (snapshot: S) => Promise<string | void>
  /** This particular delete can't be undone after all (too big to hold). */
  canUndo?: (snapshot: S) => boolean
  /** The result: "Task deleted". */
  done: string | ((snapshot: S) => string)
  /** After Undo; default "Restored". */
  restored?: string
}

export interface DeleteFlowDeps {
  confirm: (o: { title: string; message?: string; confirmLabel: string; destructive: true }) => Promise<boolean>
  undoToast: (message: string, onUndo: () => void) => void
  success: (message: string) => void
  info: (message: string) => void
  warning: (message: string) => void
}

/** Said in the question when a delete has no Undo. */
export const NO_UNDO = "This can't be undone."

const emptyByDefault = (s: unknown) =>
  s == null || (Array.isArray(s) && s.length === 0)

/**
 * Runs one delete. Resolves 'deleted', 'kept' (the user said no), 'gone'
 * (nothing was there any more) or 'failed' (the mutation showed why).
 */
export async function runDeleteFlow<S>(flow: DeleteFlow<S>, deps: DeleteFlowDeps): Promise<'deleted' | 'kept' | 'gone' | 'failed'> {
  if (flow.ask !== false) {
    const message = flow.restore ? flow.message : [flow.message, NO_UNDO].filter(Boolean).join(' ')
    const ok = await deps.confirm({ title: flow.title, message, confirmLabel: flow.confirmLabel ?? 'Delete', destructive: true })
    if (!ok) return 'kept'
  }
  let snapshot: S
  try {
    snapshot = await flow.remove()
  } catch {
    return 'failed'
  }
  if ((flow.isEmpty ?? emptyByDefault)(snapshot)) {
    deps.info('Already deleted')
    return 'gone'
  }
  const text = typeof flow.done === 'function' ? flow.done(snapshot) : flow.done
  const restore = flow.restore
  if (!restore || flow.canUndo?.(snapshot) === false) {
    deps.success(restore ? `${text} · too much to undo` : text)
    return 'deleted'
  }
  deps.undoToast(text, () => {
    restore(snapshot).then(note => {
      const done = flow.restored ?? 'Restored'
      if (note) deps.warning(`${done} · ${note}`)
      else deps.success(done)
    }, () => undefined)
  })
  return 'deleted'
}
