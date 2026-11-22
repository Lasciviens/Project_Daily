import { countClaudeBench, runClaudeJob } from './claudeApi'
import type { CallSummary } from './types'

// Developer → AI → Test bench: any question to the `claude` function's `test_bench` job, with the model, effort and
// thinking the owner picks (the function checks them against its own lists again). Nothing here is saved: the call
// is in the ledger like any call, and the answer is only shown.

/** What the owner picks for one question. */
export interface BenchPick {
  model: string
  effort: string
  thinking: 'adaptive' | 'off'
}

export interface BenchCount {
  inputTokens: number
  model: string
  effort: string
  thinking: 'adaptive' | 'off'
}

export interface BenchAnswer {
  text: string
  /** The model's summary of its reasoning, '' when it did not think. */
  thinking: string
  /** The model that really answered. */
  servedModel: string
  call: CallSummary | undefined
  pick: BenchPick
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
const input = (question: string, pick: BenchPick) => ({ text: question.trim(), model: pick.model, effort: pick.effort, thinking: pick.thinking })

/** The prompt's token count for this question and pick, before anything is sent. Free. */
export async function countBenchQuestion(question: string, pick: BenchPick): Promise<BenchCount> {
  const { inputTokens, model, effort, thinking } = await countClaudeBench(input(question, pick))
  return { inputTokens, model, effort, thinking }
}

/** Sends the question. A stopped run throws a ClaudeJobError with the function's own sentence. */
export async function runBenchQuestion(question: string, pick: BenchPick): Promise<BenchAnswer> {
  const { result, call } = await runClaudeJob<unknown>('test_bench', input(question, pick))
  const r = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>
  const answer = typeof r.text === 'string' ? r.text.trim() : ''
  if (!answer) throw new Error("The AI didn't send an answer — try again")
  return { text: answer.slice(0, 30_000), thinking: str(r.thinking, 20_000), servedModel: str(r.served_model, 80) || call?.served_model || pick.model, call, pick }
}

