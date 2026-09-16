import { compareFields, comparableAgreement, displayValue, type StudioGame } from '../../screenscraperStudio'
import type { FillableField } from '../../screenscraperStudio'

// Mine on the left, theirs on the right, one row per field, each marked agree
// or disagree.
//
// This is the question a person actually asks of a match — "is this the same
// game as mine?" — and it is not answered by a list of field NAMES, nor by the
// incoming values alone. Both columns, side by side, and a mark per line.

const VERDICT_META = {
  match:       { mark: '✓', cls: 'text-green-600',  row: '' },
  differs:     { mark: '✕', cls: 'text-red-600',    row: 'bg-red-50/50 dark:bg-red-950/20' },
  only_theirs: { mark: '＋', cls: 'text-accent-600', row: '' },
  only_mine:   { mark: '·', cls: 'text-ink-300',    row: '' },
  both_empty:  { mark: '·', cls: 'text-ink-300',    row: '' },
} as const

const VERDICT_TITLE: Record<string, string> = {
  match: 'Both say the same thing',
  differs: 'You already have something different here',
  only_theirs: 'They can fill this gap',
  only_mine: 'Only you have this — nothing will change',
  both_empty: 'Neither side has this',
}

export function FieldCompare({ game, candidate, accepted, onToggleField }: {
  game: StudioGame | undefined
  /** Whatever the other side offers, keyed by our own column names. */
  candidate: Partial<Record<FillableField, unknown>>
  /** Which fields are ticked for writing. Omit to render read-only. */
  accepted?: FillableField[] | null
  onToggleField?: (f: FillableField) => void
}) {
  const rows = compareFields(
    (game ?? {}) as Partial<Record<FillableField, unknown>>,
    candidate as Partial<Record<FillableField, unknown>>,
  )
  const { agree, comparable } = comparableAgreement(rows)

  return (
    <div className="rounded-lg border border-ink-200 overflow-hidden">
      <div className="grid grid-cols-[1fr_auto_1fr] text-[10px] font-semibold text-ink-400 uppercase tracking-wide bg-ink-50 px-2 py-1">
        <span>Yours</span>
        <span className="px-2">
          {comparable > 0
            ? <span className={agree === comparable ? 'text-green-600' : agree === 0 ? 'text-red-600' : 'text-amber-600'}>
                {agree}/{comparable} agree
              </span>
            : 'nothing to compare'}
        </span>
        <span className="text-right">Theirs</span>
      </div>

      <div className="divide-y divide-ink-100">
        {rows.map(r => {
          const meta = VERDICT_META[r.verdict]
          // Only a gap they can fill is writable — a field you already have is
          // never overwritten, so offering a tick for it would be a lie.
          const writable = r.verdict === 'only_theirs' && !!onToggleField
          const on = accepted?.includes(r.field) ?? false
          return (
            <div key={r.field} className={`grid grid-cols-[1fr_auto_1fr] items-start gap-1 px-2 py-1 text-[11px] ${meta.row}`}>
              <span className="min-w-0">
                <span className="block text-[9px] text-ink-400 uppercase tracking-wide">{r.label}</span>
                <span className="block text-ink-600 break-words line-clamp-3">{displayValue(r.mine)}</span>
              </span>
              <span className="px-1 pt-2.5 flex items-center gap-1">
                <span className={`font-bold ${meta.cls}`} title={VERDICT_TITLE[r.verdict]}>{meta.mark}</span>
                {writable && (
                  <input type="checkbox" checked={on} onChange={() => onToggleField!(r.field)}
                    title={on ? 'Will be written' : 'Will be skipped'}
                    className="w-4 h-4 accent-current text-accent-500" />
                )}
              </span>
              <span className="min-w-0 text-right">
                <span className={`block break-words line-clamp-3 ${
                  r.verdict === 'only_theirs' ? (on ? 'text-accent-700 font-medium' : 'text-ink-400 line-through') : 'text-ink-600'
                }`}>{displayValue(r.theirs)}</span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
