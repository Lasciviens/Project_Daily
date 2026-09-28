import type { ReactNode } from 'react'
import { TonePill } from '../../../shared/ui'
import { todayStr } from '../../../shared/utils/dateUtils'
import { spanLabel } from '../healthDateLabels'
import { ENERGY_DENSITY_KCAL_PER_KG, type EnergyReport, type Phase } from './energyBalance'
import { CONFIDENCE_COPY, OTHER_SCREENS_NOTE, balanceWord, kcal, leftOutLine, reasonCopy, signed, verdictCopy } from './goalCopy'

const Num = ({ children }: { children: ReactNode }) => <strong className="tabular-nums text-fg">{children}</strong>

/** How the logged deficit is worked out — the window, the days used, burned
 *  vs logged — and what the scale says on its own. Shown with or without a
 *  verdict, so the number is never a black box. */
function HowItsWorkedOut({ r, from, to }: { r: EnergyReport; from: string; to: string }) {
  const p = r.paired
  // Running text keeps the en-GB day-month style ("31 Aug – 27 Sep"); the
  // numeric dd.mm form is only the owner's format for the date bar itself.
  const window = `${spanLabel(from, to, todayStr())} (${r.days} days, today left out)`
  if (!p.days || p.deficit == null) {
    return <p className="text-body text-fg-2">{window}: no day has both a full food diary and a complete Apple day yet, so there is nothing to compare.</p>
  }
  const word = balanceWord(p.deficit)
  return (
    <>
      <p className="text-body text-fg-2">
        {window}. On the <Num>{p.days}</Num> {p.days === 1 ? 'day' : 'days'} with both a full food diary and a complete Apple day,
        Apple says you burned <Num>{kcal(p.meanBurn)} kcal</Num> a day and you logged <Num>{kcal(p.meanIntake)}</Num> —
        a {word} of <Num>{kcal(Math.abs(p.deficit))} kcal/day</Num>
        {r.expectedChangeKg != null && <>, which predicts <Num>{signed(r.expectedChangeKg, 1, ' kg')}</Num> over {r.days} days</>}.
      </p>
      {r.recent7 && r.recent7.days > 0 && r.recent7.deficit != null && (
        <p className="text-meta text-fg-muted">
          The last 7 of these days alone: burned <span className="tabular-nums">{kcal(r.recent7.meanBurn)}</span>, logged{' '}
          <span className="tabular-nums">{kcal(r.recent7.meanIntake)}</span> — a {balanceWord(r.recent7.deficit)} of{' '}
          <span className="tabular-nums">{kcal(Math.abs(r.recent7.deficit))} kcal/day</span>
          {r.recent7.days < 7 && ` (${r.recent7.days} usable days)`}. A longer window evens out one hard week or a big weekend.
        </p>
      )}
      {r.weight.changeKg != null && r.scaleDeficit != null && (
        <p className="text-body text-fg-2">
          Your weight trend moved <Num>{signed(r.weight.changeKg, 1, ' kg')}</Num>, which stands for a {balanceWord(r.scaleDeficit)} of
          about <Num>{kcal(Math.abs(r.scaleDeficit))} kcal/day</Num> — the scale&apos;s own answer, whatever the diary and Apple say.
        </p>
      )}
    </>
  )
}

/** Does the scale agree with diary − Apple? With the numbers behind it, the
 *  likely reason and how much the window can support. */
export function EnergyVerdict({ r, phase, from, to }: { r: EnergyReport; phase: Phase; from: string; to: string }) {
  const notes = (
    <div className="flex flex-col gap-1 text-meta text-fg-muted">
      <p>{leftOutLine(r.paired)}</p>
      <p>{OTHER_SCREENS_NOTE}</p>
    </div>
  )
  if (!r.verdict) {
    return (
      <div className="flex flex-col gap-2 rounded-row border border-line bg-surface-2 p-3">
        <HowItsWorkedOut r={r} from={from} to={to} />
        <div>
          <p className="text-body font-semibold text-fg">Not enough data to compare calories with the scale yet</p>
          <ul className="mt-1 list-disc pl-5 text-meta text-fg-muted">
            {r.missing.map(m => <li key={m}>{m}</li>)}
          </ul>
        </div>
        {notes}
      </div>
    )
  }
  const v = verdictCopy(r.verdict, phase)
  const c = r.confidence ? CONFIDENCE_COPY[r.confidence] : null
  const perWeekGap = r.tdeeGap != null ? Math.abs(r.tdeeGap) * 7 / ENERGY_DENSITY_KCAL_PER_KG : null
  return (
    <div className="flex flex-col gap-2 rounded-row border border-line bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <TonePill tone={v.tone}>{v.title}</TonePill>
        {c && <TonePill tone={c.tone}>{c.label}</TonePill>}
      </div>
      <HowItsWorkedOut r={r} from={from} to={to} />
      {r.verdict !== 'on_track' && r.tdeeGap != null && perWeekGap != null && (
        <p className="text-body text-fg-2">
          The two differ by about <Num>{kcal(Math.abs(r.tdeeGap))} kcal/day</Num> (≈{perWeekGap.toFixed(2)} kg a week).
        </p>
      )}
      {r.reasons.length > 0 && (
        <ul className="flex flex-col gap-1 text-meta text-fg-2">
          {r.reasons.slice(0, 3).map(k => <li key={k}>• {reasonCopy(k, phase)}</li>)}
        </ul>
      )}
      {r.confidenceNotes.length > 0 && (
        <p className="text-meta text-fg-muted">{r.confidenceNotes.join(' ')}</p>
      )}
      {notes}
    </div>
  )
}
