import { useState } from 'react'
import type { SsField, SsLocalized } from '../../../scraper/ssTypes'
import type { MediaMode } from '../../../scraper/ssMediaCatalog'
import { FIELD_MEDIA, sameValue } from '../../../scraper/ssPlan'
import { display, writes, type FieldChoice, type FieldRow } from './tgScrapeModel'
import { TgSegmented } from './TgScrapeParts'

const LONG = 180

function Value({ v, muted, clamp }: { v: unknown; muted?: boolean; clamp?: boolean }) {
  const text = display(v)
  const [open, setOpen] = useState(false)
  const long = clamp && text.length > LONG
  return (
    <span className={`block min-w-0 break-words text-[13px] leading-snug ${muted ? 'tg-muted' : 'text-[var(--tg-text)]'}`}>
      {long && !open ? `${text.slice(0, LONG)}…` : text}
      {long && (
        <button type="button" onClick={() => setOpen(o => !o)} className="ml-1 text-[12px] font-semibold text-[var(--tg-accent)]">
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
          className={`h-[26px] rounded-md px-2 text-[11px] font-semibold uppercase [@media(pointer:coarse)]:h-[34px] ${
            value === v.key ? 'bg-[var(--tg-accent)] text-[var(--tg-on-accent)]' : 'bg-[var(--tg-panel-2)] text-[var(--tg-text-2)]'
          }`}
        >
          {v.key}
        </button>
      ))}
    </div>
  )
}

/**
 * Field by field: yours beside theirs, and Keep / Fill / Replace for each.
 * Fill only exists where yours is empty and Replace only where it is not, so
 * every choice on screen means exactly what it says.
 */
export function TgScrapeFieldList({ rows, choices, onChoice, mediaModeOf, names, synopses, titleRegion, descLang, onTitleRegion, onDescLang, readOnly }: {
  rows: FieldRow[]
  choices: Partial<Record<SsField, FieldChoice>>
  onChoice: (field: SsField, c: FieldChoice) => void
  mediaModeOf: (type: string) => MediaMode
  names: SsLocalized[]
  synopses: SsLocalized[]
  titleRegion: string | null
  descLang: string | null
  onTitleRegion: (k: string | null) => void
  onDescLang: (k: string | null) => void
  readOnly: boolean
}) {
  const [showAll, setShowAll] = useState(false)
  const [showSame, setShowSame] = useState(false)
  // A picked title/description variant is what gets compared, not the default.
  const theirsOf = (r: FieldRow): unknown => {
    if (r.field === 'title' && titleRegion) return names.find(n => n.key === titleRegion)?.text ?? r.theirs
    if (r.field === 'description' && descLang) return synopses.find(s => s.key === descLang)?.text ?? r.theirs
    return r.theirs
  }
  const isSame = (r: FieldRow) => !r.isImage && sameValue(r.current, theirsOf(r))
  const offered = rows.filter(r => !r.theirsEmpty)
  const same = offered.filter(isSame)
  const nothing = rows.filter(r => r.theirsEmpty)
  const shown = [...offered.filter(r => !isSame(r)), ...(showSame ? same : []), ...(showAll ? nothing : [])]

  return (
    <div className="flex flex-col divide-y divide-[var(--tg-border)]">
      {shown.map(r => {
        const choice = choices[r.field] ?? 'keep'
        const mediaType = FIELD_MEDIA[r.field]
        const mode = mediaType ? mediaModeOf(mediaType) : undefined
        const rowSame = isSame(r)
        const willWrite = !rowSame && writes({ ...r, same: false }, choice, mode)
        const theirs = theirsOf(r)
        const options: { value: FieldChoice; label: string; disabled?: boolean; hint?: string }[] = [
          { value: 'keep', label: 'Keep' },
          r.currentEmpty ? { value: 'fill', label: 'Fill' } : { value: 'replace', label: 'Replace' },
        ]
        const imageNote = r.isImage && !r.theirsEmpty && mode !== 'store'
          ? 'Saved only when this image is set to Save below'
          : null
        return (
          <div key={r.field} className="grid grid-cols-1 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[12.5px] font-semibold text-[var(--tg-text)]">{r.label}</span>
                {willWrite && <span className="rounded bg-[var(--tg-green-soft)] px-1.5 text-[10.5px] font-semibold text-[var(--tg-green)]">will {r.currentEmpty ? 'fill' : 'replace'}</span>}
                {rowSame && <span className="text-[11px] tg-faint">same as yours</span>}
              </div>
              <div className="mt-1 grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-2 gap-y-1">
                <span className="text-[11px] uppercase tracking-[0.06em] tg-faint">Yours</span>
                <Value v={r.isImage ? (r.currentEmpty ? null : 'Has an image') : r.current} muted clamp />
                <span className="text-[11px] uppercase tracking-[0.06em] tg-faint">Theirs</span>
                <Value v={r.isImage ? (r.theirsEmpty ? null : 'Available') : theirs} clamp />
              </div>
              {r.field === 'title' && <Variants list={names} value={titleRegion} onPick={onTitleRegion} label="Title variant" />}
              {r.field === 'description' && <Variants list={synopses} value={descLang} onPick={onDescLang} label="Description language" />}
              {imageNote && <p className="mt-1 text-[11px] tg-faint">{imageNote}</p>}
            </div>
            {!readOnly && !r.theirsEmpty && !rowSame && (
              <TgSegmented size="sm" label={`${r.label}: what to do`} value={choice} options={options} onChange={c => onChoice(r.field, c)} />
            )}
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
        <button type="button" onClick={() => setShowAll(s => !s)} className="min-h-[44px] text-left text-[12.5px] leading-snug">
          <span className="tg-muted">They have nothing for: {nothing.map(r => r.label).join(', ')} </span>
          <span className="font-semibold text-[var(--tg-accent)]">{showAll ? 'Hide' : 'Show'}</span>
        </button>
      )}
    </div>
  )
}
