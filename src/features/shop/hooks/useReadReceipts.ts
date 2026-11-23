import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { todayStr } from '../../../shared/utils/dateUtils'
import { ClaudeJobError } from '../../ai/claude/claudeApi'
import { readReceiptInput, type ReceiptCategory } from '../../ai/claude/featureJobs'
import type { ReceiptRead } from '../../ai/claude/featureRules'
import { receiptInputOf } from '../../ai/claude/photoShrink'
import { FAILS_IN_A_ROW, haltFor } from '../receiptBatch'

// "Read several receipts": one call per file, one after another (like Tidy up's run), each file read and shrunk only
// when its turn comes. A file is never kept, and its name never leaves this screen: the job gets the photo or the PDF,
// the categories and nothing else; the mutation logs no payload.

/** The per-minute cap clears itself: a wait and one more try, a few times, then the queue stops with the function's own words. */
const BUSY_WAIT_MS = 20_000
const BUSY_TRIES = 3

const wait = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  const t = setTimeout(resolve, ms)
  signal.addEventListener('abort', () => { clearTimeout(t); resolve() }, { once: true })
})

export type ReadDone = ReceiptRead & { costUsd: number | null }

export interface ReceiptRunInput {
  /** The files to read, in order; `id` is the row's own number (never the file's name). */
  jobs: readonly { id: number; file: File }[]
  categories: readonly ReceiptCategory[]
  signal: AbortSignal
  /** A file's turn has come (reading) / it was read / it failed with the function's own sentence. */
  onReading: (id: number, done: number, total: number) => void
  onRead: (id: number, read: ReadDone) => void
  onFailed: (id: number, message: string) => void
}

export interface ReceiptRunResult {
  read: number
  failed: number
  stopped: boolean
  /** The function's own sentence when the queue had to end early (a switch, the budget, billing, a cap, two failures in a row). */
  halted: string | null
  /** The ids that were never tried. */
  untried: number[]
  costUsd: number
}

/** Reads each file with the AI, one at a time. Every answer is checked again by `readReceiptInput`; nothing is saved. */
export function useReceiptRun() {
  return useMutationWithFeedback<ReceiptRunResult, ReceiptRunInput>({
    action: 'read_receipts',
    silent: 'each file\'s row shows its own result or the function\'s own sentence',
    logPayload: false,
    mutationFn: async ({ jobs, categories, signal, onReading, onRead, onFailed }) => {
      let read = 0, failed = 0, costUsd = 0, stopped = false, halted: string | null = null, inARow = 0
      const untried: number[] = []
      for (let i = 0; i < jobs.length; i++) {
        const { id, file } = jobs[i]
        if (stopped || halted) { untried.push(id); continue }
        if (signal.aborted) { stopped = true; untried.push(id); continue }
        onReading(id, i, jobs.length)
        for (let attempt = 1; ; attempt++) {
          try {
            const r = await readReceiptInput(await receiptInputOf(file), todayStr(), categories)
            costUsd += r.costUsd ?? 0
            inARow = 0
            read++
            onRead(id, r)
          } catch (error) {
            const message = error instanceof Error ? error.message : 'That file could not be read.'
            const what = haltFor(error instanceof ClaudeJobError ? error.reason : undefined, message)
            if (what === 'stop') { halted = message; untried.push(id) }
            else if (what === 'busy') {
              if (attempt < BUSY_TRIES) { await wait(BUSY_WAIT_MS, signal); if (!signal.aborted) continue }
              if (signal.aborted) { stopped = true; untried.push(id) } else { halted = message; untried.push(id) }
            } else {
              failed++
              inARow++
              onFailed(id, message)
              if (inARow >= FAILS_IN_A_ROW) halted = message
            }
          }
          break
        }
      }
      return { read, failed, stopped, halted, untried, costUsd }
    },
  })
}
