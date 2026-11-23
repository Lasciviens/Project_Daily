import { Check, ChevronDown, Lightbulb, RefreshCw, Send, Undo2, X } from 'lucide-react'
import { Button, Skeleton, TonePill, Truncate } from '../../../../shared/ui'
import { toast } from '../../../../app/store'
import { formatDate } from '../../../../shared/utils/dateFormat'
import { useLookForIdeasNow, useSetSuggestionState, useSuggestions, useSuggestRuns } from '../../../ai/claude/hooks/useSuggestions'
import {
  draftFromSuggestion, groupSuggestions, runSentence, savingWords, SUGGESTION_KIND_LABEL, SUGGESTION_KIND_MEANING, SUGGESTION_STATE_LABEL,
  type AiSuggestion, type SuggestionState,
} from '../../../ai/claude/suggestRules'
import { outlineOf } from '../../../ai/claude/featureRules'
import { useDevRequestDrafts } from '../../../devRequests/devRequestDraftStore'
import { isDraftEmpty } from '../../../devRequests/devRequestRules'
import { PAGE_OPTIONS } from '../../../devRequests/components/devRequestMeta'
import { ReadFailed } from './aiBits'

// Developer → AI → Learn → Suggestions: ideas for needing AI less. Found three ways (a count over the ledger, one optional note in an
// Ask AI answer, one small batch a week) and always only RECOMMENDED: an idea is a row of plain text that a model wrote, so it is checked
// again before it is shown, never a link, and nothing is built, switched on or changed by it. Keep · Dismiss · Send to Dev Requests
// (a draft the owner reviews and saves) · Built (the owner's own mark, after a normal reviewed change). A dismissed idea stays in the
// list for good (it is what stops it coming back) and can be brought back.

function Card({ s, onState, busy }: { s: AiSuggestion; onState: (state: SuggestionState) => void; busy: boolean }) {
  function sendToDevRequests() {
    const store = useDevRequestDrafts.getState()
    // An unsaved request in the window is the owner's: never overwritten.
    if (!isDraftEmpty(store.newDraft)) { toast.info('Your open request has text in it — save or discard it first, then try again'); return }
    const draft = draftFromSuggestion(s)
    store.patchNewDraft({
      title: draft.title, description: outlineOf(draft.points), page: PAGE_OPTIONS.includes('/developer') ? '/developer' : 'other',
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
      <p className="break-words text-meta tabular-nums text-fg-muted">{[SUGGESTION_KIND_LABEL[s.kind], savingWords(s), s.source === 'weekly' ? 'Weekly look' : 'From an answer'].join(' · ')}</p>
      <div className="flex flex-wrap gap-1.5">
        {s.state === 'new' && <Button size="sm" icon={<Check />} disabled={busy} onClick={() => onState('kept')}>Keep</Button>}
        {(s.state === 'new' || s.state === 'kept') && <Button size="sm" variant="ghost" icon={<X />} disabled={busy} onClick={() => onState('dismissed')}>Dismiss</Button>}
        {s.state !== 'dismissed' && s.state !== 'built' && <Button size="sm" variant="ghost" icon={<Send />} onClick={sendToDevRequests}><span className="sm:hidden">To Dev Requests</span><span className="hidden sm:inline">Send to Dev Requests</span></Button>}
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
  const look = useLookForIdeasNow()
  const groups = groupSuggestions(suggestions.data ?? [])
  const total = (suggestions.data ?? []).length
  const waiting = (runs.data ?? [])[0]?.status === 'queued'
  const change = (id: string, state: SuggestionState) => setState.mutate({ id, state })
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <section className="card flex flex-col gap-3 p-4">
        <div className="flex items-start gap-2.5">
          <span aria-hidden className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-control bg-accent-50 text-accent-600 [&_svg]:h-4 [&_svg]:w-4"><Lightbulb /></span>
          <p className="min-w-0 text-body text-fg-2"><span className="font-medium text-fg">Suggestions</span>: ideas for needing AI less. They only recommend: nothing is built or changed by itself.</p>
        </div>
        <p className="text-meta text-fg-muted">{runs.isLoading ? 'Reading the last look…' : runSentence((runs.data ?? [])[0] ?? null, iso => formatDate(iso))}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<RefreshCw />} loading={look.isPending} disabled={waiting} onClick={() => look.mutate()}>Look for ideas now</Button>
        </div>
      </section>
      {suggestions.isLoading && <Skeleton rounded="rounded-card" className="h-24 w-full" />}
      {suggestions.isError && <ReadFailed what="the ideas" error={suggestions.error} onRetry={() => { void suggestions.refetch() }} retrying={suggestions.isFetching} />}
      {!suggestions.isLoading && !suggestions.isError && total === 0 && (
        <p className="text-body text-fg-muted">No ideas yet. Ask AI notes one when it is obvious the app could show something without AI, and a small look runs every Monday at 05:00.</p>
      )}
      <Group title="New" list={groups.fresh} onState={change} busy={setState.isPending} />
      <Group title="Kept" list={groups.kept} onState={change} busy={setState.isPending} />
      <Group title="Built" list={groups.built} onState={change} busy={setState.isPending} />
      {groups.dismissed.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1 px-1 text-meta font-medium text-fg-2">
            <ChevronDown aria-hidden className="h-4 w-4 transition-transform group-open:rotate-180" />Dismissed · {groups.dismissed.length}
          </summary>
          <p className="mb-1.5 mt-1 px-1 text-meta text-fg-muted">A dismissed idea never comes back by itself. It stays here so it is not suggested again.</p>
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
