import { useState } from 'react'
import { UserRound } from 'lucide-react'
import { Button, Card, CardHeader, Skeleton } from '../../../../shared/ui'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { useAthleteProfile } from '../../../training/hooks/useAthleteProfile'
import { ageOn, toHealthProfile, type HealthProfile } from '../../benchmarks/healthBenchmarks'
import { HealthProfileForm } from './HealthProfileForm'

// The Health page's profile card. Incomplete → the form shows inline so the
// reference ranges can be unlocked in place; complete → a one-line summary
// with an Edit toggle, so a filled-in profile doesn't take up the page.

function summaryParts(p: HealthProfile, age: number | null): string[] {
  const parts: string[] = []
  if (p.sex) parts.push(p.sex === 'male' ? 'Male' : 'Female')
  if (age != null && p.birthYear != null) parts.push(`${age} years (born ${p.birthYear})`)
  if (p.heightCm != null) parts.push(`${p.heightCm.toLocaleString('en-GB', { maximumFractionDigits: 1 })} cm`)
  return parts
}

export function HealthProfileCard({ className }: { className?: string }) {
  const { data: row, isLoading, isError, refetch } = useAthleteProfile()
  const [editing, setEditing] = useState(false)
  const profile = toHealthProfile(row)
  const age = ageOn(profile, todayStr())
  const complete = profile.birthYear != null && profile.sex != null && profile.heightCm != null
  const showForm = editing || !complete

  return (
    <Card className={className}>
      <CardHeader
        icon={<UserRound />}
        title="Your profile"
        subtitle="Picks the age and sex reference ranges"
        action={complete && !isLoading && !isError
          ? <Button size="sm" variant="ghost" onClick={() => setEditing(e => !e)}>{editing ? 'Done' : 'Edit'}</Button>
          : null}
      />

      {isLoading ? (
        <div className="@container"><div className="grid gap-3 @lg:grid-cols-3" aria-busy="true">
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
        </div></div>
      ) : isError ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-meta text-danger">Couldn’t load your profile.</p>
          <Button size="sm" onClick={() => refetch()}>Try again</Button>
        </div>
      ) : showForm ? (
        <>
          <HealthProfileForm />
          {!complete && (
            <p className="mt-3 text-meta text-fg-muted">
              Birth year and sex let the page compare your numbers with people your age; height adds BMI and waist-to-height. Nothing else uses them.
            </p>
          )}
        </>
      ) : (
        <p className="text-body text-fg">{summaryParts(profile, age).join(' · ')}</p>
      )}
    </Card>
  )
}
