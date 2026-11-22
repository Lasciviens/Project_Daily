import { Check, FileText, ListChecks, Loader2, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useEntityModal } from '../../../shared/modals/useEntityModal'
import { Button, Truncate, cx } from '../../../shared/ui'
import { formatDate } from '../../../shared/utils/dateFormat'
import { formatUsd } from '../claude/ledgerRules'
import { boldParts, cardStateLabel, citationTarget, type ChatCard, type ChatCitation, type ChatTurn } from './chatRules'
import { useUIStore } from '../../../app/store'

// One turn of the chat: the person's message, or the answer with what it looked up, the rows it cites (each a link to the
// owner's own row), the writes it proposes (a card with Confirm and Cancel) and what the answer cost.

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
    <button type="button" onClick={open} className="inline-flex min-h-[32px] max-w-full items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-meta text-fg-2 [@media(hover:hover)]:hover:border-line-strong [@media(hover:hover)]:hover:text-fg [@media(pointer:coarse)]:min-h-[44px]">
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <Truncate as="span" className="min-w-0">{citation.title}{citation.kind === 'task' && citation.day ? ` · ${formatDate(citation.day)}` : ''}</Truncate>
    </button>
  )
}

function ProposalCard({ card, onDecide }: { card: ChatCard; onDecide: (id: string, decision: 'confirm' | 'cancel') => void }) {
  const waiting = card.state === 'pending'
  const label = cardStateLabel(card.state)
  return (
    <div data-tone={card.state === 'confirmed' ? 'success' : card.state === 'failed' ? 'danger' : undefined} className={cx('w-full rounded-card border bg-surface px-3 py-2.5', card.state === 'confirmed' || card.state === 'failed' ? 'tone-soft border-transparent' : 'border-line')}>
      <p className="text-meta font-semibold text-fg-muted">{card.tool === 'add_task' ? 'Proposed task' : 'Proposed food line'}</p>
      <p className="mt-0.5 break-words text-body text-fg">{card.summary}</p>
      {waiting ? (
        <div className="mt-2 flex gap-2">
          <Button variant="primary" size="sm" icon={<Check />} onClick={() => onDecide(card.id, 'confirm')}>Confirm</Button>
          <Button size="sm" icon={<X />} onClick={() => onDecide(card.id, 'cancel')}>Cancel</Button>
        </div>
      ) : (
        <p className={cx('mt-1 flex items-center gap-1.5 text-meta', card.state === 'confirmed' || card.state === 'failed' ? 'tone-text' : 'text-fg-muted')}>
          {card.state === 'busy' && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />}{label}
        </p>
      )}
    </div>
  )
}

export function ChatTurnView({ turn, onDecide }: { turn: ChatTurn; onDecide: (id: string, decision: 'confirm' | 'cancel') => void }) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-card rounded-br-md bg-accent-500 px-3.5 py-2 text-body text-on-accent">{turn.text}</p>
      </div>
    )
  }
  const lookingUp = turn.streaming && turn.steps.length > 0 ? turn.steps[turn.steps.length - 1] : null
  return (
    <div className="flex justify-start">
      <div className="flex min-w-0 max-w-[92%] flex-col items-start gap-1.5">
        {turn.steps.length > 0 && (
          <p className="flex items-start gap-1.5 px-1 text-meta text-fg-muted" role={turn.streaming ? 'status' : undefined}>
            {lookingUp ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden /> : <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
            <span className="min-w-0">{lookingUp ?? turn.steps.join(' · ')}</span>
          </p>
        )}
        {turn.text ? (
          <p className="whitespace-pre-wrap break-words rounded-card rounded-bl-md bg-surface-2 px-3.5 py-2 text-body leading-relaxed text-fg"><Bold text={turn.text} /></p>
        ) : turn.streaming && !turn.error ? (
          <div role="status" aria-label="Thinking" className="rounded-card rounded-bl-md bg-surface-2 px-4 py-3">
            <span className="flex items-center gap-1">
              {[0, 150, 300].map(d => <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-fg-faint motion-reduce:animate-none" style={{ animationDelay: `${d}ms` }} />)}
            </span>
          </div>
        ) : null}
        {turn.error && (
          <p data-tone="danger" className="tone-soft tone-text rounded-row px-3 py-2 text-body">{turn.error}</p>
        )}
        {turn.citations.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Where this came from">
            {turn.citations.map(c => <CitationLink key={`${c.kind}${c.id}`} citation={c} />)}
          </div>
        )}
        {turn.cards.map(card => <ProposalCard key={card.id} card={card} onDecide={onDecide} />)}
        {!turn.streaming && turn.cutOff && <p className="px-1 text-meta text-fg-muted">The answer was cut off. Ask for a shorter one.</p>}
        {!turn.streaming && turn.costUsd !== null && turn.costUsd > 0 && (
          <p className="px-1 text-micro tabular-nums text-fg-faint">{formatUsd(turn.costUsd)}</p>
        )}
      </div>
    </div>
  )
}
