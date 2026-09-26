import { useState, useEffect, useRef } from 'react'
import { useWorkNote, useUpsertWorkNote } from '../hooks/useWork'

type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved'

const STATUS_LABEL: Record<SaveStatus, string> = { idle: '', pending: 'Not saved', saving: 'Saving…', saved: 'Saved' }

// Autosaving scratchpad (rendered inside WorkSidebar's rail card). The save
// is debounced from the change handler, and a pending edit is flushed on
// unmount. Failures are toasted + logged by the mutation hook.
export default function QuickNotesWidget() {
  const { data: note, isError } = useWorkNote()
  const upsert = useUpsertWorkNote()

  const [content, setContent] = useState('')
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [initialized, setInitialized] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<string | null>(null)
  const upsertRef = useRef(upsert)
  useEffect(() => { upsertRef.current = upsert })

  // Seed once the note loads (render-time adjust, not an effect).
  if (note !== undefined && !initialized) {
    setInitialized(true)
    setContent(note?.content ?? '')
  }

  async function save(text: string) {
    pendingRef.current = null
    setStatus('saving')
    try {
      await upsertRef.current.mutateAsync(text)
      setStatus('saved')
    } catch {
      setStatus('pending')
    }
  }

  function handleChange(text: string) {
    setContent(text)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (text === (note?.content ?? '')) {
      pendingRef.current = null
      setStatus('idle')
      return
    }
    pendingRef.current = text
    setStatus('pending')
    debounceRef.current = setTimeout(() => { void save(text) }, 1500)
  }

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    // Fire-and-forget: an unmount can't await.
    if (pendingRef.current !== null) upsertRef.current.mutate(pendingRef.current)
  }, [])

  return (
    <div className="flex flex-col gap-1.5">
      <span className="min-h-4 self-end text-meta text-fg-muted" aria-live="polite">{STATUS_LABEL[status]}</span>
      <textarea
        value={content}
        onChange={e => handleChange(e.target.value)}
        disabled={!initialized && !isError}
        placeholder="Jot something down…"
        aria-label="Work notes"
        className="input min-h-[8rem] resize-y"
      />
    </div>
  )
}
