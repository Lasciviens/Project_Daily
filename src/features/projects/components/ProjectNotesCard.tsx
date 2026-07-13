import { useState, useEffect, useRef, useCallback } from 'react'

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    status === 'saved'   ? 'Saved ✓' :
    status === 'pending' ? 'Not saved' : ''

  return (
    <div className="bg-cream-50 border border-ink-200 rounded-2xl p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-ink-400">Notes</span>
        <span className="text-xs text-ink-300 transition-opacity duration-300" aria-live="polite">{statusLabel}</span>
      </div>
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="Jot down anything about this project…"
        className="w-full min-h-[160px] bg-cream-50 rounded-xl p-3 text-sm text-ink-900 placeholder:text-ink-300 resize-none outline-none focus:ring-1 focus:ring-ink-200 transition"
        aria-label="Project notes"
      />
    </div>
  )
}
