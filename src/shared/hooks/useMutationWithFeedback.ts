import { useMutation, type UseMutationOptions, type UseMutationResult } from '@tanstack/react-query'
import { toast } from '../../app/store'
import { logError } from '../utils/logError'

// Wraps TanStack Query's useMutation so every mutation built with it is
// GUARANTEED to surface a failure (toast.error + logError) — a structural
// check baked into the primitive itself, not something every call site has
// to remember to hand-write. Before this existed, the mandatory "toast on
// every async action" rule was followed inconsistently: some hooks toasted
// on error but forgot logError (recurred twice — Developer tab's clear-logs
// mutations), others had no feedback at all anywhere (the daily timeline's
// drag/postpone/rename/delete, the to-do list's toggle/delete/reorder) — a
// real, repeated regression. Building the mutation with this hook instead of
// bare useMutation makes that class of bug structurally impossible: forgetting
// to add an onError toast no longer means silence, it means the default one.
//
// `action` is the one thing every caller must still supply — a short
// snake_case identifier used as the logError context (e.g. "delete_task",
// "postpone_time_block"). Everything else is automatic:
// - onError: always toasts the error message and logs it to app_error_logs.
// - onSuccess: silent by default (matches the existing "edits feel live, no
//   toast needed" convention) — pass `successMessage` to opt into a toast.
// A caller-supplied onSuccess/onError still runs (e.g. to invalidate query
// keys) — this only ADDS the guaranteed feedback, it never replaces app logic.
interface FeedbackMutationOptions<TData, TVariables, TContext>
  extends UseMutationOptions<TData, Error, TVariables, TContext> {
  action: string
  successMessage?: string | ((data: TData, variables: TVariables) => string)
  errorFallback?: string
}

export function useMutationWithFeedback<TData, TVariables = void, TContext = unknown>({
  action,
  successMessage,
  errorFallback,
  onSuccess,
  onError,
  ...rest
}: FeedbackMutationOptions<TData, TVariables, TContext>): UseMutationResult<TData, Error, TVariables, TContext> {
  return useMutation<TData, Error, TVariables, TContext>({
    ...rest,
    onSuccess: (data, variables, onMutateResult, context) => {
      if (successMessage) {
        toast.success(typeof successMessage === 'function' ? successMessage(data, variables) : successMessage)
      }
      onSuccess?.(data, variables, onMutateResult, context)
    },
    onError: (err, variables, onMutateResult, context) => {
      const msg = (err as Error)?.message ?? errorFallback ?? 'Something went wrong'
      toast.error(msg)
      logError(`${errorFallback ?? action}: ${msg}`, { action, payload: variables })
      onError?.(err, variables, onMutateResult, context)
    },
  })
}
