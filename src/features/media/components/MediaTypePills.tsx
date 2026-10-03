import type { MediaType } from '../types'

interface Props {
  value: MediaType
  onChange: (t: MediaType) => void
  /** While searching: how many of each type were found ("312", "…", "!"). */
  counts?: Partial<Record<MediaType, string>>
}

/**
 * Movies | TV — the one type switch on the overview (Discover, your library,
 * search results) and the Library view. Lists and Stats cover both types, so
 * they have none.
 */
export function MediaTypePills({ value, onChange, counts }: Props) {
  return (
    <div role="group" aria-label="Type" className="flex shrink-0 gap-1.5">
      {(['movie', 'tv'] as const).map(t => (
        <button key={t} type="button" aria-pressed={value === t} onClick={() => onChange(t)}
          className="pill-tab press-feedback shrink-0 gap-1.5 tabular-nums">
          {t === 'movie' ? 'Movies' : 'TV'}
          {counts?.[t] && <span className={value === t ? '' : 'text-fg-muted'}>{counts[t]}</span>}
        </button>
      ))}
    </div>
  )
}
