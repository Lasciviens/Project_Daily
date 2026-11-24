import { Check, ChevronDown, Lightbulb, RefreshCw, Send, Undo2, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button, Skeleton, TonePill, Truncate } from '../../../../shared/ui'
import { toast } from '../../../../app/store'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { useLookForSuggestionsNow, useSetSuggestionState, useSuggestions, useSuggestRuns } from '../../../ai/claude/hooks/useSuggestions'
import {
  benefitLine, draftFromSuggestion, groupSuggestions, runSentence, seenWords, SUGGESTION_COMPLEXITY_LABEL, SUGGESTION_KIND_LABEL, SUGGESTION_KIND_MEANING,
  SUGGESTION_STATE_LABEL, type AiSuggestion, type SuggestionState,
} from '../../../ai/claude/suggestRules'
import { outlineOf } from '../../../ai/claude/featureRules'
import { useDevRequestDrafts } from '../../../devRequests/devRequestDraftStore'
import { isDraftEmpty } from '../../../devRequests/devRequestRules'
import { parseDescription } from '../../../devRequests/devRequestMarks'
import { PAGE_OPTIONS } from '../../../devRequests/components/devRequestMeta'
import { ReadFailed } from './aiBits'

// Developer → AI → Learn → Suggestions: suggestions for needing AI less. Found three ways (a count over the ledger, one optional note in an
// Ask AI answer, one small batch a week) and always only RECOMMENDED: a suggestion is a row of plain text that a model wrote, so it is
// checked again before it is shown, never a link of its own making, and nothing is built, switched on or changed by it. Keep · Dismiss ·
// Send to Dev Requests (a draft the owner reviews and saves) · Mark built (the owner's own mark; a Dev Request that came from the suggestion
// and is marked done marks it too). A dismissed suggestion stays in the list for good (it is what stops it coming back) and can be brought back.

const LINK_CLASS = 'font-medium text-accent-600 underline decoration-dotted underline-offset-2 [@media(hover:hover)]:hover:text-accent-700'

function Source({ s }: { s: AiSuggestion }) {
  // The addresses are ours: the Calls view, and the run of the answer the suggestion first came from.
  if (s.source === 'weekly') return <Link to="/developer?tab=ai&view=calls" className={LINK_CLASS}>From your calls</Link>
  if (s.run_id) return <Link to={`/developer?tab=ai&view=calls&run=${s.run_id}`} className={LINK_CLASS}>From this answer</Link>
  return <span>From an answer</span>
}

function Card({ s, onState, busy }: { s: AiSuggestion; onState: (state: SuggestionState) => void; busy: boolean }) {
  function sendToDevRequests() {
    const store = useDevRequestDrafts.getState()
    // An unsaved request in the window is the owner's: never overwritten.
    if (!isDraftEmpty(store.newDraft)) { toast.info('Your open request has text in it — save or discard it first, then try again'); return }
    const draft = draftFromSuggestion(s)
    const description = outlineOf(draft.points)
    // The window reads [[…]] lines as marks and reviews: a draft that would make one is never sent (the texts are checked as plain text, this is the second look).
    const parsed = parseDescription(description)
    if (parsed.marks.length || parsed.reviews.length || parsed.recheck || parsed.checkpoints.length) { toast.error('This suggestion can’t be sent: its text holds something the request window would read as a mark'); return }
    store.patchNewDraft({
      title: draft.title, description, page: PAGE_OPTIONS.includes('/developer') ? '/developer' : 'other',
      category: draft.category, priority: draft.priority, attachContext: false,
    })
    store.openComposer({ kind: 'new' })
  }
  return (
    <li className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Truncate as="p" lines={2} className="min-w-0 flex-1 text-body font-medium text-fg">{s.title}</Truncate>
        <TonePill tone={s.state === 'built' ? 'success' : s.state === 'kept' ? 'accent' : 'neutral'} className="shrink-0">{SUGGESTION_STATE_LABEL[s.state]}</TonePill>
      </div>
      <Truncate as="p" lines={3} className="text-body text-fg-2">{s.why}</Truncate>
      <p className="break-words text-body text-fg"><Truncate lines={2}>{s.benefit}</Truncate></p>
      <p className="break-words text-meta tabular-nums text-fg-muted">{benefitLine(s)}</p>
      <p className="break-words text-meta text-fg-muted">
        {SUGGESTION_KIND_LABEL[s.kind]} · {SUGGESTION_COMPLEXITY_LABEL[s.complexity]} · {seenWords(s)} · <Source s={s} />
      </p>
      <div className="flex flex-wrap gap-1.5">
        {s.state === 'new' && <Button size="sm" icon={<Check />} disabled={busy} onClick={() => onState('kept')}>Keep</Button>}
        {(s.state === 'new' || s.state === 'kept') && <Button size="sm" variant="ghost" icon={<X />} disabled={busy} onClick={() => onState('dismissed')}>Dismiss</Button>}
        {s.state !== 'dismissed' && s.state !== 'built' && <Button size="sm" variant="ghost" icon={<Send />} onClick={sendToDevRequests} tip="Request — send to Dev Requests">Request</Button>}
        {s.state === 'kept' && <Button size="sm" variant="ghost" icon={<Check />} disabled={busy} onClick={() => onState('built')}>Mark built</Button>}
        {(s.state === 'dismissed' || s.state === 'built') && <Button size="sm" variant="ghost" icon={<Undo2 />} disabled={busy} onClick={() => onState('new')}>Bring back</Button>}
      </div>
    </li>
  )
}

