import { useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { useTestGameStore } from '../testGameStore'

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
}

/** The top bar's search field, bound to the page store. ⌘K / Ctrl+K or "/" focuses it. */
export function TgTopBarSearch({ className = '' }: { className?: string }) {
  const search = useTestGameStore(s => s.search)
  const setSearch = useTestGameStore(s => s.setSearch)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return
      const input = inputRef.current
      if (!input) return
      const key = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && !e.altKey && key === 'k') {
        e.preventDefault()
        input.focus()
        input.select()
      } else if (key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault()
        input.focus()
      }
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
        className={`tg-input truncate pl-10 ${search ? 'pr-10' : 'pr-3 xl:pr-16'}`}
      />
      {search ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => { setSearch(''); inputRef.current?.focus() }}
          className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--tg-muted)] transition-colors hover:bg-[var(--tg-hover)] hover:text-[var(--tg-text)] [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
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
