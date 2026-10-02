import { useEffect, useState } from 'react'
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { Bell, BellRing } from 'lucide-react'
import { Button } from '../../../shared/ui'
import { usePushNotifications } from '../../../shared/hooks/usePushNotifications'
import { formatDate } from '../../../shared/utils/dateFormat'
import { todayStr } from '../../../shared/utils/dateUtils'
import { OFFSET_LABEL, OFFSET_SHORT, REMINDER_OFFSETS } from '../reminders/reminderRules'
import { useReleaseReminder, useSaveReminder } from '../reminders/useReminders'
import type { MediaType } from '../types'

/**
 * A bell on a title that isn't out yet: tick when to be reminded (a month, a
 * week, a day before, release day). Sent as a lock-screen push with the
 * morning push (Web Push must be on for this phone).
 */
export function ReleaseReminderButton({ type, tmdbId, title, posterPath, releaseDate }: {
  type: MediaType; tmdbId: number; title: string; posterPath: string | null; releaseDate: string | null
}) {
  const upcoming = !!releaseDate && releaseDate > todayStr()
  const reminder = useReleaseReminder(type, tmdbId, upcoming)
  const save = useSaveReminder()
  const push = usePushNotifications()
  const [draft, setDraft] = useState<number[] | null>(null)
  // Opening the page refreshes a reminder whose date TMDB moved (once).
  const stored = reminder.data
  const moved = !!stored && !!releaseDate && stored.release_date !== releaseDate
  const { mutate } = save
  useEffect(() => {
    if (moved && stored && releaseDate) mutate({ type, tmdbId, title, posterPath, releaseDate, offsets: stored.offsets, prev: stored })
  }, [moved]) // eslint-disable-line react-hooks/exhaustive-deps -- only when the date differs
  if (!upcoming || !releaseDate) return null
  const current = reminder.data?.offsets ?? []
  const picked = draft ?? current
  const toggle = (o: number) => setDraft(picked.includes(o) ? picked.filter(x => x !== o) : [...picked, o])
  const label = current.length ? `Remind · ${[...current].sort((a, b) => b - a).map(o => OFFSET_SHORT[o as 30]).join(', ')}` : 'Remind me'

  return (
    <Popover className="relative">
      <PopoverButton as={Button} size="sm" variant={current.length ? 'primary' : 'ghost'} icon={current.length ? <BellRing /> : <Bell />} onClick={() => setDraft(null)}>
        {label}
      </PopoverButton>
      <PopoverPanel anchor="bottom start" className="z-popover mt-1 w-[min(18rem,calc(100vw-24px))] rounded-row border border-line bg-surface p-3 shadow-lg">
        {({ close }) => (
          <div className="flex flex-col gap-2">
            <p className="text-meta text-fg-muted">Out {formatDate(releaseDate)}. Remind me:</p>
            {REMINDER_OFFSETS.map(o => (
              <label key={o} className="flex min-h-[40px] cursor-pointer items-center gap-2 text-body text-fg">
                <input type="checkbox" checked={picked.includes(o)} onChange={() => toggle(o)} />
                {OFFSET_LABEL[o]}
              </label>
            ))}
            {push.supported && !push.enabled && (
              <p data-tone="warn" className="tone-text text-micro">Push is off on this device — turn it on in the ⚙ menu → Notifications (on the phone: the installed app).</p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button size="sm" variant="ghost" onClick={() => close()}>Cancel</Button>
              <Button size="sm" variant="primary" loading={save.isPending}
                onClick={() => save.mutate({ type, tmdbId, title, posterPath, releaseDate, offsets: picked, prev: reminder.data ?? null }, { onSuccess: () => close() })}>
                Save
              </Button>
            </div>
          </div>
        )}
      </PopoverPanel>
    </Popover>
  )
}
