import { useState } from 'react'
import { Check, ChevronRight, FileText, ImageIcon, Lightbulb, ListChecks, Loader2, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useUIStore } from '../../../app/store'
import { DateInput } from '../../../shared/components/DateInput'
import { useEntityModal } from '../../../shared/modals/useEntityModal'
import { Button, Truncate, cx } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import { todayStr } from '../../../shared/utils/dateUtils'
import { formatUsd } from '../claude/ledgerRules'
import { SUGGESTION_LINE, type SuggestionKind } from '../claude/suggestRules'
import { boldParts, cardStateLabel, citationTarget, isChangeTool, proposalFields, type ChatCard, type ChatCitation, type ChatStep, type ChatTurn } from './chatRules'
import { messageCopyText } from './chatTranscript'
import { CopyButton, ReportButton } from './ChatReport'

// One turn of the chat: the person's message, or the answer with what it looked up (and the inputs it used), the rows it
// cites (each a link to the owner's own row), the writes it proposes (a card that shows every field it would write, with
// the title and the date editable, Confirm and Cancel) and what the answer cost (a link to its calls in Developer → AI).
// Every message's text can be selected (select-text: an ancestor's no-select rule never reaches it) and copied; an answer
// can be reported to Dev Requests.

type Decide = (id: string, decision: 'confirm' | 'cancel', edits?: { title?: string; date?: string }) => void

function Bold({ text }: { text: string }) {
  return <>{boldParts(text).map((p, i) => (p.bold ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>))}</>
}

function CitationLink({ citation }: { citation: ChatCitation }) {
  const modal = useEntityModal()
  const navigate = useNavigate()
  const closeAI = useUIStore(s => s.closeAI)
  const open = () => {
    const target = citationTarget(citation)
    if (target.kind === 'task') { modal.open({ kind: 'task', id: target.id }); return }
    closeAI()
    navigate(target.path)
  }
  const Icon = citation.kind === 'task' ? ListChecks : FileText
  return (
    <button type="button" onClick={open} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1.5 text-meta text-fg-2 [@media(hover:hover)]:hover:border-line-strong [@media(hover:hover)]:hover:text-fg">
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <Truncate as="span" className="min-w-0">{citation.title}{citation.day ? ` · ${formatDate(citation.day)}` : ''}</Truncate>
    </button>
  )
}

