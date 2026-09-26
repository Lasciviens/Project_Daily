import { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardHeader } from '../../../shared/ui'

type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved'

// Debounced autosave textarea for a project's freeform notes — same pattern
// as Work's QuickNotesWidget, scoped per-project instead of a single global row.
export function ProjectNotesCard({ notes, onSave }: { notes: string | null; onSave: (notes: string | null) => Promise<unknown> }) {
  const [content, setContent] = useState(notes ?? '')
  const [status,  setStatus]  = useState<SaveStatus>('idle')
  const debounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef     = useRef(false)
  const lastSavedRef    = useRef(notes ?? '')

  const save = useCallback(async (text: string) => {
    setStatus('saving')
    pendingRef.current = false
    try {
      await onSave(text.trim() || null)
      lastSavedRef.current = text
      setStatus('saved')
    } catch {
      setStatus('pending')
    }
  }, [onSave])

  useEffect(() => {
    if (content === lastSavedRef.current) { setStatus('idle'); return }
    pendingRef.current = true
    setStatus('pending')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => save(content), 1500)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  useEffect(() => {
    return () => { if (pendingRef.current) onSave(content.trim() || null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  const statusLabel =
    status === 'saving'  ? 'Saving…' :
    status === 'saved'   ? 'Saved' :
    status === 'pending' ? 'Not saved' : ''

  return (
    <Card>
      <CardHeader
        title="Notes"
        variant="label"
        action={statusLabel ? <span className="text-meta text-fg-muted" aria-live="polite">{statusLabel}</span> : undefined}
      />
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="Jot down anything about this project…"
        className="input min-h-[160px] w-full resize-y py-2"
        aria-label="Project notes"
      />
    </Card>
  )
}
