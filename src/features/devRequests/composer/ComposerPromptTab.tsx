import { useState, type Ref } from 'react'
import { ChevronRight, Copy, RotateCcw, Sparkles } from 'lucide-react'
import { useDevRequestDrafts } from '../devRequestDraftStore'
import { descriptionPreview } from '../devRequestContext'
import { buildClaudePrompt } from '../devRequestPrompt'
import { useDevRequests, useMarkDevRequestsPrompted } from '../hooks/useDevRequests'
import { toast, useUIStore } from '../../../app/store'
import { Button, EmptyState, Skeleton, Truncate, cx } from '../../../shared/ui'

/**
 * The prompt for Claude, built from the requests ticked in the drawer — and
 * editable here: your wording stays (it is saved with the drafts) until you
 * reset it to the generated one.
 */
export function ComposerPromptTab({ textareaRef }: { textareaRef?: Ref<HTMLTextAreaElement> }) {
  const prompt = useDevRequestDrafts(s => s.prompt)
  const { data: requests = [], isLoading } = useDevRequests()
  const [showList, setShowList] = useState(false)
  const markPrompted = useMarkDevRequestsPrompted()
  const rows = prompt.ids.map(id => requests.find(r => r.id === id)).filter(r => r != null)
  // Until the list has loaded, every picked request would read as deleted.
  const count = isLoading ? prompt.ids.length : rows.length
  const missing = isLoading ? 0 : prompt.ids.length - rows.length

  function changeSelection() {
    const picked = isLoading ? prompt.ids : rows.map(r => r.id)
    useDevRequestDrafts.getState().setDrawer({ picked })
    if (!useUIStore.getState().isDevRequestsOpen) useUIStore.getState().toggleDevRequests()
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt.text)
      toast.success('Prompt copied')
      // The requests now wait for a check ("Prompted" on their cards).
      if (rows.length) markPrompted.mutate(rows.map(r => r.id))
    } catch {
      toast.error("Couldn't copy — select the text and copy it by hand")
    }
  }

  if (!prompt.text.trim() && prompt.ids.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-center p-3">
        <EmptyState
          icon={<Sparkles />}
          title="No prompt yet"
          description="Tick requests in the Requests drawer (their circles), then Build prompt. You can edit the result here."
          action={<Button size="sm" onClick={changeSelection}>Pick requests</Button>}
        />
      </div>
    )
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowList(v => !v)}
            aria-expanded={showList}
            className="-ml-1 flex min-h-[36px] min-w-0 flex-1 items-center gap-1 rounded-control px-1 text-left text-meta font-semibold text-fg-muted [@media(hover:hover)]:hover:text-fg [@media(pointer:coarse)]:min-h-[44px]"
          >
            <ChevronRight className={cx('h-4 w-4 shrink-0 transition-transform', showList && 'rotate-90')} aria-hidden />
            <Truncate>{`${count} request${count === 1 ? '' : 's'}${missing > 0 ? ` · ${missing} deleted` : ''}${prompt.edited ? ' · edited' : ''}`}</Truncate>
          </button>
          <Button size="sm" variant="ghost" onClick={changeSelection}>Change</Button>
        </div>
        {showList && isLoading && <Skeleton className="h-10 rounded-row" />}
        {showList && !isLoading && (
          <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {rows.map(r => (
              <li key={r.id} className="rounded-row border border-line bg-surface-2 px-2.5 py-1.5">
                <Truncate className="text-body font-medium text-fg">{r.title}</Truncate>
                {descriptionPreview(r.description) && <Truncate lines={2} className="text-meta text-fg-muted">{descriptionPreview(r.description)}</Truncate>}
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={textareaRef}
          value={prompt.text}
          onChange={e => useDevRequestDrafts.getState().editPrompt(e.target.value)}
          aria-label="Prompt for Claude"
          spellCheck={false}
          className="input min-h-[14rem] flex-1 resize-none font-mono text-meta"
        />
      </div>
      <footer className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2.5">
        <Button
          variant="ghost"
          size="sm"
          icon={<RotateCcw />}
          disabled={!prompt.edited || rows.length === 0}
          onClick={() => useDevRequestDrafts.getState().setPrompt(rows.map(r => r.id), buildClaudePrompt(rows))}
          title="Throw your edits away and build the prompt again from the picked requests"
        >
          Reset to generated
        </Button>
        <Button variant="primary" size="sm" icon={<Copy />} disabled={!prompt.text.trim()} onClick={() => void copy()} className="ml-auto">
          Copy prompt
        </Button>
      </footer>
    </>
  )
}
