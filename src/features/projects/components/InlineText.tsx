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
  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])

  function commit() {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) onSave(trimmed)
    else setDraft(value)
  }

  if (!editing) {
    return (
      <span
        onClick={() => !disabled && setEditing(true)}
        className={`cursor-text rounded px-0.5 hover:bg-ink-100 transition-colors duration-100 ${className}`}
      >
        {value || <span className="text-ink-300">{placeholder}</span>}
      </span>
    )
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter')  { e.preventDefault(); commit() }
        if (e.key === 'Escape') { setEditing(false); setDraft(value) }
      }}
      className={`rounded px-0.5 outline-none border-b border-accent-400 bg-transparent ${inputClass}`}
    />
  )
}
