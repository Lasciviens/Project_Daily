import { useState, useRef, useEffect } from 'react'

interface Props {
  value:       string
  onSave:      (val: string) => void
  placeholder?: string
  className?:  string
  inputClass?: string
  disabled?:   boolean
}

export function InlineText({ value, onSave, placeholder, className = '', inputClass = '', disabled }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  // The draft is seeded when editing starts, so it always reflects the latest value.
  function startEditing() {
    if (disabled) return
    setDraft(value)
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) onSave(trimmed)
    else setDraft(value)
  }

  if (!editing) {
    return (
      <span
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={e => { e.stopPropagation(); startEditing() }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); startEditing() } }}
        title="Click to edit"
        className={`cursor-text rounded-md px-0.5 transition-colors duration-100 hover:bg-surface-hover ${className}`}
      >
        {value || <span className="text-fg-faint">{placeholder}</span>}
      </span>
    )
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => {
        // Keys stay here: a parent row may toggle on Enter.
        e.stopPropagation()
        if (e.key === 'Enter')  { e.preventDefault(); commit() }
        if (e.key === 'Escape') { setEditing(false); setDraft(value) }
      }}
      className={`rounded-md border-b border-accent-500 bg-transparent px-0.5 outline-none ${inputClass}`}
    />
  )
}
