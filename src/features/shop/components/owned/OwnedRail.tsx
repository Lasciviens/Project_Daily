import type { KeyboardEvent } from 'react'
import { ChevronRight } from 'lucide-react'
import { MetaLine } from '../../../../shared/ui'
import { complete, minus, type OwnedShow, type ShownSummary } from '../../ownModel'
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
