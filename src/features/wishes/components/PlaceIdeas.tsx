import { useState } from 'react'
import { Plus, Sparkles, X } from 'lucide-react'
import { Button, TonePill } from '../../../shared/ui'
import { usePlaceIdeas } from '../../ai/claude/hooks/useAiFeatures'
import { costNote, ideasBlock, notesWithIdeas } from '../../ai/claude/featureRules'

/**
 * "Ideas" for a place wish: 5–8 things to do there, for the notes. The model may search the web (a small place is where
 * its own memory is weakest) and the answer says which it was: "found with web search", or "the model's general
 * knowledge — check before you go". They are shown first; "Add to notes" is the owner's confirmation, and the notes
 * are English. Nothing is saved until the wish is.
 */
export function PlaceIdeas({ title, city, country, notes, onNotes }: { title: string; city: string; country: string; notes: string; onNotes: (notes: string) => void }) {
  const ask = usePlaceIdeas()
  const [shown, setShown] = useState<{ ideas: string[]; fromSearch: boolean; costUsd: number | null } | null>(null)
  const place = [city.trim(), country.trim()].filter(Boolean).join(', ') || title.trim()

  async function run() {
    try { setShown(await ask.mutateAsync({ place, wish: title, notes })) } catch { /* the hook reports it */ }
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button size="sm" icon={<Sparkles />} loading={ask.isPending} disabled={!place} onClick={() => { void run() }}
          tip={place ? `Ideas for ${place}` : 'Ideas — name the city or the wish first'}>Ideas</Button>
      </div>
      {shown && (
        <div className="rounded-row border border-line bg-surface-2 p-3">
          <div className="mb-1.5 flex items-center gap-2">
            <TonePill tone={shown.fromSearch ? 'success' : 'warn'}>{shown.fromSearch ? 'Found with web search' : "Model's general knowledge — check before you go"}</TonePill>
            {costNote(shown.costUsd) && <span className="text-meta tabular-nums text-fg-muted">{costNote(shown.costUsd)}</span>}
            <button type="button" aria-label="Dismiss the ideas" onClick={() => setShown(null)} className="ml-auto text-fg-muted hover:text-fg"><X aria-hidden className="h-4 w-4" /></button>
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-body text-fg">
            {shown.ideas.map(i => <li key={i} className="break-words">{i}</li>)}
          </ul>
          <Button size="sm" variant="primary" icon={<Plus />} className="mt-2"
            onClick={() => { onNotes(notesWithIdeas(notes, ideasBlock(shown.ideas, shown.fromSearch))); setShown(null) }} tip="Add to the notes">Add</Button>
        </div>
      )}
    </div>
  )
}
