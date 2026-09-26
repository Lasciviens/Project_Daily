import { useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { useTestGameStore } from '../testGameStore'
import { dialogIsOpen, isTypingTarget } from './tgKeys'

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)

/** The top bar's search field, bound to the page store. ⌘K / Ctrl+K or "/" focuses it. */
export function TgTopBarSearch({ className = '' }: { className?: string }) {
  const search = useTestGameStore(s => s.search)
  const setSearch = useTestGameStore(s => s.setSearch)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey) return
      const input = inputRef.current
      if (!input) return
      const key = e.key.toLowerCase()
      const shortcut = (e.metaKey || e.ctrlKey) && key === 'k'
      const slash = key === '/' && !e.metaKey && !e.ctrlKey && !isTypingTarget(e.target)
      if (!shortcut && !slash) return
      if (dialogIsOpen(e.target)) return
      // Only claim the key when focus actually moves (a hidden field can't take it).
      input.focus()
      if (document.activeElement !== input) return
      e.preventDefault()
      if (shortcut) input.select()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className={`relative ${className}`}>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--tg-muted)]"
        strokeWidth={2}
      />
      <input
        ref={inputRef}
        type="text"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        aria-label="Search games"
        placeholder="Search games, consoles, or tags..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        onKeyDown={e => {
          if (e.key !== 'Escape') return
          e.preventDefault()
          if (search) setSearch('')
          else e.currentTarget.blur()
        }}
        className={`tg-input truncate pl-10 ${search ? 'pr-10 [@media(pointer:coarse)]:pr-11' : 'pr-3 xl:pr-16'}`}
      />
      {search ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => { setSearch(''); inputRef.current?.focus() }}
          // 44×44 flush right on touch — the field itself is 44px tall there.
          className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--tg-muted)] transition-colors [@media(hover:hover)]:hover:bg-[var(--tg-hover)] [@media(hover:hover)]:hover:text-[var(--tg-text)] [@media(pointer:coarse)]:right-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:rounded-[11px]"
        >
          <X aria-hidden className="h-4 w-4" strokeWidth={2} />
        </button>
      ) : (
        <kbd
          aria-hidden
          className="tg-kbd pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 !border-transparent !bg-[var(--tg-hover)] [font-family:inherit] max-xl:!hidden"
        >
          {IS_MAC ? '⌘' : 'Ctrl'}
          <span className="ml-1">K</span>
        </kbd>
      )}
    </div>
  )
}
