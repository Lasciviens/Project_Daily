import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useClaudeDescribe } from '../../../ai/claude/hooks/useClaude'
import { RECEIPT_CATEGORIES_MAX } from '../../../ai/claude/featureJobs'
import { useShopCategories } from '../../hooks/useShop'
import { useReceiptRun, type ReadDone, type ReceiptRunResult } from '../../hooks/useReadReceipts'
import { categoriesChars, checkPicked, duplicatesOf, isPdf, queueWorstCost, shownName, type FileKind } from '../../receiptBatch'
import { tidyCategories } from '../../tidyModel'

export type FileStatus = 'waiting' | 'reading' | 'done' | 'failed' | 'refused' | 'stopped'

/** One picked file's row. `name` is shown as text only: it is never sent, stored or logged. */
export interface FileRow { id: number; name: string; kind: FileKind; status: FileStatus; read: ReadDone | null; error: string | null }

/**
 * The files of "Read a receipt": picked together (at most 5 a pick), checked in the browser, read one after another with a
 * progress line and a Stop. The File objects stay in memory only until their turn is done; nothing is stored.
 */
export function useReceiptFiles() {
  const { data: categories = [] } = useShopCategories()
  const sent = useMemo(() => tidyCategories(categories, RECEIPT_CATEGORIES_MAX), [categories])
  const describe = useClaudeDescribe()
  const run = useReceiptRun()
  const [rows, setRows] = useState<FileRow[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<ReceiptRunResult | null>(null)
  const files = useRef(new Map<number, File>())
  const control = useRef<AbortController | null>(null)
  const next = useRef(0)

  // Leaving the popup ends the run: no more calls are made (and paid) for a screen that is gone.
  useEffect(() => () => control.current?.abort(), [])

  const patch = useCallback((id: number, p: Partial<FileRow>) => setRows(all => all.map(r => (r.id === id ? { ...r, ...p } : r))), [])

  /** A pick: checked here first (type, PDF size, at most 5), then listed as waiting. Nothing is sent yet. */
  function add(picked: File[]) {
    const { accepted, refused, cut } = checkPicked(picked)
    const made: FileRow[] = []
    for (const f of accepted) {
      const id = next.current++
      files.current.set(id, f)
      made.push({ id, name: shownName(f.name), kind: isPdf(f) ? 'pdf' : 'photo', status: 'waiting', read: null, error: null })
    }
    for (const r of refused) made.push({ id: next.current++, name: shownName(r.name), kind: 'photo', status: 'refused', read: null, error: r.why })
    setRows(all => [...all, ...made])
    setNote(cut > 0 ? `Only the first 5 files of a pick are taken; ${cut} ${cut === 1 ? 'was' : 'were'} left out.` : null)
    setResult(null)
  }

  function start(ids?: readonly number[]) {
    if (run.isPending) return
    const want = new Set(ids ?? rows.filter(r => r.status === 'waiting' || r.status === 'stopped').map(r => r.id))
    const jobs = rows.filter(r => want.has(r.id) && files.current.has(r.id)).map(r => ({ id: r.id, file: files.current.get(r.id) as File }))
    if (!jobs.length) return
    const controller = new AbortController()
    control.current = controller
    setResult(null)
    for (const j of jobs) patch(j.id, { status: 'waiting', error: null })
    run.mutate({
      jobs, categories: sent, signal: controller.signal,
      onReading: (id, done, total) => { patch(id, { status: 'reading' }); setProgress({ done, total }) },
      onRead: (id, read) => { files.current.delete(id); patch(id, { status: 'done', read }) },
      onFailed: (id, message) => patch(id, { status: 'failed', error: message }),
    }, {
      onSuccess: r => {
        setResult(r)
        setProgress(null)
        // A file the queue never reached keeps its place and can be started again.
        setRows(all => all.map(x => (r.untried.includes(x.id) ? { ...x, status: 'stopped', error: r.halted } : x)))
      },
      onError: () => setProgress(null),
    })
  }

  /** The most the given kinds of file could cost, from the job's own prices and what is really sent with them. */
  const worst = useCallback((kinds: readonly FileKind[]): number | null => {
    const about = describe.data
    const job = about?.jobs.find(j => j.name === 'receipt_read')
    const price = about?.prices.models.find(m => m.model === job?.defaults.model)
    if (!about || !job || !price || !kinds.length) return null
    return queueWorstCost(
      { webSearchUsdEach: about.prices.webSearchUsdEach, longPromptOverTokens: about.prices.longPromptOverTokens, longPromptMultiplier: about.prices.longPromptMultiplier, model: price },
      { instructionsChars: job.instructions.length, maxOutputTokens: job.defaults.maxOutputTokens }, kinds, categoriesChars(sent.map(c => c.path)),
    )
  }, [describe.data, sent])
  const waitingKinds = rows.filter(r => r.status === 'waiting' || r.status === 'stopped').map(r => r.kind)
  const kindsKey = waitingKinds.join(',')
  const estimate = useMemo(() => worst(kindsKey ? (kindsKey.split(',') as FileKind[]) : []), [worst, kindsKey])

  /** A file the owner does not want read: off the list (and out of memory), never sent. */
  function drop(id: number) {
    if (run.isPending) return
    files.current.delete(id)
    setRows(all => all.filter(r => r.id !== id))
  }

  const reads = useMemo(() => rows.map(r => r.read), [rows])
  const dupes = useMemo(() => duplicatesOf(reads), [reads])
  return {
    rows, dupes, add, start, drop, stop: () => control.current?.abort(), retry: (id: number) => start([id]), worstOf: (kind: FileKind) => worst([kind]),
    running: run.isPending, progress, result, note, estimate, estimateFailed: describe.isError,
    waiting: waitingKinds.length,
  }
}