function Group({ title, list, onState, busy }: { title: string; list: readonly AiSuggestion[]; onState: (id: string, state: SuggestionState) => void; busy: boolean }) {
  if (list.length === 0) return null
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h3 className="field-label px-1">{title} · {list.length}</h3>
      <ul className="card divide-y divide-line overflow-hidden">
        {list.map(s => <Card key={s.id} s={s} busy={busy} onState={state => onState(s.id, state)} />)}
      </ul>
    </section>
  )
}

export function AiSuggestions() {
  const suggestions = useSuggestions()
  const runs = useSuggestRuns()
  const setState = useSetSuggestionState()
  const look = useLookForSuggestionsNow()
  const groups = groupSuggestions(suggestions.data ?? [])
  const total = (suggestions.data ?? []).length
  const waiting = (runs.data ?? [])[0]?.status === 'queued'
  const change = (id: string, state: SuggestionState) => setState.mutate({ id, state })
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <section className="card flex flex-col gap-3 p-4">
        <div className="flex items-start gap-2.5">
          <span aria-hidden className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-control bg-accent-50 text-accent-600 [&_svg]:h-4 [&_svg]:w-4"><Lightbulb /></span>
          <p className="min-w-0 text-body text-fg-2"><span className="font-medium text-fg">Suggestions</span> for needing AI less. They only recommend: nothing is built or changed by itself, and the app does not track what you open or do by hand — only the AI calls.</p>
        </div>
        <p className="text-meta text-fg-muted">{runs.isLoading ? 'Reading the last look…' : runSentence((runs.data ?? [])[0] ?? null, iso => formatDate(iso))}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<RefreshCw />} loading={look.isPending} disabled={waiting} onClick={() => look.mutate()} tip="Look for suggestions now">Look now</Button>
        </div>
      </section>
      {suggestions.isLoading && <Skeleton rounded="rounded-card" className="h-24 w-full" />}
      {suggestions.isError && <ReadFailed what="the suggestions" error={suggestions.error} onRetry={() => { void suggestions.refetch() }} retrying={suggestions.isFetching} />}
      {!suggestions.isLoading && !suggestions.isError && total === 0 && (
        <p className="text-body text-fg-muted">No suggestions yet. Ask AI notes one when it is obvious the app could show something without AI, and a small look runs every Monday at 05:00.</p>
      )}
      <Group title="New" list={groups.fresh} onState={change} busy={setState.isPending} />
      <Group title="Kept" list={groups.kept} onState={change} busy={setState.isPending} />
      <Group title="Built" list={groups.built} onState={change} busy={setState.isPending} />
      {groups.dismissed.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1 px-1 text-meta font-medium text-fg-2">
            <ChevronDown aria-hidden className="h-4 w-4 transition-transform group-open:rotate-180" />Dismissed · {groups.dismissed.length}
          </summary>
          <p className="mb-1.5 mt-1 px-1 text-meta text-fg-muted">A dismissed suggestion never comes back by itself. It stays here so it is not suggested again.</p>
          <ul className="card divide-y divide-line overflow-hidden">
            {groups.dismissed.map(s => <Card key={s.id} s={s} busy={setState.isPending} onState={state => change(s.id, state)} />)}
          </ul>
        </details>
      )}
      <details className="text-meta text-fg-muted">
        <summary className="cursor-pointer font-medium text-fg-2">What the kinds mean</summary>
        <dl className="mt-1 flex flex-col gap-1">
          {Object.entries(SUGGESTION_KIND_MEANING).map(([kind, meaning]) => (
            <div key={kind}><dt className="inline font-semibold text-fg">{SUGGESTION_KIND_LABEL[kind as keyof typeof SUGGESTION_KIND_LABEL]}</dt> <dd className="inline">— {meaning}</dd></div>
          ))}
        </dl>
      </details>
    </div>
  )
}
