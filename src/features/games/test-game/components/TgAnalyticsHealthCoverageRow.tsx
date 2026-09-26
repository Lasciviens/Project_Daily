import { CircleCheck, ListChecks, Wand2 } from 'lucide-react'
import type { TgaCoverageField } from './tgAnalyticsHealth'
import { TGA_ROW_H, fmtInt } from './tgAnalyticsFormat'
import { coverageFix, coveragePct, type TgaFixAction } from './tgAnalyticsHealthCopy'
import { openNeedsReview, openScrapeBatch } from './tgAnalyticsNav'
import { TgAnalyticsHealthMeter } from './TgAnalyticsHealthMeter'

const run = (fix: TgaFixAction) => (fix.kind === 'review' ? openNeedsReview() : openScrapeBatch(fix.filter))

// One markup, two shapes, by the row's own width (the <li> is a container, so
// a row in a two-column list adapts like one in a narrow card): narrow, the
// name and figures sit over a full-width bar; from 28rem it is one line whose
// fixed-width columns line the bars up across rows.
const GRID = [
  '-mx-2 grid w-[calc(100%+1rem)] grid-cols-[minmax(0,1fr)_auto_1.25rem] items-center gap-x-3 gap-y-1.5 rounded-[10px] px-2 py-1.5 text-left',
  '@[28rem]/hrow:grid-cols-[minmax(6.5rem,10.5rem)_minmax(0,1fr)_minmax(7.75rem,auto)_1.25rem] @[28rem]/hrow:gap-y-0 @[28rem]/hrow:py-1',
  '@[32rem]/hrow:grid-cols-[minmax(6.5rem,10.5rem)_minmax(0,1fr)_minmax(7.75rem,auto)_4.5rem]',
  TGA_ROW_H,
].join(' ')
const LABEL = 'col-start-1 row-start-1 min-w-0 truncate text-[13px] font-medium text-[var(--tg-text)]'
const VALUE = 'col-start-2 row-start-1 whitespace-nowrap text-right text-[12.5px] tabular-nums @[28rem]/hrow:col-start-3'
const BAR = 'col-span-2 col-start-1 row-start-2 @[28rem]/hrow:col-span-1 @[28rem]/hrow:col-start-2 @[28rem]/hrow:row-start-1'
const ACT = 'col-start-3 row-span-2 row-start-1 flex items-center justify-end gap-1.5 @[28rem]/hrow:col-start-4 @[28rem]/hrow:row-span-1'
const PRESS = 'group transition-colors [@media(hover:hover)]:hover:bg-[var(--tg-hover)] [@media(hover:none)]:active:bg-[var(--tg-hover)]'

/**
 * One field: how many of the games it applies to have it. A field with a fix
 * is itself the button that opens it; a complete one shows a check.
 */
export function TgAnalyticsHealthCoverageRow({ field, retro }: { field: TgaCoverageField; retro: number }) {
  const { label, filled, total } = field
  const pct = coveragePct(filled, total)
  const fix = coverageFix(field, retro)
  const done = filled >= total
  const Icon = fix?.kind === 'review' ? ListChecks : Wand2

  const body = (
    <>
      <span className={LABEL} title={label}>{label}</span>
      <span className={VALUE}>
        <span className="text-[var(--tg-muted)]">{fmtInt(filled)} of {fmtInt(total)}</span>
        <span className="text-[var(--tg-faint)]"> · </span>
        <span className="font-semibold text-[var(--tg-text)]">{pct}</span>
      </span>
      <span className={BAR}><TgAnalyticsHealthMeter value={filled} max={total} track /></span>
      <span className={ACT}>
        {done ? (
          <>
            <CircleCheck size={15} strokeWidth={2.2} aria-hidden className="text-[var(--tg-green)]" />
            <span className="sr-only">Complete</span>
          </>
        ) : fix ? (
          <span className="flex items-center gap-1.5 text-[var(--tg-accent)]">
            <Icon size={14} strokeWidth={2.1} aria-hidden />
            <span className="hidden text-[12px] font-semibold @[32rem]/hrow:inline">{fix.short}</span>
          </span>
        ) : null}
      </span>
    </>
  )

  return (
    <li className="@container/hrow min-w-0">
      {fix ? (
        <button
          type="button"
          onClick={() => run(fix)}
          title={fix.name}
          aria-label={`${fix.name}. ${label}: ${fmtInt(filled)} of ${fmtInt(total)} filled, ${pct}`}
          className={`${GRID} ${PRESS}`}
        >
          {body}
        </button>
      ) : (
        <div className={GRID}>{body}</div>
      )}
    </li>
  )
}