/** The lookups of an answer: each with the inputs the code checked and used; the SQL stays behind a peek. */
function Steps({ steps, streaming }: { steps: ChatStep[]; streaming: boolean }) {
  const [sqlOpen, setSqlOpen] = useState<number | null>(null)
  return (
    <ul className="flex flex-col gap-0.5 px-1 text-meta text-fg-muted" role={streaming ? 'status' : undefined}>
      {steps.map((st, i) => {
        const running = streaming && i === steps.length - 1 && st.input === null
        const short = (st.input ?? []).filter(x => !x.long)
        const sql = (st.input ?? []).find(x => x.long)
        return (
          <li key={i} className="flex items-start gap-1.5">
            {running ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden /> : <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
            <span className="min-w-0">
              {st.label}
              {short.length > 0 && <span className="text-fg-faint"> · {short.map(x => `${x.label}: ${x.value}`).join(' · ')}</span>}
              {sql && (
                <>
                  {' '}
                  <button type="button" onClick={() => setSqlOpen(o => (o === i ? null : i))} aria-expanded={sqlOpen === i} className="inline-flex items-center gap-0.5 font-semibold text-accent-600 hover:text-accent-700">
                    <ChevronRight className={cx('h-3 w-3 transition-transform', sqlOpen === i && 'rotate-90')} aria-hidden />SQL
                  </button>
                  {sqlOpen === i && <code className="mt-1 block whitespace-pre-wrap break-words rounded-control border border-line bg-surface-2 px-2 py-1 font-mono text-micro text-fg-2">{sql.value}</code>}
                </>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** What a card is called, waiting and once saved. */
const CARD_WORDS: Record<ChatCard['tool'], [string, string]> = {
  add_task: ['Proposed task', 'Task added'], log_food: ['Proposed food line', 'Food line logged'],
  update_food: ['Proposed change to a food line', 'Food line changed'], update_task: ['Proposed new task title', 'Task renamed'],
}

function ProposalCard({ card, onDecide, onUndo }: { card: ChatCard; onDecide: Decide; onUndo: (id: string) => void }) {
  const modal = useEntityModal()
  const waiting = card.state === 'pending'
  const args = card.args
  // A change is confirmed as proposed; a food of the owner's own list keeps its own name. Only a new task or one-off line is edited here.
  const editable = !isChangeTool(card.tool) && !(card.tool === 'log_food' && args?.basis === 'yours')
  const [title, setTitle] = useState<string | null>(null)
  const [date, setDate] = useState<string | null>(null)
  const storedTitle = typeof args?.title === 'string' ? args.title : ''
  const storedDate = args ? String(card.tool === 'add_task' ? (args.due_date ?? '') : (args.date ?? '')) : ''
  const shownTitle = title ?? storedTitle
  const shownDate = date ?? storedDate
  // What the card shows is what would be written: the stored fields, with the owner's edits laid over them.
  const edited = args && editable ? { ...args, title: shownTitle, ...(card.tool === 'add_task' ? { due_date: shownDate || null } : { date: shownDate }) } : args
  const fields = edited ? proposalFields(card.tool, edited, todayStr()) : []
  const changed = shownTitle !== storedTitle || shownDate !== storedDate
  const confirm = () => onDecide(card.id, 'confirm', editable && changed ? { title: shownTitle, date: shownDate } : undefined)
  const open = () => {
    if (!card.resultId) return
    if (card.tool === 'add_task' || card.tool === 'update_task') modal.open({ kind: 'task', id: card.resultId })
    else modal.open({ kind: 'food-log-edit', entryId: card.resultId, date: String(args?.date ?? todayStr()) })
  }
  const done = card.state === 'confirmed'
  return (
    <div data-tone={done ? 'success' : card.state === 'failed' ? 'danger' : undefined} className={cx('w-full min-w-0 select-text rounded-card border bg-surface px-3 py-2.5', done || card.state === 'failed' ? 'tone-soft border-transparent' : 'border-line', card.state === 'replaced' && 'opacity-60')}>
      <p className="text-meta font-semibold text-fg-muted">{CARD_WORDS[card.tool][done ? 1 : 0]}</p>
      {waiting && args && editable ? (
        <div className="mt-1 flex flex-col gap-1.5">
          <input value={shownTitle} onChange={e => setTitle(e.target.value.slice(0, card.tool === 'add_task' ? 200 : 120))} aria-label="Title" className="input" />
          <DateInput compact value={shownDate} onChange={setDate} aria-label={card.tool === 'add_task' ? 'Due date' : 'Date'} placeholder={card.tool === 'add_task' ? 'No due date' : undefined} />
        </div>
      ) : null}
      {args ? (
        <dl className="mt-1.5 grid grid-cols-[minmax(5.5rem,auto)_1fr] gap-x-3 gap-y-0.5 text-meta">
          {fields.filter(f => !(waiting && editable && (f.label === 'Title' || f.label === 'Due date' || f.label === 'Date'))).map(f => (
            <div key={f.label} className="contents"><dt className="text-fg-muted">{f.label}</dt><dd className="min-w-0 break-words text-fg">{f.value}</dd></div>
          ))}
        </dl>
      ) : (
        <p className="mt-0.5 flex items-center gap-1.5 break-words text-meta text-fg-muted"><Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />Reading what would be saved…</p>
      )}
      {waiting && args && (
        <div className="mt-2 flex gap-2">
          <Button variant="primary" size="sm" icon={<Check />} onClick={confirm} disabled={editable && (!shownTitle.trim() || (card.tool === 'log_food' && !shownDate))}>Confirm</Button>
          <Button size="sm" icon={<X />} onClick={() => onDecide(card.id, 'cancel')}>Cancel</Button>
        </div>
      )}
      {!waiting && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <p className={cx('flex items-center gap-1.5 text-meta', done || card.state === 'failed' ? 'tone-text' : 'text-fg-muted')}>
            {card.state === 'busy' && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />}{card.state === 'undone' ? (isChangeTool(card.tool) ? 'Put back' : 'Removed') : cardStateLabel(card.state)}
          </p>
          {done && card.resultId && <Button size="sm" onClick={open}>Open</Button>}
          {done && card.resultId && <Button size="sm" onClick={() => onUndo(card.id)}>Undo</Button>}
        </div>
      )}
    </div>
  )
}

/** The one quiet line under an answer that noted an idea: what it could be, and where to read it. Never the idea's own text. */
function SuggestionLine({ kind }: { kind: string }) {
  const navigate = useNavigate()
  const closeAI = useUIStore(s => s.closeAI)
  const line = SUGGESTION_LINE[kind as SuggestionKind]
  if (!line) return null
  const go = () => { closeAI(); navigate('/developer?tab=ai&view=learn&learn=suggestions') }
  return (
    <p className="flex items-center gap-1 px-1 text-micro text-fg-muted">
      <Lightbulb aria-hidden className="h-3 w-3 shrink-0" />
      <span className="min-w-0">{line} — <button type="button" onClick={go} className="font-medium text-accent-600 underline decoration-dotted underline-offset-2 [@media(hover:hover)]:hover:text-accent-700">see Suggestions</button></span>
    </p>
  )
}

function CostLine({ turn }: { turn: ChatTurn }) {
  const navigate = useNavigate()
  const closeAI = useUIStore(s => s.closeAI)
  if (turn.costUsd === null || turn.costUsd <= 0) return null
  const text = formatUsd(turn.costUsd)
  if (!turn.runId) return <p className="px-1 text-micro tabular-nums text-fg-faint">{text}</p>
  const go = () => { closeAI(); navigate(`/developer?tab=ai&view=calls&run=${turn.runId}`) }
  return <button type="button" onClick={go} aria-label={`Cost ${text}: see this answer's calls in Developer`} className="px-1 py-0.5 text-micro tabular-nums text-fg-faint underline decoration-dotted underline-offset-2 [@media(hover:hover)]:hover:text-fg-2">{text}</button>
}

export function ChatTurnView({ turn, onDecide, onUndo, onReport, reportOff }: { turn: ChatTurn; onDecide: Decide; onUndo: (id: string) => void; onReport: (answerKey: string) => void; reportOff: boolean }) {
  const [reasoning, setReasoning] = useState(false)
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="flex min-w-0 max-w-[85%] flex-col items-end gap-1">
          {turn.photoUrls.length > 0 && <div className="flex gap-1.5">{turn.photoUrls.map((url, i) => <img key={i} src={url} alt={`Photo ${i + 1} of ${turn.photos}`} className="h-20 w-20 rounded-row border border-line object-cover" />)}</div>}
          {turn.photos > 0 && turn.photoUrls.length < turn.photos && <span className="inline-flex items-center gap-1 text-meta text-fg-muted"><ImageIcon className="h-3.5 w-3.5" aria-hidden />{turn.photos === 1 ? '1 photo' : `${turn.photos} photos`}</span>}
          {/* The Copy icon sits beside the bubble, on its last line: no extra line under every message. */}
          <div className="flex min-w-0 max-w-full items-end gap-1">
            {turn.text && <CopyButton text={messageCopyText(turn)} label="Copy this message" />}
            <p className="min-w-0 select-text whitespace-pre-wrap break-words rounded-card rounded-br-md bg-accent-500 px-3.5 py-2 text-body text-on-accent [overflow-wrap:anywhere]">{turn.text}</p>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="flex justify-start">
      <div className="flex min-w-0 max-w-[92%] flex-col items-start gap-1.5">
        {turn.steps.length > 0 && <Steps steps={turn.steps} streaming={turn.streaming} />}
        {turn.text ? (
          <p className="max-w-full select-text whitespace-pre-wrap break-words rounded-card rounded-bl-md bg-surface-2 px-3.5 py-2 text-body leading-relaxed text-fg [overflow-wrap:anywhere]"><Bold text={turn.text} /></p>
        ) : turn.streaming && !turn.error ? (
          <div role="status" aria-label="Thinking" className="rounded-card rounded-bl-md bg-surface-2 px-4 py-3">
            <span className="flex items-center gap-1">
              {[0, 150, 300].map(d => <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-fg-faint motion-reduce:animate-none" style={{ animationDelay: `${d}ms` }} />)}
            </span>
          </div>
        ) : null}
        {turn.error && (
          <p data-tone="danger" className="tone-soft tone-text select-text break-words rounded-row px-3 py-2 text-body">{turn.error}</p>
        )}
        {turn.citations.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Where this came from">
            {turn.citations.map(c => <CitationLink key={`${c.kind}${c.id}`} citation={c} />)}
          </div>
        )}
        {turn.cards.map(card => <ProposalCard key={card.id} card={card} onDecide={onDecide} onUndo={onUndo} />)}
        {!turn.streaming && turn.cutOff && <p className="px-1 text-meta text-fg-muted">The answer was cut off. Ask for a shorter one.</p>}
        {!turn.streaming && turn.thinking && (
          <div className="px-1">
            <button type="button" onClick={() => setReasoning(r => !r)} aria-expanded={reasoning} className="inline-flex items-center gap-0.5 text-micro font-semibold text-accent-600 hover:text-accent-700">
              <ChevronRight className={cx('h-3 w-3 transition-transform', reasoning && 'rotate-90')} aria-hidden />How it reasoned
            </button>
            {reasoning && <p className="mt-1 whitespace-pre-wrap break-words rounded-control border border-line bg-surface-2 px-2.5 py-1.5 text-meta text-fg-2">{turn.thinking}</p>}
          </div>
        )}
        {!turn.streaming && turn.suggestion && <SuggestionLine kind={turn.suggestion} />}
        {!turn.streaming && (
          <div className="flex items-center gap-0.5">
            <CostLine turn={turn} />
            {(turn.text || turn.error) && <CopyButton text={messageCopyText(turn)} label="Copy this answer" />}
            <ReportButton label="Report this answer (a Dev Request draft)" onClick={() => onReport(turn.key)} disabled={reportOff} />
          </div>
        )}
      </div>
    </div>
  )
}
