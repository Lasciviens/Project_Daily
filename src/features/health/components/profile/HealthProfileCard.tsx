import { Link } from 'react-router-dom'
import { ChevronRight, UserRound } from 'lucide-react'
import { Card, CardHeader } from '../../../../shared/ui'

// Shown on Health → Overview only while birth year, sex or height is missing:
// they are edited in Settings → Profile (owner, 16.10.2026: the profile
// "should be under settings"), so this card only says what they unlock and
// links there.
export function HealthProfileCard({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader icon={<UserRound />} title="Add your age, sex and height" subtitle="Unlocks the reference ranges for people your age, BMI and waist-to-height" />
      <Link to="/settings?tab=profile" className="btn-secondary btn-sm inline-flex gap-1">
        Open Settings → Profile<ChevronRight aria-hidden className="h-4 w-4" />
      </Link>
    </Card>
  )
}
