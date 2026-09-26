import { useState, type ReactNode } from 'react'
import { Minus, Plus } from 'lucide-react'
import { ModalShell } from '../../../shared/modals'
import { IconButton, SegmentedControl } from '../../../shared/ui'
import { useAthleteProfile, useUpsertAthleteProfile } from '../hooks/useAthleteProfile'
import type { Equipment, ExperienceLevel, TrainingGoal } from '../types.athlete'
import { LimitationsList } from './LimitationsList'
import { MusclePreferencesList } from './MusclePreferencesList'
import { CurrentProgramPicker } from './CurrentProgramPicker'

// Settings-style form, not a save-and-close dialog: every field autosaves on
// change/blur (same convention as the Food Today Goals editor's pills/steppers
// and Media's `personal_note` "saves on blur") — so there is no Save/Cancel
// footer here, the header × is the only way out. `useUpsertAthleteProfile`
// already carries its own success toast ("Profile saved"), so each tap gets
// the mandatory feedback without this component wiring any of its own.

const GOAL_OPTIONS: { value: TrainingGoal; label: string }[] = [
  { value: 'strength',    label: 'Strength' },
  { value: 'hypertrophy', label: 'Hypertrophy' },
  { value: 'fat_loss',    label: 'Fat loss' },
  { value: 'general',     label: 'General' },
]

const EXPERIENCE_OPTIONS: { value: ExperienceLevel; label: string }[] = [
  { value: 'novice',       label: 'Novice' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced',     label: 'Advanced' },
]

const EQUIPMENT_OPTIONS: { value: Equipment; label: string }[] = [
  { value: 'home', label: 'Home' },
  { value: 'gym',  label: 'Gym' },
  { value: 'both', label: 'Both' },
]

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="field-label">{label}</p>
      {children}
    </div>
  )
}

function DaysStepper({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  const v = value ?? 3
  const set = (n: number) => onChange(Math.min(7, Math.max(1, n)))
  return (
    <div className="flex items-center gap-2">
      <IconButton label="Fewer days" bordered onClick={() => set(v - 1)} disabled={v <= 1} className="disabled:opacity-40"><Minus /></IconButton>
      <span className="w-20 text-center text-ui font-semibold tabular-nums text-fg">{v} {v === 1 ? 'day' : 'days'}</span>
      <IconButton label="More days" bordered onClick={() => set(v + 1)} disabled={v >= 7} className="disabled:opacity-40"><Plus /></IconButton>
    </div>
  )
}

interface Props {
  open: boolean
  onClose: () => void
}

export function AthleteProfileSheet({ open, onClose }: Props) {
  const { data: profile } = useAthleteProfile()
  const upsert = useUpsertAthleteProfile()

  // Local buffer for the free-text field only (autosaves on blur, not per
  // keystroke, so it doesn't toast on every letter); pills/stepper write
  // straight through on tap. `null` = "untouched this session" — derive from
  // `profile.notes` at render time instead of syncing via an effect (setState
  // inside an effect body causes an extra cascading render on every fetch/
  // invalidation); once the user types, their draft wins over any background
  // refetch until they blur, same as WishSheet's key-seeded draft achieves by
  // remounting instead.
  const [notesDraft, setNotesDraft] = useState<string | null>(null)
  const notes = notesDraft ?? profile?.notes ?? ''

  return (
    <ModalShell open={open} onClose={onClose} title="Training profile" size="md">
      <div className="flex flex-col gap-5">
        <Field label="Goal">
          <SegmentedControl<TrainingGoal>
            value={profile?.goal ?? ('' as TrainingGoal)}
            onChange={goal => upsert.mutate({ goal })}
            options={GOAL_OPTIONS}
            size="sm"
            fullWidth
          />
        </Field>

        <Field label="Experience">
          <SegmentedControl<ExperienceLevel>
            value={profile?.experience_level ?? ('' as ExperienceLevel)}
            onChange={experience_level => upsert.mutate({ experience_level })}
            options={EXPERIENCE_OPTIONS}
            size="sm"
            fullWidth
          />
        </Field>

        <Field label="Training days per week">
          <DaysStepper
            value={profile?.training_days_per_week ?? null}
            onChange={training_days_per_week => upsert.mutate({ training_days_per_week })}
          />
        </Field>

        <Field label="Equipment access">
          <SegmentedControl<Equipment>
            value={profile?.equipment_access ?? ('' as Equipment)}
            onChange={equipment_access => upsert.mutate({ equipment_access })}
            options={EQUIPMENT_OPTIONS}
            size="sm"
            fullWidth
          />
        </Field>

        <Field label="Notes — nuance the pills can't capture">
          <textarea
            value={notes}
            onChange={e => setNotesDraft(e.target.value)}
            onBlur={() => {
              if (notes !== (profile?.notes ?? '')) upsert.mutate({ notes: notes.trim() || null })
            }}
            rows={3}
            placeholder='e.g. "shoulder flares up above 70% on overhead work"'
            className="input w-full py-2"
          />
        </Field>

        <div className="border-t border-line pt-4">
          <LimitationsList />
        </div>

        <div className="border-t border-line pt-4">
          <MusclePreferencesList />
        </div>

        <div className="border-t border-line pt-4">
          <p className="field-label">Current program</p>
          <CurrentProgramPicker />
        </div>
      </div>
    </ModalShell>
  )
}
