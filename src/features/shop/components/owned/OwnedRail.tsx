import type { KeyboardEvent } from 'react'
import { ChevronRight } from 'lucide-react'
import { Card, CardHeader, MetaLine, TonePill, Truncate } from '../../../../shared/ui'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { complete, minus, type Deadline, type OwnedShow, type ShownSummary } from '../../ownModel'
import { AmountText } from '../shopKit'
import { money } from '../shopFormat'

const HEAD: Record<OwnedShow, string> = { mine: 'Mine', gone: 'Sold or gone', all: 'Mine and gone' }
const things = (n: number) => `${n} thing${n === 1 ? '' : 's'}`
const accessories = (n: number) => `${n} accessor${n === 1 ? 'y' : 'ies'}`

/**
 * One line above the list that sums up what it shows — the tab and the
 * filters (owner, 09.11.2026: the "What I own" card took a screen and said
 * little): "Mine · 10 things + 4 accessories · paid 39 900 NOK · could sell
 * for 21 400 NOK (6 of 14)"; "Sold or gone · 6 things · paid 19 238 NOK · got
 * back 16 380 NOK · cost you 2 858 NOK". A tap opens Stats on the same
 * things (`onStats`, absent when the list is empty); under Mine, "6 sold or
 * gone" switches the tab.
 */
export function OwnedSummaryLine({ summary, show, filtered, onStats, onShowGone }: {
  summary: ShownSummary
  show: OwnedShow
  filtered: boolean
  onStats?: () => void
  onShowGone: () => void
}) {
  const yours = summary.mine + summary.accessories
  const result = show === 'gone' ? minus(summary.got, summary.paid) : null
  const line = (
    <MetaLine as="span" items={[
      <span key="h" className="font-semibold text-fg">{HEAD[show]}{filtered ? ', filtered' : ''}</span>,
      show === 'gone' ? things(summary.gone)
        : `${things(summary.mine)}${summary.accessories ? ` + ${accessories(summary.accessories)}` : ''}${show === 'all' && summary.gone ? `, ${summary.gone} gone` : ''}`,
      <span key="p">paid <AmountText amount={summary.paid} className="text-fg-2" /></span>,
      show !== 'gone' && (summary.valued
        ? <span key="v">could sell for <AmountText amount={summary.worth} className="text-fg-2" />{summary.valued < yours ? ` (${summary.valued} of ${yours})` : ''}</span>
        : yours > 0 && 'no "Could sell for" yet'),
      show !== 'mine' && summary.gone > 0 && <span key="g">got back <AmountText amount={summary.got} className="text-fg-2" /></span>,
      result && complete(result) && summary.gone > 0 && (Math.round(result.nok) > 0
        ? <span key="r" className="text-success">made {money(result.nok)}</span>
        : <span key="r">cost you {money(-result.nok)}</span>),
    ]} />
  )
  // An inline "button", so the line wraps like text and "6 sold or gone" follows on its last line.
  const open = onStats && ((e: KeyboardEvent<HTMLSpanElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStats() } })
  return (
    <p className="text-meta tabular-nums text-fg-muted">
      {onStats && open
        ? (
          <span role="button" tabIndex={0} onClick={onStats} onKeyDown={open} title="Open these in Stats"
            className="cursor-pointer rounded-sm decoration-line-strong underline-offset-2 hover:underline">
            {line}
            <span className="sr-only"> — open in Stats</span>
            <ChevronRight aria-hidden className="ml-0.5 inline h-3.5 w-3.5 align-[-2px] text-fg-muted" />
          </span>
        )
        : line}
      {show === 'mine' && summary.gone > 0 && <>
        {' · '}
        <button type="button" onClick={onShowGone} className="whitespace-nowrap font-semibold text-accent-600 hover:underline">{summary.gone} sold or gone</button>
      </>}
    </p>
  )
}

/** Return windows (14 days) and complaint rights (60 days) about to end, soonest first. */
export function ComingUpCard({ deadlines, onOpen }: { deadlines: Deadline[]; onOpen: (id: string) => void }) {
  return (
    <Card>
      <CardHeader title="Coming up" variant="label" />
      <ul className="-mx-2 flex flex-col">
        {deadlines.slice(0, 6).map(d => (
          <li key={`${d.item.id}-${d.kind}`}>
            <button type="button" onClick={() => onOpen(d.item.id)} className="flex min-h-[44px] w-full items-center gap-2 rounded-row px-2 text-left hover:bg-surface-hover">
              <span className="min-w-0 flex-1">
                <Truncate as="span" className="block text-body text-fg-2">{d.item.title}</Truncate>
                <span className="block text-meta tabular-nums text-fg-muted">
                  {d.kind === 'return' ? 'Return by' : 'Can complain until'} {formatDate(d.day)}
                </span>
              </span>
              <TonePill tone={d.daysLeft <= 7 ? 'warn' : 'neutral'} className="shrink-0 tabular-nums">
                {d.daysLeft === 0 ? 'Today' : `${d.daysLeft} day${d.daysLeft === 1 ? '' : 's'}`}
              </TonePill>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
