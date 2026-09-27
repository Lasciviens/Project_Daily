import { useState } from 'react'
import { UserRound } from 'lucide-react'
import { cx } from '../../../../shared/ui'
import { useHealthProfile } from '../../../training/hooks/useAthleteProfile'
import { ageOn } from '../../benchmarks/healthBenchmarks'
import { HealthProfileSheet } from '../profile/HealthProfileSheet'

// Header chip: who the reference ranges are for ("Male · 35 · 182 cm"), one tap
// to edit. Incomplete → an accent prompt, since the ranges fall back to
// generic text without age and sex.
export function ProfileChip({ today }: { today: string }) {
  const [open, setOpen] = useState(false)
  const { data: p } = useHealthProfile()
  const age = ageOn(p, today)
  const parts = [
    p?.sex ? (p.sex === 'male' ? 'Male' : 'Female') : null,
    age != null ? `${age}` : null,
    p?.heightCm != null ? `${p.heightCm.toLocaleString('en-GB', { maximumFractionDigits: 1 })} cm` : null,
  ].filter(Boolean)
  const complete = parts.length === 3
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog"
        className={cx('inline-flex min-h-[44px] items-center gap-2 rounded-full border px-3 text-meta font-medium',
          complete ? 'border-line bg-surface text-fg-2 hover:bg-surface-hover' : 'border-accent-500 bg-accent-50 text-accent-600')}>
        <UserRound aria-hidden className="h-4 w-4" />
        {complete ? parts.join(' · ') : 'Add age, sex and height'}
      </button>
      <HealthProfileSheet open={open} onClose={() => setOpen(false)} />
    </>
  )
}
