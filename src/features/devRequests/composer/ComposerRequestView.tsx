import { useMemo, useState, type Ref, type RefObject } from 'react'
import { useLocation } from 'react-router-dom'
import { ArrowUpRight, CalendarClock, Check, CheckCheck, CornerUpLeft, Crosshair, FileText, ListChecks, Plus, Quote, Send, Sparkles, Trash2, Undo2 } from 'lucide-react'
import { useDevRequestDrafts } from '../devRequestDraftStore'
import { cardTimeline, draftFromRow, isDraftEmpty, type ComposerTarget, type DraftFields } from '../devRequestRules'
import { useDeleteDevRequests, useDevRequests, useUpdateDevRequest } from '../hooks/useDevRequests'
import { discardEditDraft, discardNewDraft, useSaveDevRequestDraft } from '../hooks/useDevRequestDraft'
import { useEditTailNote, useMarkRequestDone, useReviewPoint, useSendToRecheck } from '../hooks/usePointReview'
import { useComposerPrompt } from './useComposerPrompt'
import { allResolved, isReviewable, notFixedKeys, reviewCounts, requestPoints } from '../points'
import { parseDescription, type RecheckOf } from '../devRequestMarks'
import { cleanText, type PageContext } from '../devRequestContext'
import { RequestFields } from '../components/RequestFields'
import { ReviewMeter } from '../components/ReviewMeter'
import { PageContextToggle } from '../components/PageContextToggle'
import type { OutlineHandle } from '../components/OutlineEditor'
import { PAGE_OPTIONS, pageOptionFor } from '../components/devRequestMeta'
import { useDraftDevRequest } from '../../ai/claude/hooks/useAiFeatures'
import { costNote, hasMarks, splitSaid, tidiedDescription } from '../../ai/claude/featureRules'
import { Button, IconButton, Skeleton, Truncate } from '../../../shared/ui'
import { formatDateTime } from '../../../shared/utils/dateFormat'

interface Props {
  target: ComposerTarget
  readPage: () => PageContext
  onPick: () => void
  onQuote: (() => void) | null
  /** A mouse and keyboard: Alt-click picks, keyboard hints show. */
  mouse: boolean
  flash: boolean
  titleRef: Ref<HTMLInputElement>
  outlineRef: RefObject<OutlineHandle | null>
  /** A save went through (for the request it was made for). */
  onDone: (saved: ComposerTarget) => void
  /** The request was deleted from here. */
  onDeleted: () => void
}

const open = (id: string) => useDevRequestDrafts.getState().openComposer({ kind: 'edit', id })

/**
 * The request window: one request, written as an outline (title, details,
 * points), saved with Save. Once the request went to Claude it is also where
 * the work is checked — each point Fixed or Not fixed (with what is still
 * wrong), Not fixed ones sent to a re-check request, and the request marked
 * done. The prompt for Claude is its own step (ComposerPromptView): the
 * footer's Prompt button opens it for this request as written now.
 */
