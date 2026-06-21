import { useState, useEffect, useRef, useCallback } from 'react'
import { useWorkNote, useUpsertWorkNote } from '../hooks/useWork'

type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved'

export default function QuickNotesWidget() {
  const { data: note } = useWorkNote()
  const upsert = useUpsertWorkNote()

  const [content, setContent] = useState('')
  const [status, setStatus] = useState<SaveStatus>('idle')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef(false)
  const initializedRef = useRef(false)

  // Populate once the note loads
  useEffect(() => {
    if (note !== undefined && !initializedRef.current) {
      initializedRef.current = true
      setContent(note?.content ?? '')
    }
  }, [note])

  const save = useCallback(async (text: string) => {
    setStatus('saving')
    pendingRef.current = false
    try {
      await upsert.mutateAsync(text)
      setStatus('saved')
    } catch {
      setStatus('pending')
    }
  }, [upsert])

  // Debounced auto-save
  useEffect(() => {
    if (!initializedRef.current) return
    if (content === (note?.content ?? '')) {
      setStatus('idle')
      return
    }
    pendingRef.current = true
    setStatus('pending')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      save(content)
    }, 1500)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  // Save immediately on unmount if pending
  useEffect(() => {
    return () => {
      if (pendingRef.current) {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        // Fire-and-forget — unmount can't await
        upsert.mutate(content)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content])

  const statusLabel =
    status === 'saving' ? 'Saving…' :
    status === 'saved'  ? 'Saved ✓' :
    status === 'pending' ? 'Not saved' :
    ''

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold tracking-widest uppercase text-ink-400">
          Notes
        </span>
        <span className="text-xs text-ink-300 transition-opacity duration-300" aria-live="polite">
          {statusLabel}
        </span>
      </div>
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="Jot something down…"
        className="w-full min-h-[120px] bg-cream-50 rounded-xl p-3 text-sm text-ink-900 placeholder:text-ink-300 resize-none outline-none focus:ring-1 focus:ring-ink-200 transition"
        aria-label="Work notes"
      />
    </div>
  )
}
