import { ModalShell } from '../../../../shared/modals'
import { HealthProfileForm } from './HealthProfileForm'

/** The same profile form in a sheet — for a header button or a "set your age"
 *  prompt next to a reference range. Fields save as you go, so × is the only exit. */
export function HealthProfileSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <ModalShell open={open} onClose={onClose} title="Your health profile" size="sm">
      <p className="mb-4 text-meta text-fg-muted">
        Used only to pick the age- and sex-matched reference ranges on the Health page, and for BMI and waist-to-height.
      </p>
      <HealthProfileForm />
    </ModalShell>
  )
}
