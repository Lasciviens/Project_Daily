import { InfoBubble } from '../../../shared/components/InfoBubble'
import { TonePill, type Tone } from '../../../shared/ui'
import { displayChange, displayUsual, displayValue, type VitalRow } from '../vitalsReading'
import { fmtDayMonth } from './healthFormat'

// The stats of "What your numbers say": one row per signal — value · your
// usual · status · change — and the sentence saying what it means. A table
// when the card is wide enough (container query), stacked rows on a phone.

const TONE: Record<VitalRow['signal'], Tone> = {
  'in-range': 'success', good: 'success', concern: 'warn', neutral: 'neutral', unknown: 'neutral',
}

function statusText(row: VitalRow): string {
  if (row.status === 'unknown') {
    return row.reason === 'no-reading' ? 'No reading' : row.reason === 'few-readings' ? 'Too few readings' : 'Building your usual'
  }
  if (row.referenceKind === 'population') return row.status === 'inside' ? 'Typical' : 'Slower than typical'
  if (row.status === 'inside') return 'In your usual range'
  return row.status === 'above' ? 'Above your usual' : 'Below your usual'
}

/** Where the value comes from: "7-day average", "from 26 Sep", "average of 6 days". */
function basisText(row: VitalRow, to: string): string | null {
  if (row.value == null) return null
  if (row.basis === 'smoothed') return '7-day average'
  if (row.basis === 'latest') return row.valueDate ? `latest, ${fmtDayMonth(row.valueDate)}` : 'latest'
  if (row.basis === 'period') {
    // Heart-rate recovery is one reading per workout, not per day.
    const noun = row.spec.lookbackDays ? 'workout' : 'day'
    if (row.readings === 1 && row.valueDate) return `1 ${noun}, ${fmtDayMonth(row.valueDate)}`
    return `average of ${row.readings} ${noun}s`
  }
  return row.valueDate && row.valueDate !== to ? `from ${fmtDayMonth(row.valueDate)}` : null
}

function changeText(row: VitalRow): string | null {
  if (row.deltaVsPrevious == null) return null
  return `${displayChange(row.deltaVsPrevious, row.spec)} ${row.previousLabel}`
}

/** "above on 2 of 7 days", "above on 2, below on 1 of 7 days". */
function daysOff(row: VitalRow): string | null {
  if (row.daysChecked == null || !row.daysChecked) return null
  const parts: string[] = []
  if (row.daysAbove) parts.push(`above on ${row.daysAbove}`)
  if (row.daysBelow) parts.push(`below on ${row.daysBelow}`)
  return parts.length ? `${parts.join(', ')} of ${row.daysChecked} days` : null
}

function Label({ row }: { row: VitalRow }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-semibold text-fg">{row.spec.label}</span>
      <InfoBubble label={`About ${row.spec.label}`}>
        <span className="block">{row.spec.about}</span>
        <span className="mt-1.5 block text-fg-muted">
          {row.referenceKind === 'population' ? 'Reference: ' : 'Your usual: '}{row.spec.rangeRule}.
        </span>
      </InfoBubble>
    </span>
  )
}

function Status({ row }: { row: VitalRow }) {
  const off = daysOff(row)
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <TonePill tone={TONE[row.signal]}>{statusText(row)}</TonePill>
      {off && <span className="text-meta tabular-nums text-fg-muted">{off}</span>}
    </span>
  )
}

export function VitalsReadingRows({ rows, to }: { rows: VitalRow[]; to: string }) {
  return (
    <>
      {/* Phone / narrow card: stacked rows. */}
      <ul className="-my-1 divide-y divide-line @xl:hidden">
        {rows.map(row => {
          const basis = basisText(row, to)
          const change = changeText(row)
          return (
            <li key={row.key} className="flex flex-col gap-1 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-body"><Label row={row} /><Status row={row} /></div>
              <p className="text-meta tabular-nums text-fg-2">
                <span className="font-semibold text-fg">{displayValue(row)}</span>
                {basis && <span className="text-fg-muted"> ({basis})</span>}
                <span className="text-fg-muted"> · {row.referenceKind === 'population' ? 'typical' : 'your usual'} <span className="whitespace-nowrap">{displayUsual(row)}</span></span>
              </p>
              {change && <p className="text-meta tabular-nums text-fg-muted">{change}</p>}
              <p className="text-meta text-fg-muted">{row.meaning}</p>
            </li>
          )
        })}
      </ul>

      {/* Wide card: a real table. */}
      <table className="hidden w-full text-body @xl:table">
        <thead>
          <tr className="border-b border-line text-left">
            <th scope="col" className="section-label py-1.5 pr-3 font-semibold">Signal</th>
            <th scope="col" className="section-label py-1.5 pr-3 font-semibold">Value</th>
            <th scope="col" className="section-label py-1.5 pr-3 font-semibold">Your usual</th>
            <th scope="col" className="section-label py-1.5 pr-3 font-semibold">Status</th>
            <th scope="col" className="section-label py-1.5 font-semibold">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const basis = basisText(row, to)
            return (
              <tr key={row.key} className="border-b border-line align-top last:border-b-0">
                <td className="py-2.5 pr-3">
                  <Label row={row} />
                  <p className="mt-0.5 max-w-[26rem] text-meta text-fg-muted">{row.meaning}</p>
                </td>
                <td className="whitespace-nowrap py-2.5 pr-3 tabular-nums">
                  <span className="font-semibold text-fg">{displayValue(row)}</span>
                  {basis && <span className="block text-meta text-fg-muted">{basis}</span>}
                </td>
                <td className="whitespace-nowrap py-2.5 pr-3 tabular-nums text-fg-2">
                  {displayUsual(row)}
                  {row.referenceKind === 'population' && <span className="block text-meta text-fg-muted">typical</span>}
                </td>
                <td className="py-2.5 pr-3"><Status row={row} /></td>
                <td className="py-2.5 text-meta tabular-nums text-fg-muted">
                  {row.deltaVsPrevious == null ? '—' : (
                    <>
                      <span className="whitespace-nowrap font-semibold text-fg-2">{displayChange(row.deltaVsPrevious, row.spec)}</span>
                      <span className="block whitespace-nowrap">{row.previousLabel}</span>
                    </>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}
