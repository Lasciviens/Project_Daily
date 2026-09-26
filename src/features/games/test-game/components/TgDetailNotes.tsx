import { useState } from 'react'
import { useUpdateGame } from '../../hooks/useGames'
import type { TgGame } from '../testGameModel'

/**
 * Your own notes on a game, edited in place and saved when you leave the box
 * (Media's personal-note convention) — no Save button, no modal.
 */
export function TgDetailNotes({ game }: { game: TgGame }) {
  const update = useUpdateGame(`game-${game.id}`)
  const saved = game.play_notes ?? ''
  const [draft, setDraft] = useState(saved)
  // A save elsewhere (or another game) replaces the draft only while it is untouched.
  const [base, setBase] = useState(saved)
  if (saved !== base) { setBase(saved); if (draft === base) setDraft(saved) }

  const commit = () => {
    const next = draft.trim()
    if (next === saved.trim()) return
    update.mutate({ id: game.id, patch: { play_notes: next || null } })
  }
  return (
    <section className="flex flex-col gap-1.5 border-t border-[var(--tg-border)] pt-3.5">
      <label htmlFor={`notes-${game.id}`} className="tg-section-label">My notes</label>
      <textarea
        id={`notes-${game.id}`}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        rows={draft.split('\n').length > 2 ? 5 : 3}
        placeholder="Where you are, what to try next, what you thought of it…"
        className="tg-input min-h-[88px] resize-y py-2 text-[13px] leading-snug"
      />
      <span className="text-[11px] tg-muted">{update.isPending ? 'Saving…' : 'Saved when you leave the box.'}</span>
    </section>
  )
}
