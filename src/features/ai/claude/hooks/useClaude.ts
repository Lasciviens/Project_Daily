import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../../shared/query'
import { describeClaude, diagnoseClaude } from '../claudeApi'
import { countBenchQuestion, runBenchQuestion, type BenchPick } from '../benchJobs'
import { fetchCallMeta } from '../../chat/chatApi'
import { fetchAiCall, fetchAiCallsPage, fetchAiJobSettings, fetchAiSettings, fetchAiUsage, saveAiJobSettings, saveAiSettings } from '../ledgerApi'
import { osloMonthRange } from '../ledgerRules'
import type { AiCallsFilter, AiJobSettings, AiSettings } from '../types'

// Developer → AI's reads and writes (and Settings → Subscriptions' Anthropic card, which reads `describe`).

/** What the `claude` function says about itself. */
export function useClaudeDescribe() {
  return useQuery({ queryKey: qk.claude.describe(), queryFn: describeClaude, staleTime: STALE.default })
}

/** This Oslo month's usage, per day, job, mode and model, with the month it is for. */
export function useAiUsageMonth() {
  const month = osloMonthRange(new Date())
  const query = useQuery({
    queryKey: qk.claude.usage(month.from, month.to),
    queryFn: () => fetchAiUsage(month.from, month.to),
    staleTime: STALE.short,
  })
  return { ...query, month }
}

/** One page of the ledger, newest first; the page before stays on screen while the next loads. */
export function useAiCalls(filter: AiCallsFilter, page: number) {
  return useQuery({
    queryKey: qk.aiCalls.page(filter, page),
    queryFn: () => fetchAiCallsPage(filter, page),
    staleTime: STALE.live,
    placeholderData: keepPreviousData,
  })
}

/** One call with its text log, read when it is opened. */
export function useAiCall(id: string | null) {
  return useQuery({
    queryKey: qk.aiCalls.call(id ?? ''),
    queryFn: () => fetchAiCall(id as string),
    staleTime: STALE.default,
    enabled: !!id,
  })
}

/** The stored settings row, or null with none (the function's defaults apply: ledgerRules.readSettings). */
export function useAiSettings() {
  return useQuery({ queryKey: qk.claude.settings(), queryFn: fetchAiSettings, staleTime: STALE.default })
}

export function useAiJobSettings() {
  return useQuery({ queryKey: qk.claude.jobSettings(), queryFn: fetchAiJobSettings, staleTime: STALE.default })
}

export function useSaveAiSettings() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'save_ai_settings',
    successMessage: 'AI settings saved',
    mutationFn: (input: AiSettings) => saveAiSettings(input),
    // The write's own answer is what is stored now.
    onSuccess: stored => { qc.setQueryData(qk.claude.settings(), stored) },
    invalidates: ['aiSettings'],
  })
}

export function useSaveAiJobSettings() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'save_ai_job_settings',
    successMessage: (_stored, v: { input: AiJobSettings; title: string }) => `${v.title}: settings saved`,
    mutationFn: ({ input }: { input: AiJobSettings; title: string }) => saveAiJobSettings(input),
    onSuccess: stored => {
      qc.setQueryData<AiJobSettings[]>(qk.claude.jobSettings(), rows => [...(rows ?? []).filter(r => r.job !== stored.job), stored])
    },
    invalidates: ['aiSettings'],
  })
}

/**
 * Developer → AI → How it works → Diagnose. Two of its four checks are real calls, so they land in Calls and in the
 * month's usage: those lists refresh. The Diagnose card shows the result itself, so the hook says nothing more.
 */
export function useClaudeDiagnose() {
  return useMutationWithFeedback({
    action: 'claude_diagnose',
    silent: 'the Diagnose card shows its own result',
    mutationFn: () => diagnoseClaude(),
    invalidates: ['aiLedger'],
  })
}

/** Developer → AI → Test bench: "Count tokens" is free, but it leaves a zero-cost row in Calls (that is what its few-a-minute cap counts). */
export function useBenchCount() {
  return useMutationWithFeedback({
    action: 'claude_bench_count',
    silent: 'the Test bench shows the count itself',
    mutationFn: ({ question, pick }: { question: string; pick: BenchPick }) => countBenchQuestion(question, pick),
    invalidates: ['aiLedger'],
  })
}

/** Developer → AI → Test bench: a real call (reserved, ledgered). The bench shows the answer, so the hook says nothing more. */
export function useBenchRun() {
  return useMutationWithFeedback({
    action: 'claude_bench_run',
    silent: 'the Test bench shows the answer and its cost itself',
    mutationFn: ({ question, pick }: { question: string; pick: BenchPick }) => runBenchQuestion(question, pick),
    invalidates: ['aiLedger'],
  })
}

/** The cache-miss reason and the context-editing numbers kept with an Ask AI answer (Developer → AI → Calls). */
export function useAiCallMeta(callId: string | null, enabled: boolean) {
  return useQuery({ queryKey: qk.aiChat.callMeta(callId ?? ''), queryFn: () => fetchCallMeta(callId as string), staleTime: STALE.default, enabled: enabled && !!callId })
}
