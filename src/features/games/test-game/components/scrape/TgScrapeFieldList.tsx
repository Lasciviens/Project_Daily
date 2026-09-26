import { useState } from 'react'
import type { TgGame } from '../../testGameModel'
import type { SsCandidate, SsField, SsLocalized } from '../../../scraper/ssTypes'
import type { MediaMode } from '../../../scraper/ssMediaCatalog'
import { FIELD_MEDIA, sameValue } from '../../../scraper/ssPlan'
import { pickMediaEntry } from '../../../scraper/ssRules'
import { display, type FieldChoice, type FieldRow } from './tgScrapeModel'
import { TgSegmented, TgSsMedia } from './TgScrapeParts'

const LONG = 180

function Value({ v, field, muted, clamp }: { v: unknown; field: SsField; muted?: boolean; clamp?: boolean }) {
  const text = display(v, field)
  const [open, setOpen] = useState(false)
  const long = clamp && text.length > LONG
  return (
    <span className={`block min-w-0 break-words text-[13px] leading-snug ${muted ? 'tg-muted' : 'text-[var(--tg-text)]'}`}>
      {long && !open ? `${text.slice(0, LONG)}…` : text}
      {long && (
        // Inline so the line box keeps its height; the ::after extends the tap target.
        <button type="button" onClick={() => setOpen(o => !o)} className="relative ml-1 inline text-[12px] font-semibold text-[var(--tg-accent)] after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']">
          {open ? 'Less' : 'More'}
        </button>
      )}
    </span>
  )
}

/** Variant chips for the title (regions) or the description (languages). */
function Variants({ list, value, onPick, label }: { list: SsLocalized[]; value: string | null; onPick: (k: string | null) => void; label: string }) {
  if (list.length < 2) return null
  return (
    <div role="radiogroup" aria-label={label} className="mt-1.5 flex flex-wrap gap-1">
      {list.map(v => (
        <button
          key={v.key} type="button" role="radio" aria-checked={value === v.key} title={v.text}
          onClick={() => onPick(value === v.key ? null : v.key)}
          className={`min-h-[30px] min-w-[40px] rounded-md px-2 text-[11px] font-semibold uppercase [@media(pointer:coarse)]:min-h-[44px] ${
            value === v.key ? 'bg-[var(--tg-seg-active-bg,var(--tg-accent-soft))] text-[var(--tg-nav-active-text,var(--tg-accent))] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--tg-accent)_35%,transparent)]' : 'bg-[var(--tg-panel-2)] text-[var(--tg-text-2)]'
          }`}
        >
          {v.key}
        </button>
      ))}
    </div>
  )
}

/** Yours and theirs as pictures — the one decision that is purely visual. */
function ImagePair({ current, candidate, type, token }: { current: unknown; candidate: SsCandidate; type: string; token: string | undefined }) {
  const entry = candidate.media.find(m => m.token === token && m.type === type) ?? pickMediaEntry(candidate.media, type, [])
  const box = 'relative h-[62px] w-[62px] overflow-hidden rounded-lg border border-[var(--tg-border)] bg-[var(--tg-panel-2)]'
  return (
    <div className="mt-1 flex items-center gap-2">
      <span className={box} title="Yours">
        {typeof current === 'string' && current
          ? <img src={current} alt="Yours" loading="lazy" className="h-full w-full object-contain" />
          : <span className="grid h-full place-items-center text-[10.5px] tg-faint">None</span>}
      </span>
      <span aria-hidden className="text-[12px] tg-faint">→</span>
      <TgSsMedia candidate={candidate} entry={entry ?? null} width={200} className={box} alt="Theirs" />
    </div>
  )
}

/**
 * Field by field: the label and its Keep / Fill / Replace on one line, yours
 * and theirs underneath (pictures for image fields). Fill only exists where
 * yours is empty, Replace only where it is not. Identical fields and fields
 * they have nothing for fold into one line each.
 */
