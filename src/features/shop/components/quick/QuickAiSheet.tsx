import { useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { ModalShell } from '../../../../shared/modals/ModalShell'
import { Button } from '../../../../shared/ui'
import { costNote } from '../../../ai/claude/featureRules'
import { useClaudeDescribe } from '../../../ai/claude/hooks/useClaude'
import { useAddBatchToQuickList } from '../../hooks/useQuickBatch'
import { useQuickParse } from '../../hooks/useQuickParse'
import {
  planQuickText, QUICK_AMOUNT_MAX, QUICK_LIMITS, quickReviewInputs, quickReviewRows, quickTextProblem, quickWorstCost,
  type QuickReviewRow,
} from '../../quickParseRules'

interface Props {
  open: boolean
  /** What was already typed in the quick-add field. */
  initialText: string
  /** The store the quick-add field keeps for the next item. */
  store: string
  onClose: () => void
}

/** The most dollars shown as a price: "up to ≈ $0.004". */
const upTo = (usd: number) => `up to ${costNote(usd)}`

type Source = { kind: 'code' } | { kind: 'ai'; costUsd: number | null }

/**
 * ✨ Sort out (owner, 23.11.2026: "I should be able to write things there and the ai will resolve and polish it to
 * separate items"). Write or paste, tap, review every item (all ticked, name and amount editable), "Add N". Code splits a
 * text that already has commas or lines; only the rest is sent to the AI, with its worst-case cost on the button and its
 * real cost after. Nothing is written until Add, which is the quick list's own batch add: titles already on the list are
 * left out and one Undo takes the whole batch off.
 */
export function QuickAiSheet({ open, initialText, store, onClose }: Props) {
  const describe = useClaudeDescribe()
  const parse = useQuickParse()
  const add = useAddBatchToQuickList()
  const [text, setText] = useState(initialText)
  const [rows, setRows] = useState<QuickReviewRow[] | null>(null)
  const [source, setSource] = useState<Source | null>(null)
  const [said, setSaid] = useState('')

  const problem = text.trim() ? quickTextProblem(text) : null
  const plan = useMemo(() => (text.trim() && !problem ? planQuickText(text) : null), [text, problem])

  // The most one call could cost, from the job's own prices.
  const worst = useMemo(() => {
    const about = describe.data
    const job = about?.jobs.find(j => j.name === 'quick_list_parse')
    const price = about?.prices.models.find(m => m.model === job?.defaults.model)
    if (!about || !job || !price) return null
    return quickWorstCost(
      { longPromptOverTokens: about.prices.longPromptOverTokens, longPromptMultiplier: about.prices.longPromptMultiplier, model: price },
      job.instructions.length, text, job.defaults.maxOutputTokens,
    )
  }, [describe.data, text])

  function sortWithAi() {
    if (parse.isPending || problem || !text.trim()) return
    setSaid('')
    parse.mutate({ text }, {
      onSuccess: r => {
        setSource({ kind: 'ai', costUsd: r.costUsd })
        setRows(quickReviewRows(r.items))
        if (r.items.length === 0) setSaid('No items found in that text.')
      },
    })
  }

  function go() {
    if (!plan || problem) return
    if (plan.kind === 'code') { setSource({ kind: 'code' }); setRows(quickReviewRows(plan.items)); setSaid(''); return }
    if (plan.kind === 'ai') sortWithAi()
  }

  const ticked = rows ? quickReviewInputs(rows, store) : []
  const change = (key: number, patch: Partial<QuickReviewRow>) => setRows(rs => rs && rs.map(r => (r.key === key ? { ...r, ...patch } : r)))
  function save() {
    if (!ticked.length) return
    add.mutate({ inputs: ticked, what: 'from your text' }, { onSuccess: onClose })
  }

  const busy = parse.isPending || add.isPending
  const costKnown = worst !== null

  const writing = rows === null
  return (
    <ModalShell open={open} onClose={onClose} title="Sort out a list" size="sm" dismissible={!busy}
      footer={
        <div className="flex items-center gap-2">
          {writing ? (
            <>
              <Button onClick={onClose} className="ml-auto" disabled={busy}>Cancel</Button>
              <Button variant="primary" icon={plan?.kind === 'ai' ? <Sparkles /> : undefined} onClick={go} loading={parse.isPending}
                disabled={!plan || plan.kind === 'empty' || plan.kind === 'toomany' || (plan.kind === 'ai' && !costKnown)}>
                {plan?.kind === 'code' ? 'Split' : worst !== null ? `Sort out · ${upTo(worst)}` : 'Sort out'}
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => { setRows(null); setSource(null) }} disabled={busy}>Edit text</Button>
              <Button variant="primary" className="ml-auto" onClick={save} loading={add.isPending} disabled={ticked.length === 0}>
                Add {ticked.length}
              </Button>
            </>
          )}
        </div>
      }>
      {writing ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="quick-ai-text" className="field-label">What do you need?</label>
          <textarea id="quick-ai-text" value={text} onChange={e => setText(e.target.value)} rows={5} maxLength={QUICK_LIMITS.text}
            autoFocus placeholder="melk brød 2x egg, tomatoes and some cheese for pizza" className="input resize-y" />
          <p role="status" className="text-meta text-fg-muted">
            {problem ? <span className="text-danger">{problem}</span>
              : !plan ? 'Write or paste it as it comes. Your own words and language stay as they are.'
              : plan.kind === 'code' ? `Splits on its own — no AI, no cost. ${plan.items.length} ${plan.items.length === 1 ? 'item' : 'items'}.`
              : plan.kind === 'toomany' ? `That is more than ${QUICK_LIMITS.items} items — add them in two rounds.`
              : plan.kind === 'empty' ? 'Nothing to add in that text.'
              : costKnown ? `AI reads it: ${upTo(worst)}, usually far less.`
              : describe.isError ? 'The cost could not be worked out — try again later.' : 'Working out the cost…'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p role="status" className="text-meta text-fg-muted">
            {source?.kind === 'ai'
              ? `Sorted by AI${source.costUsd !== null ? ` · ${costNote(source.costUsd)}` : ''}`
              : 'Split by the app, no AI'}
            {rows.length > 0 && ' · untick what you do not want'}
          </p>
          {said && <p className="text-body text-fg-muted">{said}</p>}
          {rows.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {rows.map(r => (
                <li key={r.key} className="flex items-center gap-2">
                  <input type="checkbox" checked={r.on} onChange={e => change(r.key, { on: e.target.checked })} aria-label={`Add ${r.name || 'this item'}`}
                    className="h-[18px] w-[18px] shrink-0 accent-accent-500" />
                  <input value={r.name} onChange={e => change(r.key, { name: e.target.value })} maxLength={QUICK_LIMITS.name} aria-label={`Name of item ${r.key + 1}`}
                    className="input input-sm min-w-0 flex-1" />
                  <input value={r.amount} onChange={e => change(r.key, { amount: e.target.value })} maxLength={QUICK_AMOUNT_MAX} aria-label={`Amount of item ${r.key + 1}`}
                    placeholder="Amount" className="input input-sm w-20 shrink-0" />
                </li>
              ))}
            </ul>
          )}
          {source?.kind === 'code' && rows.length > 0 && (
            <div className="flex flex-col items-start gap-1 pt-1">
              <Button size="sm" variant="ghost" icon={<Sparkles />} onClick={sortWithAi} loading={parse.isPending} disabled={!costKnown}>
                {costKnown ? `Check spelling with AI · ${upTo(worst)}` : 'Check spelling with AI'}
              </Button>
              <p className="text-meta text-fg-muted">The app kept your words as typed; AI also fixes obvious typos.</p>
            </div>
          )}
        </div>
      )}
    </ModalShell>
  )
}