export function ComposerRequestView({ target, readPage, onPick, onQuote, mouse, flash, titleRef, outlineRef, onDone, onDeleted }: Props) {
  const { pathname } = useLocation()
  const { data: requests, isLoading } = useDevRequests()
  const row = target.kind === 'edit' ? requests?.find(r => r.id === target.id) ?? null : null
  const seed = useMemo(() => (row ? draftFromRow(row) : null), [row])
  const newDraft = useDevRequestDrafts(s => s.newDraft)
  const editDraft = useDevRequestDrafts(s => (target.kind === 'edit' ? s.editDrafts[target.id] : undefined))
  const { saveNew, saveEdit, pending } = useSaveDevRequestDraft()
  const updateStatus = useUpdateDevRequest()
  const deleteRequest = useDeleteDevRequests()
  const reviewPoint = useReviewPoint()
  const sendToRecheck = useSendToRecheck()
  const markDone = useMarkRequestDone()
  const editTailNote = useEditTailNote()
  const composerPrompt = useComposerPrompt()
  const draftAi = useDraftDevRequest()
  // After a Tidy up: what was there before (for Undo) and what the call cost, shown above the footer until dismissed.
  const [tidied, setTidied] = useState<{ before: Pick<DraftFields, 'title' | 'description' | 'page' | 'category' | 'priority'>; costUsd: number | null } | null>(null)

  const fields: DraftFields | null = target.kind === 'new' ? newDraft : (editDraft ?? seed)
  const parsed = useMemo(() => parseDescription(fields?.description ?? ''), [fields?.description])
  const points = useMemo(() => requestPoints(parsed), [parsed])

  if (target.kind === 'edit' && !row) {
    if (isLoading) return <div className="flex flex-col gap-3 p-4"><Skeleton className="h-8" /><Skeleton className="h-8 w-2/3" /><Skeleton className="h-36" /></div>
    return (
      <div className="flex flex-col items-start gap-3 p-4 text-body text-fg-muted">
        <p>This request no longer exists.</p>
        <Button size="sm" onClick={() => {
          const s = useDevRequestDrafts.getState()
          s.clearEditDraft(target.id)
          s.beginNewDraft(readPage(), pageOptionFor(pathname))
          s.openComposer({ kind: 'new' })
        }} tip="New — write a new request">New</Button>
      </div>
    )
  }
  if (!fields) return null

  const onChange = (p: Partial<DraftFields>) => {
    const s = useDevRequestDrafts.getState()
    if (target.kind === 'new') s.patchNewDraft(p)
    else s.patchEditDraft(target.id, p, seed!)
  }

  // Once the request went to Claude each point is reviewed here, written at once (like the status).
  const reviewable = !!row && isReviewable(row)
  const review = row && reviewable ? {
    onSet: (key: string, r: Parameters<ReturnType<typeof useReviewPoint>>[2]) => reviewPoint(row, key, r),
    onOpenRequest: open,
  } : undefined

  const done = () => onDone(target)
  function save() {
    if (pending) return
    if (target.kind === 'new') void saveNew(readPage(), done)
    else void saveEdit(target.id, fields!, undefined, done)
  }
  // The emptied draft still belongs to the page it is written on.
  const discardNew = () => discardNewDraft({ start: readPage(), page: pageOptionFor(pathname) })
  async function remove() {
    if (!row) return
    const result = await deleteRequest.run([row.id], { title: `Delete "${row.title}"?`, message: 'The request and its points are removed.', done: 'Request deleted' })
    if (result !== 'deleted' && result !== 'gone') return
    useDevRequestDrafts.getState().clearEditDraft(row.id)
    onDeleted()
  }

  const dirty = target.kind === 'new' ? !isDraftEmpty(newDraft) : !!editDraft
  const timeline = row ? [cardTimeline(row), row.prompted_at ? `Prompted ${formatDateTime(row.prompted_at)}` : ''].filter(Boolean).join(' · ') : ''

  // Tidy up: what is written (or dictated) here → a title, page, category, priority and the outline's points, in English. It
  // fills the fields for review. The owner's own words stay as typed in a "Said:" paragraph under the points, and Undo
  // (above the footer) puts every field back. The page comes only from the app's own list. A request with Pick links or
  // review marks is never sent: those lines belong to the request and the AI neither reads nor changes them.
  const marked = hasMarks(fields.description)
  async function tidyUp() {
    if (draftAi.isPending) return
    const before = { title: fields!.title, description: fields!.description, page: fields!.page, category: fields!.category, priority: fields!.priority }
    const { rest, said: earlier } = splitSaid(fields!.description)
    const typed = [fields!.title.trim(), rest.trim()].filter(Boolean).join('\n\n')
    const text = earlier ? `${earlier}\n\n${typed}`.trim() : typed
    try {
      const d = await draftAi.mutateAsync({ text, pages: [...PAGE_OPTIONS, 'other'], currentPage: pageOptionFor(pathname) })
      // The words kept are the first ones said: a second Tidy up keeps the first "Said:" block as it is.
      onChange({ title: d.title, description: tidiedDescription(d.points, earlier ?? typed), page: d.page, category: d.category, priority: d.priority })
      setTidied({ before, costUsd: d.costUsd })
    } catch { /* the hook reports it */ }
  }

  const tools = (
    <>
      <Button size="sm" variant="ghost" icon={<Sparkles />} loading={draftAi.isPending} disabled={isDraftEmpty(fields) || marked} onClick={() => { void tidyUp() }}
        title={marked ? 'Off while the request has Pick links or review marks: the AI never reads or changes them' : 'AI: turn what you wrote or dictated into a title, page, category, priority and points (English). Your words stay under "Said:", Undo puts everything back'}>Tidy up</Button>
      <Button size="sm" variant="ghost" icon={<Crosshair />} onClick={onPick} tip={`Pick — point at something on the page: a link to it goes where the caret is${mouse ? ' (or Alt-click anything while this window is open)' : ''}`}>Pick</Button>
      {onQuote && (
        // mousedown would clear the page selection before the click reads it.
        <Button size="sm" variant="ghost" icon={<Quote />} onMouseDown={e => e.preventDefault()} onClick={onQuote}>Quote selection</Button>
      )}
    </>
  )

  return (
    <>
      <div
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.repeat && fields.title.trim() && (target.kind === 'new' || editDraft)) { e.preventDefault(); save() }
        }}
        className="scroll-y flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 pt-3">
        {parsed.recheck && <RecheckHeader recheck={parsed.recheck} />}
        <RequestFields
          fields={fields}
          onChange={onChange}
          review={review}
          onTailNote={row ? (key, note) => editTailNote(row, key, note) : undefined}
          status={row ? { value: row.status, onChange: st => updateStatus.mutate({ id: row.id, patch: { status: st } }), disabled: updateStatus.isPending } : undefined}
          titleRef={titleRef}
          outlineRef={outlineRef}
          flash={flash}
          tools={tools}
          showKeys={mouse}
          beforeEditor={
            <>
              {timeline && <p className="-mt-2 flex items-center gap-1.5 text-meta tabular-nums text-fg-muted"><CalendarClock aria-hidden className="h-3.5 w-3.5 shrink-0" />{timeline}</p>}
              {row && reviewable && points.length > 0 && (
                <ReviewBar
                  points={points}
                  sending={sendToRecheck.isPending}
                  onSend={keys => sendToRecheck.mutate({ original: row, keys })}
                  onMarkDone={row.status === 'done' ? undefined : () => markDone(row)}
                />
              )}
            </>
          }
        />
        {tidied && (
          <div role="status" data-tone="info" className="tone-soft flex flex-wrap items-center gap-x-2 gap-y-1 rounded-row border border-[rgb(var(--tone)/0.35)] px-3 py-2 text-meta">
            <Sparkles aria-hidden className="h-3.5 w-3.5 shrink-0 tone-text" />
            <span className="min-w-0 flex-1 text-fg-2">Drafted by AI{costNote(tidied.costUsd) ? ` (${costNote(tidied.costUsd)})` : ''} — check it. Your words are kept under “Said:”.</span>
            <button type="button" className="font-semibold text-accent-600 hover:underline" onClick={() => { onChange(tidied.before); setTidied(null) }}>Undo</button>
            <button type="button" aria-label="Dismiss" className="text-fg-muted hover:text-fg" onClick={() => setTidied(null)}>×</button>
          </div>
        )}
        {target.kind === 'new' && (
          <PageContextToggle start={newDraft.start} checked={newDraft.attachContext} onChange={v => useDevRequestDrafts.getState().patchNewDraft({ attachContext: v })} />
        )}
      </div>
      <footer className="@container flex shrink-0 items-center gap-1.5 border-t border-line bg-surface-2 px-3 py-2.5">
        {row && <IconButton label="Delete request" onClick={() => void remove()} className="-ml-1 text-fg-muted hover:!text-danger"><Trash2 /></IconButton>}
        {target.kind === 'new'
          ? dirty && <Button variant="ghost" size="sm" icon={<Undo2 />} onClick={discardNew}>Discard</Button>
          : editDraft && row && <Button variant="ghost" size="sm" icon={<Undo2 />} onClick={() => discardEditDraft(row)}><span className="@[26rem]:hidden">Discard</span><span className="hidden @[26rem]:inline">Discard changes</span></Button>}
        <span className="ml-auto flex min-w-0 items-center gap-2.5">
          <span className="flex min-w-0 items-center gap-1.5 text-meta text-fg-muted" aria-live="polite">
            {dirty
              ? <><span data-tone="warn" className="tone-dot shrink-0" aria-hidden /><Truncate reveal="none">Unsaved · kept on this device</Truncate></>
              : row ? <><CheckCheck aria-hidden className="h-3.5 w-3.5 shrink-0 text-success" />Saved</> : null}
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon={<FileText />}
            disabled={isDraftEmpty(fields)}
            onClick={() => void composerPrompt.build(target)}
            title={dirty ? 'Build the prompt for Claude from this request as written now (no save needed)' : 'Build the prompt for Claude for this request'}
            className="shrink-0"
          >
            <span className="sr-only @[26rem]:not-sr-only">Prompt</span>
          </Button>
          <Button variant="primary" size="sm" icon={target.kind === 'new' ? <Plus /> : <Check />} loading={pending} disabled={!fields.title.trim() || (target.kind === 'edit' && !editDraft)} onClick={save} title={mouse ? `${target.kind === 'new' ? 'Add request' : 'Save'} (Ctrl/⌘+Enter)` : undefined}>
            {target.kind === 'new' ? 'Add request' : 'Save'}
          </Button>
        </span>
      </footer>
    </>
  )
}

