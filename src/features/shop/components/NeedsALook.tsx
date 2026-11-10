import { useState } from 'react'
import { Check, ChevronDown, ChevronRight, Hourglass, ListChecks, RotateCcw, ShieldAlert, Tag, Target, TrendingDown, type LucideIcon } from 'lucide-react'
import { Button, Card, CardHeader, KeepRoom, MetaLine, Skeleton, Truncate, cx, useBoardStep } from '../../../shared/ui'
import { ModalShell } from '../../../shared/modals'
import { lookLine, type Look, type LookKind } from '../shopSuggestions'

// "Needs a look" (phase 2 prototype): on a wide page a card in the right rail
// (owner, 14.10.2026: where Coming up sits on Owned), on a phone one line that
// opens the whole list in a sheet (owner, 09.11.2026: the phone's first screen
// is the things themselves).

const ICON: Record<LookKind, LucideIcon> = {
  return: RotateCcw, cheaper: TrendingDown, at_target: Target, complaint: ShieldAlert, value: Tag, wish: Hourglass, tidy: ListChecks,
}
/** The rail shows this many rows, then "N more". */
const SHOWN = 3

export interface LookActions {
  /** Open the thing (an old "Could sell for": at that fact). */
  onOpen: (look: Look) => void
  onBought: (look: Look) => void
}

/** Its state: still loading, a read that failed (one line with Try again — never an answer), or the rows. */
interface LookState { looks: readonly Look[]; loading: boolean; failed: boolean; onRetry: () => void }

/** A failed read: one compact line, never "nothing needs a look". */
function LookFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <span className="text-body text-fg-muted">
      Couldn't load what needs a look.{' '}
      <button type="button" onClick={onRetry} className="font-semibold text-accent-600 hover:underline">Try again</button>
    </span>
  )
}

/** The kind's icon on its tone: the icon and the words say it, never the colour alone. */
function LookIcon({ look, small = false }: { look: Look; small?: boolean }) {
  const Icon = ICON[look.kind]
  return (
    <span data-tone={look.tone} className={cx('tone-soft grid shrink-0 place-items-center rounded-full', small ? 'h-6 w-6' : 'mt-0.5 h-7 w-7')}>
      <Icon aria-hidden className={cx('tone-text', small ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
    </span>
  )
}

/** One row: what, what is due and the money involved, and its one action. */
function LookRow({ look, onOpen, onBought }: { look: Look } & LookActions) {
  const text = (
    <>
      <LookIcon look={look} />
      <span className="min-w-0 flex-1">
        <Truncate as="span" className="block text-body font-medium text-fg">{look.title}</Truncate>
        <MetaLine as="span" className="block text-meta tabular-nums text-fg-muted"
          items={[...look.facts, look.where && <span key="w" className="whitespace-normal break-words">{look.where}</span>]} />
      </span>
    </>
  )
  const row = 'flex items-start gap-2.5 rounded-row px-2 py-2 text-left transition-colors hover:bg-surface-hover'
  if (look.action === 'bought') {
    return (
      <li className="flex items-center gap-1">
        <button type="button" onClick={() => onOpen(look)} className={cx(row, 'min-w-0 flex-1')}>{text}</button>
        <Button size="sm" variant="ghost" icon={<Check />} onClick={() => onBought(look)} className="shrink-0">Bought</Button>
      </li>
    )
  }
  return (
    <li>
      <button type="button" onClick={() => onOpen(look)} className={cx(row, 'w-full')}>
        {text}
        <span className="mt-0.5 flex shrink-0 items-center gap-0.5 text-meta font-semibold text-accent-600">
          {look.action === 'value' ? 'Update' : 'Open'}<ChevronRight aria-hidden className="h-3.5 w-3.5" />
        </span>
      </button>
    </li>
  )
}

/** The rows, every one or the first `limit` and "N more" (in place). */
function LookList({ looks, limit, ...actions }: { looks: readonly Look[]; limit?: number } & LookActions) {
  const [all, setAll] = useState(false)
  const cut = limit != null && looks.length > limit
  const shown = cut && !all ? looks.slice(0, limit) : looks
  return (
    <>
      <ul className="-mx-2 flex flex-col">{shown.map(l => <LookRow key={l.key} look={l} {...actions} />)}</ul>
      {cut && (
        <button type="button" aria-expanded={all} onClick={() => setAll(a => !a)}
          className="mt-1 flex min-h-[36px] items-center gap-1 text-meta font-semibold text-accent-600 hover:underline">
          <ChevronDown aria-hidden className={cx('h-4 w-4 transition-transform', all && 'rotate-180')} />
          {all ? 'Show fewer' : `${looks.length - (limit as number)} more`}
        </button>
      )}
    </>
  )
}

/** The rows' loading copy, at their geometry. */
function LookSkeleton({ rows }: { rows: number }) {
  return (
    <ul aria-hidden className="flex flex-col">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-start gap-2.5 py-2">
          <Skeleton rounded="rounded-full" className="mt-0.5 h-7 w-7 shrink-0" />
          <span className="flex flex-1 flex-col gap-1.5 pt-0.5"><Skeleton className="h-3.5 w-3/5" /><Skeleton className="h-3 w-4/5" /></span>
        </li>
      ))}
    </ul>
  )
}

