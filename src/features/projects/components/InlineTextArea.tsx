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

  function startEditing() {
    setDraft(value ?? '')
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    const trimmed = draft.trim() || null
    if (trimmed !== value) onSave(trimmed)
  }

  if (!editing) {
    return (
      <p
        role="button"
        tabIndex={0}
        onClick={startEditing}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); startEditing() } }}
        className={`min-h-[20px] cursor-text rounded-md px-0.5 text-body text-fg-2 transition-colors hover:bg-surface-hover ${className}`}
      >
        {value || <span className="text-fg-faint">{placeholder}</span>}
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
      className={`input w-full resize-none py-1.5 ${className}`}
    />
  )
}
