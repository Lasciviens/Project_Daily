import type { ReactNode } from 'react'
import { UserRound } from 'lucide-react'
import { Card, CardHeader, PageBoard } from '../../../shared/ui'
import { HealthProfileForm } from '../../health/components/profile/HealthProfileForm'
import { PROFILE_BOARD, type ProfileSection } from '../settingsBoards'

// Settings → Profile: birth year, sex and height (athlete_profile, migration
// 110) — moved here from the Health page's header chip (owner, 16.10.2026:
// the profile chip "should be under settings"). The fields save as you
// go (HealthProfileForm); Health reads them for its reference ranges.
export function ProfileTab() {
  const sections: Record<ProfileSection, ReactNode> = {
    body: (
      <Card>
        <CardHeader
          icon={<UserRound />}
          title="Health profile"
          subtitle="Picks the age- and sex-matched reference ranges on Health, and BMI and waist-to-height"
        />
        <HealthProfileForm />
      </Card>
    ),
  }
  return <PageBoard sections={sections} layout={PROFILE_BOARD} stackClassName="max-w-2xl" />
}
