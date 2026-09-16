import {
  compareFields, compareIdentity, comparableAgreement, displayValue, systemOf,
  type StudioGame, type FillableField, type FieldComparison,
} from '../../screenscraperStudio'
import { systemMeta } from '../../systemMeta'

// Two columns, tight. Yours on the left, theirs on the right, one line per
// field, and a glyph in the middle that says what to think about it.
//
// The first version gave every row four lines of vertical space and repeated
// the field name on both sides, so a twelve-field comparison filled a screen
// and most of it was empty. This is the same information in a row each:
// label, value, mark, value.

const VERDICT = {
  match:       { glyph: '✅', cls: 'bg-green-50/60 dark:bg-green-950/15', hint: 'Both say the same' },
  differs:     { glyph: '❌', cls: 'bg-red-50/60 dark:bg-red-950/20',     hint: 'You have something different' },
  only_theirs: { glyph: '🆕', cls: 'bg-accent-50/50',                     hint: 'They can fill this gap' },
  only_mine:   { glyph: '🔒', cls: '',                                    hint: 'Only you have this — nothing changes' },
  both_empty:  { glyph: '⬜', cls: '',                                    hint: 'Neither side has it' },
} as const

function Row({ r, accepted, onToggleField }: {
  r: FieldComparison
  accepted?: FillableField[] | null
  onToggleField?: (f: FillableField) => void
}) {
  const v = VERDICT[r.verdict]
  // Only a gap they can fill is writable: a field you already have is never
  // overwritten, so a tick there would be a lie.
  const writable = !!r.field && r.verdict === 'only_theirs' && !!onToggleField
  const on = !!r.field && (accepted?.includes(r.field) ?? false)

  return (
    <div className={`grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-2 py-1 ${v.cls}`}>
      <span className="min-w-0 text-[11px] leading-snug">
        <span className="text-ink-400">{r.label}: </span>
        <span className="text-ink-700 break-words line-clamp-2">{displayValue(r.mine)}</span>
      </span>

      <span className="flex items-center gap-1 flex-shrink-0" title={v.hint}>
        <span className="text-xs leading-none">{v.glyph}</span>
        {writable && (
          <input type="checkbox" checked={on} onChange={() => onToggleField!(r.field!)}
            title={on ? 'Will be written' : 'Will be skipped'}
            className="w-3.5 h-3.5 accent-current text-accent-500" />
        )}
      </span>

      <span className={`min-w-0 text-[11px] leading-snug text-right break-words line-clamp-2 ${
        r.verdict === 'only_theirs'
          ? (on ? 'text-accent-700 dark:text-accent-400 font-medium' : 'text-ink-400 line-through')
          : 'text-ink-700'
      }`}>{displayValue(r.theirs)}</span>
    </div>
  )
}

export function FieldCompare({ game, candidate, candidateTitle, candidateSystem, accepted, onToggleField }: {
  game: StudioGame | undefined
  candidate: Partial<Record<FillableField, unknown>>
  candidateTitle?: string | null
  candidateSystem?: string | null
  accepted?: FillableField[] | null
  onToggleField?: (f: FillableField) => void
}) {
  const mySystem = game ? systemOf(game) : null
  const identity = compareIdentity(
    { title: game?.title, system: mySystem ? systemMeta(mySystem).label : null },
    { title: candidateTitle, system: candidateSystem },
  )
  const fields = compareFields((game ?? {}) as Partial<Record<FillableField, unknown>>, candidate)
  const rows = [...identity, ...fields]
  const { agree, comparable } = comparableAgreement(rows)
  const gaps = rows.filter(r => r.verdict === 'only_theirs').length
  const clashes = rows.filter(r => r.verdict === 'differs').length

  return (
    <div className="rounded-lg border border-ink-200 overflow-hidden text-ink-700">
      {/* One header line that says the whole verdict. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 bg-ink-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide">
        <span>📁 Yours</span>
        <span className="flex items-center gap-1.5 flex-shrink-0 normal-case tracking-normal">
          {comparable > 0 && (
            <span className={agree === comparable ? 'text-green-600' : agree === 0 ? 'text-red-600' : 'text-amber-600'}>
              ✅{agree}/{comparable}
            </span>
          )}
          {clashes > 0 && <span className="text-red-600">❌{clashes}</span>}
          {gaps > 0 && <span className="text-accent-600">🆕{gaps}</span>}
        </span>
        <span className="text-right">🌐 ScreenScraper</span>
      </div>

      <div className="divide-y divide-ink-100 bg-ink-50/50 font-medium">
        {identity.map(r => <Row key={r.label} r={r} />)}
      </div>
      <div className="divide-y divide-ink-100">
        {fields.map(r => <Row key={r.label} r={r} accepted={accepted} onToggleField={onToggleField} />)}
      </div>
    </div>
  )
}
