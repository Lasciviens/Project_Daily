import { useDevRequestDrafts } from '../devRequestDraftStore'
import { draftFromRow, isDraftEmpty, sameTarget, type ComposerTarget } from '../devRequestRules'
import { buildClaudePrompt, promptRequestFromDraft, type PromptRequest } from '../devRequestPrompt'
import { useDevRequests, useMarkDevRequestsPrompted } from '../hooks/useDevRequests'
import { usePageContextReader } from '../pick/usePageContext'
import { useEntityModal } from '../../../shared/modals'

/**
 * The request window's own Prompt button: the prompt for THIS request, built
 * from what the window holds right now — an unsaved new request or unsaved
 * edits included, nothing saved first. A saved request is marked Prompted at
 * once (as Build prompt in the list does); a new one has no row to mark yet,
 * so it is marked when it is added (useSaveDevRequestDraft). Back from the
 * prompt returns to the request with its draft as it was.
 */
export function useComposerPrompt() {
  const { data: requests } = useDevRequests()
  const readPage = usePageContextReader()
  const markPrompted = useMarkDevRequestsPrompted()
  const modal = useEntityModal()

  /** The request `target` names as the prompt would see it now (null: nothing written, or gone). */
  function draftRequest(target: ComposerTarget): PromptRequest | null {
    const s = useDevRequestDrafts.getState()
    if (target.kind === 'new') {
      const d = s.newDraft
      if (isDraftEmpty(d)) return null
      // The page mark the request gets when it is added (unless unticked).
      const now = readPage()
      return promptRequestFromDraft(d, d.attachContext ? { type: 'page', start: d.start ?? now, savedOn: now } : null)
    }
    const row = requests?.find(r => r.id === target.id)
    if (!row) return null
    return promptRequestFromDraft(s.editDrafts[target.id] ?? draftFromRow(row))
  }

  async function build(target: ComposerTarget) {
    const req = draftRequest(target)
    if (!req) return
    const s = useDevRequestDrafts.getState()
    const same = sameTarget(s.prompt.from, target)
    if (s.prompt.edited && s.prompt.text.trim() && !same) {
      const ok = await modal.confirm({
        title: 'Replace your edited prompt?',
        message: 'The prompt has your own edits. Building one for this request replaces them.',
        confirmLabel: 'Replace',
      })
      if (!ok) return
    }
    const ids = target.kind === 'edit' ? [target.id] : []
    // Your own wording of this request's prompt is kept (Reset rebuilds it).
    if (!(same && s.prompt.edited)) s.setPrompt(ids, buildClaudePrompt([req]), target)
    if (ids.length) markPrompted.mutate(ids)
    s.setComposerTab('prompt')
  }

  /** Reset to generated, for a prompt built in the window. */
  function rebuild(target: ComposerTarget) {
    const req = draftRequest(target)
    if (!req) return
    useDevRequestDrafts.getState().setPrompt(target.kind === 'edit' ? [target.id] : [], buildClaudePrompt([req]), target)
  }

  return { build, rebuild, draftRequest }
}