/** The rail's card: three rows, then "N more"; its room is kept while it loads. */
export function NeedsALookPanel({ looks, loading, failed, onRetry, ...actions }: LookState & LookActions) {
  return (
    <Card>
      <CardHeader title="Needs a look" variant="label" className="mb-1"
        action={!loading && !failed && looks.length > 0 ? <span className="count-badge">{looks.length}</span> : undefined} />
      <KeepRoom ids="shop:look" loading={loading} remember={!failed} skeleton={<LookSkeleton rows={SHOWN} />}>
        {failed
          ? <p className="py-1"><LookFailed onRetry={onRetry} /></p>
          : looks.length
            ? <LookList looks={looks} limit={SHOWN} {...actions} />
            : <p className="py-1 text-body text-fg-muted">Nothing needs a look. A price at your target, a return window or complaint right closing and an old estimate show here.</p>}
      </KeepRoom>
    </Card>
  )
}

/**
 * The phone's one line — "9 need a look · 500 NOK to claim ›" — in the most
 * urgent row's tone; it opens every row in a sheet. One line in every outcome,
 * loading included, so nothing under it moves.
 */
export function NeedsALookLine({ looks, loading, failed, onRetry, ...actions }: LookState & LookActions) {
  const [open, setOpen] = useState(false)
  if (loading) return <Skeleton rounded="rounded-row" className="h-11 w-full" />
  if (failed) return <p className="flex h-11 items-center rounded-row border border-line bg-surface px-3"><LookFailed onRetry={onRetry} /></p>
  const line = lookLine(looks)
  if (!line.count) {
    return (
      <p className="flex h-11 items-center gap-2 rounded-row border border-line bg-surface px-3 text-body text-fg-muted">
        <Check aria-hidden className="h-4 w-4 shrink-0" /> {line.words}
      </p>
    )
  }
  const words = line.claim ? `${line.words} · ${line.claim}` : line.words
  return (
    <>
      <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}
        className="flex h-11 w-full items-center gap-2.5 rounded-row border border-line bg-surface px-3 text-left shadow-card">
        <LookIcon look={looks[0]} small />
        <Truncate as="span" fullText={words} className="min-w-0 flex-1 text-body tabular-nums text-fg-2">
          <span className="font-semibold text-fg">{line.words}</span>{line.claim && ` · ${line.claim}`}
        </Truncate>
        <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-fg-muted" />
      </button>
      <ModalShell open={open} onClose={() => setOpen(false)} title="Needs a look"
        subtitle={`${looks.length} thing${looks.length === 1 ? '' : 's'}${line.claim ? ` · ${line.claim}` : ''}`}>
        <LookList looks={looks} {...actions} />
      </ModalShell>
    </>
  )
}

/** The line on a phone (one stack), the rail's card on a wide page. */
export function NeedsALook(props: LookState & LookActions) {
  return useBoardStep() === 1 ? <NeedsALookLine {...props} /> : <NeedsALookPanel {...props} />
}
