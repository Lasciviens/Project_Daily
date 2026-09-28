import { useMemo } from 'react'
import { Copy } from 'lucide-react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button } from '../../../shared/ui'
import { toast } from '../../../app/store'
import { buildClaudePrompt } from '../devRequestPrompt'
import type { DevRequest } from '../types'

interface Props {
  requests: DevRequest[]
  onClose: () => void
}

/** Shows the prompt built from the picked requests, ready to copy into Claude. */
export function ClaudePromptModal({ requests, onClose }: Props) {
  const prompt = useMemo(() => buildClaudePrompt(requests), [requests])

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt)
      toast.success('Prompt copied')
    } catch {
      toast.error("Couldn't copy — select the text and copy it by hand")
    }
  }

  return (
    <ModalShell
      open
      onClose={onClose}
      title="Prompt for Claude"
      subtitle={`${requests.length} request${requests.length === 1 ? '' : 's'}`}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button icon={<Copy />} onClick={() => void copy()}>Copy prompt</Button>
        </div>
      }
    >
      <textarea
        readOnly
        value={prompt}
        onFocus={e => e.currentTarget.select()}
        className="h-[50dvh] w-full resize-none rounded-row border border-line bg-surface-2 p-3 font-mono text-meta text-fg"
      />
    </ModalShell>
  )
}
