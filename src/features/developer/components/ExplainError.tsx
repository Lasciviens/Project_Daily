import { useEffect, useRef, useState } from 'react'
import { Plus, Sparkles } from 'lucide-react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, IconButton, Skeleton, TonePill } from '../../../shared/ui'
import { toast } from '../../../app/store'
import { useExplainError } from '../../ai/claude/hooks/useAiFeatures'
import { outlineOf } from '../../ai/claude/featureRules'
import { useDevRequestDrafts } from '../../devRequests/devRequestDraftStore'
import { isDraftEmpty } from '../../devRequests/devRequestRules'
import { PAGE_OPTIONS } from '../../devRequests/components/devRequestMeta'
import type { ErrorLog } from '../hooks/useLogs'

/** The page an error happened on, when its recorded route is one of the app's own pages (else "other"). */
function pageOfRoute(context: ErrorLog['context']): string {
  const route = typeof context?.route === 'string' ? context.route.replace(/^#/, '').split(/[?#]/)[0] : ''
  return PAGE_OPTIONS.includes(route) ? route : 'other'
}

/**
 * "Explain" on one error: what it means in plain English (the technical words explained: the owner is learning
 * them) and a Dev Request draft. The error is scrubbed of secrets before it is sent. Nothing is saved: "Create Dev
 * Request" only fills the request window, which the owner reads and saves herself.
 */
function ExplainSheet({ log, onClose }: { log: ErrorLog; onClose: () => void }) {
  const explain = useExplainError()
  const { mutate } = explain
  // Asked once when the sheet opens (a second render, or React's double mount in development, never asks again).
  const asked = useRef(false)
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    mutate({ message: log.message, context: log.context })
  }, [mutate, log.message, log.context])
  const answer = explain.data

  function createRequest() {
    if (!answer) return
    const store = useDevRequestDrafts.getState()
    // An unsaved request in the window is the owner's: never overwritten.
    if (!isDraftEmpty(store.newDraft)) { toast.info('Your open request has text in it — save or discard it first, then try again'); return }
    store.patchNewDraft({
      title: answer.request.title, description: outlineOf(answer.request.points), page: pageOfRoute(log.context),
      category: answer.request.category, priority: answer.request.priority, attachContext: false,
    })
    store.openComposer({ kind: 'new' })
    onClose()
  }

  return (
    <ModalShell onClose={onClose} title="Explain this error" subtitle="In plain English — an AI reading, so check it" size="md" compact
      footer={
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} className="ml-auto">Close</Button>
          {answer && <Button size="sm" variant="primary" icon={<Plus />} onClick={createRequest}>Create Dev Request</Button>}
        </div>
      }>
      <div className="flex flex-col gap-3">
        <p className="line-clamp-3 break-words rounded-row bg-surface-2 px-3 py-2 font-mono text-meta text-fg-2">{log.message}</p>
        {explain.isPending && (
          <div className="flex flex-col gap-2" aria-busy="true"><Skeleton className="h-4" /><Skeleton className="h-4 w-11/12" /><Skeleton className="h-4 w-4/5" /></div>
        )}
        {explain.isError && <Button size="sm" onClick={() => mutate({ message: log.message, context: log.context })}>Try again</Button>}
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
                <TonePill tone="neutral">{answer.request.category}</TonePill>
                <TonePill tone="neutral">{answer.request.priority}</TonePill>
              </div>
              <p className="break-words text-body font-semibold text-fg">{answer.request.title}</p>
              {answer.request.points.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-5 text-meta text-fg-muted">{answer.request.points.map((p, i) => <li key={i}>{p}</li>)}</ul>}
            </div>
          </>
        )}
      </div>
    </ModalShell>
  )
}

/** The Explain button of an error row, with its sheet. */
export function ExplainButton({ log }: { log: ErrorLog }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <IconButton label="Explain this error" onClick={() => setOpen(true)}><Sparkles /></IconButton>
      {open && <ExplainSheet log={log} onClose={() => setOpen(false)} />}
    </>
  )
}
