import { useState, useRef, useEffect } from 'react'

interface Props {
  value:       string | null
  onSave:      (val: string | null) => void
  placeholder?: string
  className?:  string
}

export function InlineTextArea({ value, onSave, placeholder, className = '' }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(value ?? '')
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { if (editing) ref.current?.focus() }, [editing])
  useEffect(() => { if (!editing) setDraft(value ?? '') }, [value, editing])

  function commit() {
    setEditing(false)
    const trimmed = draft.trim() || null
    if (trimmed !== value) onSave(trimmed)
  }

  if (!editing) {
    return (
      <p
        onClick={() => setEditing(true)}
        className={`cursor-text text-xs text-ink-500 hover:bg-ink-100 rounded px-0.5 min-h-[18px] ${className}`}
      >
        {value || <span className="text-ink-300">{placeholder}</span>}
      </p>
    )
  }

  return (
    <textarea
      ref={ref}
      value={draft}
      rows={2}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Escape') { setEditing(false); setDraft(value ?? '') }
      }}
      className={`w-full text-xs border border-accent-300 rounded px-1 py-0.5 outline-none resize-none bg-cream-50 ${className}`}
    />
  )
}
