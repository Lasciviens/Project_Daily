import { Search, X } from 'lucide-react'

interface Props {
  value: string
  onChange: (value: string) => void
  /** ✕ and Esc: leave the search (back to the overview). */
  onClear: () => void
  /** A search is open (results on screen), even with the box emptied. */
  active?: boolean
}

/**
 * The Media search box. It only edits the query: the results replace the
 * overview below it (MediaSearchResults), so nothing drops down over — or
 * hides behind — the next card.
 */
export function MediaSearch({ value, onChange, onClear, active }: Props) {
  const label = 'Search movies and TV'
  return (
    <form role="search" className="relative w-full max-w-md"
      // Search on the phone keyboard closes the keyboard; the results are already on screen.
      onSubmit={e => { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur() }}>
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
      <input
        type="search"
        enterKeyHint="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape' && (value || active)) { e.preventDefault(); onClear() } }}
        placeholder={`${label}…`}
        aria-label={label}
        className="input w-full pl-9 pr-11 [&::-webkit-search-cancel-button]:hidden"
      />
      {value || active ? (
        <button type="button" onClick={onClear} aria-label="Clear search" title="Clear search"
          className="absolute right-0 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center text-fg-faint hover:text-fg">
          <X aria-hidden className="h-4 w-4" />
        </button>
      ) : null}
    </form>
  )
}
