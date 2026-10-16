import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { Clock, X } from 'lucide-react'
import { Time24Field } from '../../../shared/components/plan-modal/fields'
import { chipClass, CHIP_PANEL_CLASS } from '../../../shared/components/plan-modal/fieldStyles'
import { shiftTime } from '../../../shared/components/plan-modal/planModal.config'

/** A time of day as a sheet chip ("08:00"): tap for the hour / minute picker; × takes it off. */
export function TimeChip({ value, onChange, onRemove, label }: {
  value: string
  onChange: (t: string) => void
  onRemove?: () => void
  /** Accessible name ("Dose time", "Remind until"). */
  label: string
}) {
  return (
    <span className="inline-flex items-center">
      <Popover className="contents">
        <PopoverButton className={chipClass('set', onRemove ? 'rounded-r-none pr-1.5' : undefined)} aria-label={`${label}: ${value}`}>
          <Clock aria-hidden />{value}
        </PopoverButton>
        <PopoverPanel anchor="bottom start" modal={false} className={CHIP_PANEL_CLASS}>
          <Time24Field size="sm" value={value} onChange={onChange} onShift={d => onChange(shiftTime(value, d))} />
        </PopoverPanel>
      </Popover>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${value}`}
          className={chipClass('set', 'rounded-l-none !px-1.5 text-fg-muted hover:text-danger')}>
          <X aria-hidden />
        </button>
      )}
    </span>
  )
}
