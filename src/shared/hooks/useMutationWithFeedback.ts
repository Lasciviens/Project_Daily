import { useMutation, useQueryClient, type QueryKey, type UseMutationOptions, type UseMutationResult } from '@tanstack/react-query'
import { toast } from '../../app/store'
import { logError } from '../utils/logError'
import { invalidate, type InvalidationGroup } from '../query/invalidate'

// THE mutation primitive (THEME.md §10). Every failure is GUARANTEED to be
// toasted and logged to app_error_logs — forgetting an onError no longer means
// silence, it means the default one. Beyond that, the primitive owns the rest
// of the feedback so call sites never hand-write toast blocks:
//
// - `action`          snake_case logError context ("delete_task"). Required.
// - `successMessage`  the result the user is told when the write succeeds
//                     ("Task saved"). Every user action reports its result
//                     (owner, 13.10.2026), so a hook gives either this or
//   `silent`          the reason it says nothing itself: the write is
//                     automatic (a sync, a debounce), or its caller reports
//                     the result (the delete flow, withProgress). A message
//                     resolving to undefined stays silent for that call.
// - `loadingMessage`  opt-in "Saving…" toast for slow writes, dismissed when
//                     the request settles (kept out of onMutate's context, so
//                     optimistic hooks keep their snapshot there).
// - `invalidates`     groups / keys refreshed after the mutation settles,
//                     success or failure (an optimistic write rolled back
//                     still needs the server truth).
// - `refresh`         'background' (default): the refresh runs on its own and
//                     the mutation resolves as soon as the write answers — the
//                     write's own result decides success, not a re-read.
//                     Before, every save also waited for every list under its
//                     groups to download again (the Google Calendar list
//                     included), which is what kept the UI waiting. 'wait'
//                     only for a flow that reads the refreshed cache right
//                     after (two clicks must see the first one's row).
// - `logPayload`      false: the input never reaches app_error_logs. Set it
//                     when the input IS a secret (a pasted token, an OAuth
//                     code) — the AI can read that table (security audit).
// A caller's own onSuccess/onError/onSettled still runs after these.
//
// Callers must NOT wrap mutateAsync in their own toast.error — that
// double-toasts. Use try/catch only to stop a multi-step flow: `catch { return }`.
type Target = InvalidationGroup | QueryKey
type Resolve<T, A extends unknown[]> = T | ((...args: A) => T)

type ResultFeedback<TData, TVariables> =
  | { successMessage: Resolve<string | undefined, [TData, TVariables]>; silent?: never }
  | { silent: string; successMessage?: never }

type FeedbackMutationOptions<TData, TVariables, TContext> =
  UseMutationOptions<TData, Error, TVariables, TContext> & ResultFeedback<TData, TVariables> & {
    action: string
    loadingMessage?: Resolve<string | undefined, [TVariables]>
    errorFallback?: string
    invalidates?: Resolve<readonly Target[], [TData | undefined, TVariables]>
    refresh?: 'background' | 'wait'
    logPayload?: boolean
  }

const resolve = <T, A extends unknown[]>(v: Resolve<T, A> | undefined, ...args: A) =>
  (typeof v === 'function' ? (v as (...a: A) => T)(...args) : v)

export function useMutationWithFeedback<TData, TVariables = void, TContext = unknown>({
  action,
  successMessage,
  loadingMessage,
  errorFallback,
  invalidates,
  refresh = 'background',
  logPayload = true,
  silent: _silent,
  mutationFn,
  onSuccess,
  onError,
  onSettled,
  ...rest
}: FeedbackMutationOptions<TData, TVariables, TContext>): UseMutationResult<TData, Error, TVariables, TContext> {
  const qc = useQueryClient()
  return useMutation<TData, Error, TVariables, TContext>({
    ...rest,
    mutationFn: mutationFn && (async (variables, ctx) => {
      const label = resolve(loadingMessage, variables)
      const tid = label ? toast.loading(label) : undefined
      try {
        return await mutationFn(variables, ctx)
      } finally {
        if (tid !== undefined) toast.dismiss(tid)
      }
    }),
    onSuccess: (data, variables, onMutateResult, context) => {
      const msg = resolve(successMessage, data, variables)
      if (msg) toast.success(msg)
      return onSuccess?.(data, variables, onMutateResult, context)
    },
    onError: (err, variables, onMutateResult, context) => {
      const msg = (err as Error)?.message || errorFallback || 'Something went wrong'
      toast.error(msg)
      logError(`${action}: ${msg}`, logPayload ? { action, payload: variables } : { action })
      return onError?.(err, variables, onMutateResult, context)
    },
    onSettled: async (data, error, variables, onMutateResult, context) => {
      const targets = resolve(invalidates, data, variables)
      if (targets?.length) {
        const refreshed = invalidate(qc, ...targets)
        if (refresh === 'wait') await refreshed
        else void refreshed.catch(() => undefined)
      }
      return onSettled?.(data, error, variables, onMutateResult, context)
    },
  })
}

/**
 * Per-call loading/success copy around a mutateAsync whose hook already
 * toasts + logs errors. Resolves undefined on failure (never re-toasts).
 */
export async function withProgress<T>(run: () => Promise<T>, msg: { loading: string; success?: string }): Promise<T | undefined> {
  const tid = toast.loading(msg.loading)
  try {
    const result = await run()
    toast.dismiss(tid)
    if (msg.success) toast.success(msg.success)
    return result
  } catch {
    toast.dismiss(tid)
    return undefined
  }
}
