import { Button } from '../../../shared/ui'

// A delete or Hevy routine change the assistant proposed. Nothing happens until
// the person taps Confirm here — ai-proxy runs the stored action only for this
// request (security audit 10.10.2026).
export interface ChatConfirm {
  id: string
  summary: string
  state?: 'busy' | 'confirmed' | 'cancelled'
}

interface Props {
  confirms: ChatConfirm[]
  onDecide: (id: string, decision: 'confirm' | 'cancel') => void
}

export function ConfirmCards({ confirms, onDecide }: Props) {
  return (
    <div className="flex w-full flex-col gap-2">
      {confirms.map(c => (
        <div key={c.id} className="rounded-card border border-line bg-surface px-3.5 py-3">
          <p className="text-body text-fg">{c.summary}</p>
          {c.state === 'confirmed' || c.state === 'cancelled' ? (
            <p className="mt-1.5 text-meta text-fg-muted">{c.state === 'confirmed' ? 'Confirmed' : 'Cancelled — nothing was changed'}</p>
          ) : (
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Button variant="danger" size="sm" className="min-h-[44px]" loading={c.state === 'busy'}
                disabled={c.state === 'busy'} onClick={() => onDecide(c.id, 'confirm')}>
                Confirm
              </Button>
              <Button variant="secondary" size="sm" className="min-h-[44px]"
                disabled={c.state === 'busy'} onClick={() => onDecide(c.id, 'cancel')}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
