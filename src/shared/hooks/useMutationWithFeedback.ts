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
// - `successMessage`  opt-in success toast (edits feel live without one).
// - `loadingMessage`  opt-in "Saving…" toast for slow writes, dismissed when
//                     the request settles (kept out of onMutate's context, so
//                     optimistic hooks keep their snapshot there).
// - `invalidates`     groups / keys refreshed after the mutation settles,
//                     success or failure (an optimistic write rolled back
//                     still needs the server truth).
// A caller's own onSuccess/onError/onSettled still runs after these.
//
// Callers must NOT wrap mutateAsync in their own toast.error — that
// double-toasts. Use try/catch only to stop a multi-step flow: `catch { return }`.
type Target = InvalidationGroup | QueryKey
type Resolve<T, A extends unknown[]> = T | ((...args: A) => T)

interface FeedbackMutationOptions<TData, TVariables, TContext>
  extends UseMutationOptions<TData, Error, TVariables, TContext> {
  action: string
  successMessage?: Resolve<string | undefined, [TData, TVariables]>
  loadingMessage?: Resolve<string | undefined, [TVariables]>
  errorFallback?: string
  invalidates?: Resolve<readonly Target[], [TData | undefined, TVariables]>
}

const resolve = <T, A extends unknown[]>(v: Resolve<T, A> | undefined, ...args: A) =>
  (typeof v === 'function' ? (v as (...a: A) => T)(...args) : v)

export function useMutationWithFeedback<TData, TVariables = void, TContext = unknown>({
  action,
  successMessage,
  loadingMessage,
  errorFallback,
  invalidates,
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
      logError(`${action}: ${msg}`, { action, payload: variables })
      return onError?.(err, variables, onMutateResult, context)
    },
    onSettled: async (data, error, variables, onMutateResult, context) => {
      const targets = resolve(invalidates, data, variables)
      if (targets?.length) await invalidate(qc, ...targets)
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