/** A re-check request opens with where its points came from. */
function RecheckHeader({ recheck }: { recheck: RecheckOf }) {
  return (
    <button
      type="button"
      onClick={() => open(recheck.of)}
      title="Open the request these points first came from"
      data-tone="info"
      className="tone-soft flex w-full min-w-0 items-start gap-2.5 rounded-row border border-[rgb(var(--tone)/0.35)] px-3 py-2.5 text-left transition-colors [@media(hover:hover)]:hover:border-[rgb(var(--tone)/0.6)]"
    >
      <CornerUpLeft aria-hidden className="mt-0.5 h-4 w-4 shrink-0 tone-text" />
      <span className="min-w-0 flex-1">
        <span className="block text-micro font-semibold uppercase tracking-[0.08em] tone-text">Re-check of</span>
        <span className="flex min-w-0 items-center gap-1">
          <Truncate className="min-w-0 text-body font-semibold text-fg">{cleanText(recheck.title, 80) || 'a request'}</Truncate>
          <ArrowUpRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
        </span>
        <span className="block text-meta text-fg-muted">These points went to Claude before and the fix did not work.</span>
      </span>
    </button>
  )
}

/** Above the points once the request went to Claude: progress and what to do next. */
function ReviewBar({ points, sending, onSend, onMarkDone }: {
  points: ReturnType<typeof requestPoints>
  sending: boolean
  onSend: (keys: string[]) => void
  onMarkDone?: () => void
}) {
  const c = reviewCounts(points)
  const notFixed = notFixedKeys(points)
  const resolved = allResolved(points)
  const reviewed = c.fixed + c.notFixed + c.moved
  return (
    <section aria-label="Review" className="flex flex-col gap-2.5 rounded-row border border-line bg-surface-2 px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-surface text-fg-muted shadow-card"><ListChecks aria-hidden className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold text-fg">Check the work</span>
          <span className="block text-meta tabular-nums text-fg-muted">
            {reviewed === 0 ? `Mark each of the ${c.total} point${c.total === 1 ? '' : 's'} Fixed or Not fixed` : [
              `${c.fixed} of ${c.total} fixed`, c.notFixed ? `${c.notFixed} not fixed` : '', c.moved ? `${c.moved} moved` : '',
            ].filter(Boolean).join(' · ')}
          </span>
        </span>
      </div>
      <ReviewMeter points={points} />
      {(notFixed.length > 0 || (resolved && onMarkDone)) && (
        <div className="flex flex-wrap items-center gap-2">
          {notFixed.length > 0 && (
            <Button size="sm" icon={<Send />} loading={sending} onClick={() => onSend(notFixed)} tip={`Re-check — send the ${notFixed.length} not fixed points as one re-check request`}>
              Re-check · {notFixed.length}
            </Button>
          )}
          {resolved && onMarkDone && <Button size="sm" icon={<CheckCheck />} onClick={onMarkDone} tip="Done — mark the request done">Done</Button>}
        </div>
      )}
    </section>
  )
}
