import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw, Sparkles } from 'lucide-react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, IconButton, Skeleton, TonePill, Truncate } from '../../../shared/ui'
import { qk } from '../../../shared/query'
import { toast } from '../../../app/store'
import { useExplainError } from '../../ai/claude/hooks/useAiFeatures'
import { costNote, outlineOf, scrubErrorForAi } from '../../ai/claude/featureRules'
import type { ErrorExplanation } from '../../ai/claude/featureJobs'
import { useDevRequestDrafts } from '../../devRequests/devRequestDraftStore'
import { isDraftEmpty } from '../../devRequests/devRequestRules'
import { CATEGORY_TONE, PAGE_OPTIONS, PRIORITY_TONE } from '../../devRequests/components/devRequestMeta'
import type { ErrorLog } from '../hooks/useLogs'

/** The page an error happened on, when its recorded route is one of the app's own pages (else "other"). */
function pageOfRoute(context: ErrorLog['context']): string {
  const route = typeof context?.route === 'string' ? context.route.replace(/^#/, '').split(/[?#]/)[0] : ''
  return PAGE_OPTIONS.includes(route) ? route : 'other'
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * "Explain" on one error: what it means in plain English (the technical words explained: the owner is learning
 * them) and a Dev Request draft. The error is scrubbed of secrets before it is sent. The answer is kept for this
 * error while the app is open (a paid call is never made twice by opening the sheet again; "Explain again" is the
 * owner's own second call). Nothing is saved: "Create Dev Request" only fills the request window, which the owner
 * reads and saves herself.
 */
function ExplainSheet({ log, onClose }: { log: ErrorLog; onClose: () => void }) {
  const qc = useQueryClient()
  const key = qk.aiCalls.explain(log.id)
  const explain = useExplainError()
  const { mutate } = explain
  const [answer, setAnswer] = useState<ErrorExplanation | null>(() => qc.getQueryData<ErrorExplanation>(key) ?? null)

  function run() {
    mutate({ message: log.message, context: log.context }, { onSuccess: a => { setAnswer(a); qc.setQueryData(key, a) } })
  }
  // Asked once when the sheet opens with nothing kept (a second render, or React's double mount in development, never asks again).
  const asked = useRef(false)
  useEffect(() => {
    if (asked.current || answer) return
    asked.current = true
    mutate({ message: log.message, context: log.context }, { onSuccess: a => { setAnswer(a); qc.setQueryData(key, a) } })
  }, [mutate, log.message, log.context, answer, qc, key])

  function createRequest() {
    if (!answer) return
    const store = useDevRequestDrafts.getState()
    // An unsaved request in the window is the owner's: never overwritten.
    if (!isDraftEmpty(store.newDraft)) { toast.info('Your open request has text in it — save or discard it first, then try again'); return }
    // The draft says what it is: AI-written, from this error (its message scrubbed once more).
    const points = [...answer.request.points, `Drafted by AI from an error: ${scrubErrorForAi(log.message, 200)}`]
    store.patchNewDraft({
      title: answer.request.title, description: outlineOf(points), page: pageOfRoute(log.context),
      category: answer.request.category, priority: answer.request.priority, attachContext: false,
    })
    store.openComposer({ kind: 'new' })
    onClose()
  }

  return (
    <ModalShell onClose={onClose} title="Explain this error" subtitle="AI reading, in plain English — check it" size="md" compact
      footer={
        <div className="flex items-center gap-2">
          {answer && <Button size="sm" variant="ghost" icon={<RefreshCw />} loading={explain.isPending} onClick={run}>Explain again</Button>}
          <Button size="sm" variant="ghost" onClick={onClose} className="ml-auto">Close</Button>
          {answer && <Button size="sm" variant="primary" icon={<Plus />} onClick={createRequest} tip="Request — create a Dev Request">Request</Button>}
        </div>
      }>
      <div className="flex flex-col gap-3">
        <Truncate as="p" lines={3} className="break-words rounded-row bg-surface-2 px-3 py-2 font-mono text-meta text-fg-2">{log.message}</Truncate>
        {!answer && explain.isPending && (
          <div className="flex flex-col gap-2" aria-busy="true"><Skeleton className="h-4" /><Skeleton className="h-4 w-11/12" /><Skeleton className="h-4 w-4/5" /></div>
        )}
        {!answer && explain.isError && <Button size="sm" onClick={run}>Try again</Button>}
        {answer && (
          <>
            <p className="whitespace-pre-line break-words text-body text-fg">{answer.explanation}</p>
            {answer.terms.length > 0 && (
              <div>
                <p className="field-label mb-1">Words used</p>
                <dl className="flex flex-col gap-1.5">
                  {answer.terms.map(t => (
                    <div key={t.term} className="text-meta"><dt className="inline font-semibold text-fg">{t.term}</dt> <dd className="inline text-fg-muted">— {t.meaning}</dd></div>
                  ))}
                </dl>
              </div>
            )}
            <div className="rounded-row border border-line bg-surface-2 p-3">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <span className="section-label">Draft request</span>
                <TonePill tone={CATEGORY_TONE[answer.request.category]}>{cap(answer.request.category)}</TonePill>
                <TonePill tone={PRIORITY_TONE[answer.request.priority]}>{cap(answer.request.priority)}</TonePill>
              </div>
              <p className="break-words text-body font-semibold text-fg">{answer.request.title}</p>
              {answer.request.points.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-5 text-meta text-fg-muted">{answer.request.points.map((p, i) => <li key={i}>{p}</li>)}</ul>}
            </div>
            {costNote(answer.costUsd) && <p className="text-meta tabular-nums text-fg-muted">AI call {costNote(answer.costUsd)}</p>}
          </>
        )}
      </div>
    </ModalShell>
  )
}

/** The Explain button of an error row (the ✨ means "AI call", as everywhere), with its sheet. */
export function ExplainButton({ log }: { log: ErrorLog }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <IconButton label="Explain this error (AI)" onClick={() => setOpen(true)}><Sparkles /></IconButton>
      {open && <ExplainSheet log={log} onClose={() => setOpen(false)} />}
    </>
  )
}
