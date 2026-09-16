import {
  compareFields, compareIdentity, comparableAgreement, displayValue, systemOf,
  type StudioGame, type FillableField, type FieldComparison,
} from '../../screenscraperStudio'
import { systemMeta } from '../../systemMeta'

// The screen split in two: everything YOU have on the left, everything THEY
// sent on the right, one row per field, each marked agree or disagree.
//
// This is the question a person actually asks of a match — "is this the same
// game as mine?" — and it is not answered by a list of field names, nor by the
// incoming values on their own. Title and platform lead, because they are what
// gets checked first; neither is writable (the title is yours, the platform
// comes from the ROM's own folder), so they carry a mark and no checkbox.

const VERDICT_META = {
  match:       { mark: '✓', cls: 'text-green-600 dark:text-green-400', row: 'bg-green-50/40 dark:bg-green-950/10' },
  differs:     { mark: '✕', cls: 'text-red-600 dark:text-red-400',     row: 'bg-red-50/50 dark:bg-red-950/20' },
  only_theirs: { mark: '＋', cls: 'text-accent-600',                    row: '' },
  only_mine:   { mark: '·', cls: 'text-ink-300',                       row: '' },
  both_empty:  { mark: '·', cls: 'text-ink-200',                       row: '' },
} as const

const VERDICT_TITLE: Record<string, string> = {
  match: 'Both say the same thing',
  differs: 'You already have something different here',
  only_theirs: 'They can fill this gap',
  only_mine: 'Only you have this — nothing will change',
  both_empty: 'Neither side has this',
}

function Row({ r, accepted, onToggleField }: {
  r: FieldComparison
  accepted?: FillableField[] | null
  onToggleField?: (f: FillableField) => void
}) {
  const meta = VERDICT_META[r.verdict]
  // Only a gap they can fill is writable. A field you already have is never
  // overwritten, so offering a tick for it would be a lie.
  const writable = !!r.field && r.verdict === 'only_theirs' && !!onToggleField
  const on = !!r.field && (accepted?.includes(r.field) ?? false)

  return (
    <div className={`grid grid-cols-[1fr_auto_1fr] items-start gap-2 px-2 py-1.5 ${meta.row}`}>
      <span className="min-w-0">
        <span className="block text-[9px] text-ink-400 uppercase tracking-wide">{r.label}</span>
        <span className="block text-[11px] text-ink-700 break-words line-clamp-4">{displayValue(r.mine)}</span>
      </span>
      <span className="pt-3 flex items-center gap-1 flex-shrink-0">
        <span className={`text-sm font-bold ${meta.cls}`} title={VERDICT_TITLE[r.verdict]}>{meta.mark}</span>
        {writable && (
          <input type="checkbox" checked={on} onChange={() => onToggleField!(r.field!)}
            title={on ? 'Will be written' : 'Will be skipped'}
            className="w-4 h-4 accent-current text-accent-500" />
        )}
      </span>
      <span className="min-w-0 text-right">
        <span className="block text-[9px] text-ink-400 uppercase tracking-wide">{r.label}</span>
        <span className={`block text-[11px] break-words line-clamp-4 ${
          r.verdict === 'only_theirs'
            ? (on ? 'text-accent-700 dark:text-accent-400 font-medium' : 'text-ink-400 line-through')
            : 'text-ink-700'
        }`}>{displayValue(r.theirs)}</span>
      </span>
    </div>
  )
}

export function FieldCompare({ game, candidate, candidateTitle, candidateSystem, accepted, onToggleField }: {
  game: StudioGame | undefined
  candidate: Partial<Record<FillableField, unknown>>
  candidateTitle?: string | null
  candidateSystem?: string | null
  /** Which fields are ticked for writing. Omit to render read-only. */
  accepted?: FillableField[] | null
  onToggleField?: (f: FillableField) => void
}) {
  const mySystem = game ? systemOf(game) : null
  const identity = compareIdentity(
    { title: game?.title, system: mySystem ? systemMeta(mySystem).label : null },
    { title: candidateTitle, system: candidateSystem },
  )
  const fields = compareFields(
    (game ?? {}) as Partial<Record<FillableField, unknown>>,
    candidate,
  )
  const { agree, comparable } = comparableAgreement([...identity, ...fields])

  return (
    <div className="rounded-lg border border-ink-200 overflow-hidden">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center text-[10px] font-bold uppercase tracking-wide bg-ink-100 px-2 py-1.5">
        <span className="text-ink-600">Yours</span>
        <span className="px-2">
          {comparable > 0
            ? <span className={agree === comparable ? 'text-green-600' : agree === 0 ? 'text-red-600' : 'text-amber-600'}>
                {agree}/{comparable} agree
              </span>
            : <span className="text-ink-400">nothing to compare</span>}
        </span>
        <span className="text-right text-ink-600">ScreenScraper</span>
      </div>

      <div className="divide-y divide-ink-100 bg-ink-50/40">
        {identity.map(r => <Row key={r.label} r={r} />)}
      </div>
      <div className="divide-y divide-ink-100">
        {fields.map(r => <Row key={r.label} r={r} accepted={accepted} onToggleField={onToggleField} />)}
      </div>
    </div>
  )
}