export function TgScrapeFieldList({ candidate, rows, choices, onChoice, mediaModeOf, tokens, names, synopses, titleRegion, descLang, onTitleRegion, onDescLang }: {
  game: TgGame
  candidate: SsCandidate
  rows: FieldRow[]
  choices: Partial<Record<SsField, FieldChoice>>
  onChoice: (field: SsField, c: FieldChoice) => void
  mediaModeOf: (type: string) => MediaMode
  tokens: Record<string, string>
  names: SsLocalized[]
  synopses: SsLocalized[]
  titleRegion: string | null
  descLang: string | null
  onTitleRegion: (k: string | null) => void
  onDescLang: (k: string | null) => void
}) {
  const [showSame, setShowSame] = useState(false)
  const [showNothing, setShowNothing] = useState(false)
  const isSame = (r: FieldRow) => !r.isImage && sameValue(r.current, r.theirs)
  const offered = rows.filter(r => !r.theirsEmpty)
  const same = offered.filter(isSame)
  const nothing = rows.filter(r => r.theirsEmpty)
  const shown = [...offered.filter(r => !isSame(r)), ...(showSame ? same : []), ...(showNothing ? nothing : [])]

  return (
    <div className="flex flex-col divide-y divide-[var(--tg-border)]">
      {shown.map(r => {
        const choice = choices[r.field] ?? 'keep'
        const type = FIELD_MEDIA[r.field]
        const rowSame = isSame(r)
        const options: { value: FieldChoice; label: string }[] = [
          { value: 'keep', label: 'Keep' },
          r.currentEmpty ? { value: 'fill', label: 'Fill' } : { value: 'replace', label: 'Replace' },
        ]
        return (
          <div key={r.field} className="py-2.5">
            <div className="flex min-h-[36px] items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[12.5px] font-semibold text-[var(--tg-text)]">
                {r.label}
                {rowSame && <span className="ml-1.5 text-[11px] font-normal tg-faint">same as yours</span>}
              </span>
              {!r.theirsEmpty && !rowSame && (
                <TgSegmented size="sm" label={`${r.label}: what to do`} value={choice} options={options} onChange={c => onChoice(r.field, c)} />
              )}
            </div>
            {r.isImage && type ? (
              <>
                {!r.theirsEmpty && <ImagePair current={r.current} candidate={candidate} type={type} token={tokens[type]} />}
                {!r.theirsEmpty && choice !== 'keep' && mediaModeOf(type) !== 'store' && (
                  <p className="mt-1 text-[11px] tg-faint">Their image is set to Online below — switch it to Copy to use it here.</p>
                )}
              </>
            ) : (
              <div className="mt-0.5 grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-2 gap-y-0.5">
                <span className="text-[11px] uppercase tracking-[0.06em] tg-faint">Yours</span>
                <Value v={r.current} field={r.field} muted clamp />
                <span className="text-[11px] uppercase tracking-[0.06em] tg-faint">Theirs</span>
                <Value v={r.theirs} field={r.field} clamp />
              </div>
            )}
            {r.field === 'title' && <Variants list={names} value={titleRegion} onPick={onTitleRegion} label="Title variant" />}
            {r.field === 'description' && <Variants list={synopses} value={descLang} onPick={onDescLang} label="Description language" />}
          </div>
        )
      })}
      {same.length > 0 && (
        <button type="button" onClick={() => setShowSame(s => !s)} className="min-h-[44px] pt-2 text-left text-[12.5px] leading-snug">
          <span className="tg-muted">Same as yours: {same.map(r => r.label).join(', ')} </span>
          <span className="font-semibold text-[var(--tg-accent)]">{showSame ? 'Hide' : 'Show'}</span>
        </button>
      )}
      {nothing.length > 0 && (
        <button type="button" onClick={() => setShowNothing(s => !s)} className="min-h-[44px] text-left text-[12.5px] leading-snug">
          <span className="tg-muted">They have nothing for: {nothing.map(r => r.label).join(', ')} </span>
          <span className="font-semibold text-[var(--tg-accent)]">{showNothing ? 'Hide' : 'Show'}</span>
        </button>
      )}
    </div>
  )
}
