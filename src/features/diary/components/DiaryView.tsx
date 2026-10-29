import { useMemo, useState, type ReactNode } from 'react'
import { BookOpen, CalendarClock, CircleCheck, Clapperboard, Dumbbell, Gamepad2, History, NotebookPen, UtensilsCrossed } from 'lucide-react'
import { Button, Card, CardHeader, PageBoard, Skeleton, Truncate } from '../../../shared/ui'
import { formatDateTime } from '../../../shared/utils/dateFormat'
import { todayStr } from '../../../shared/utils/dateUtils'
import { DIARY_BOARD, type DiarySection } from '../../daily/dailyBoards'
import { useDayNutrition } from '../../daily/hooks/useDayNutrition'
import { useTimeBlocks } from '../../daily/hooks/useSchedule'
import { useDayTasks } from '../../todo/hooks/useTodos'
import { useHevyWorkoutsRange } from '../../training/hooks/useHevyWorkouts'
import { getWorkoutDuration } from '../../training/components/calendar/calendarModel'
import { useWatchingGlance } from '../../media/hooks/useYearReview'
import { useLibrary, useReadingEvents } from '../../books/hooks/useLibrary'
import { useLastPlayed } from '../../games/hooks/useGames'
import { useDiaryEntry, useSaveDiaryEntry } from '../hooks/useDiary'
import { buildDiary, type DiaryKind } from '../diaryTimeline'

// Personal → Diary (owner, 29.10.2026): the day in the owner's own words, and
// what the app knows happened that day — eaten, trained, watched, read,
// played, done, planned. The words are the only thing stored (diary_entries,
// 170); the rest is read from each feature, so it never disagrees with them.

export function DiaryView({ day }: { day: string }) {
  const sections: Record<DiarySection, ReactNode> = {
    entry: <DiaryEntryCard day={day} />,
    timeline: <DiaryTimelineCard day={day} />,
  }
  return <PageBoard sections={sections} layout={DIARY_BOARD} stackGap="gap-5 sm:gap-6" />
}

function DiaryEntryCard({ day }: { day: string }) {
  const entry = useDiaryEntry(day)
  const save = useSaveDiaryEntry()
  const saved = entry.data?.body ?? ''
  // What is typed belongs to its day: another day shows its own saved words.
  const [draft, setDraft] = useState<{ day: string; text: string } | null>(null)
  const text = draft?.day === day ? draft.text : saved
  const dirty = draft?.day === day && draft.text !== saved

  return (
    <Card>
      <CardHeader icon={<NotebookPen />} title="Your day"
        subtitle={entry.data?.updated_at && saved ? `Saved ${formatDateTime(entry.data.updated_at)}` : 'Not written yet'} />
      <textarea
        aria-label="Your day"
        className="input min-h-[9rem] w-full resize-y"
        value={text}
        disabled={entry.isLoading}
        maxLength={20000}
        placeholder="How was your day? Where were you, and with whom? Tap the microphone on the keyboard to speak."
        onChange={e => setDraft({ day, text: e.target.value })}
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        {dirty && <span className="text-meta text-fg-muted">Not saved yet</span>}
        <Button size="sm" variant="primary" disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ day, body: text }, { onSuccess: () => setDraft(null) })}>
          Save
        </Button>
      </div>
    </Card>
  )
}

const ICON: Record<DiaryKind, ReactNode> = {
  food: <UtensilsCrossed />,
  training: <Dumbbell />,
  watched: <Clapperboard />,
  reading: <BookOpen />,
  game: <Gamepad2 />,
  task: <CircleCheck />,
  planned: <CalendarClock />,
}

const LABEL: Record<DiaryKind, string> = {
  food: 'Ate', training: 'Trained', watched: 'Watched', reading: 'Read', game: 'Played', task: 'Done', planned: 'Planned',
}

function DiaryTimelineCard({ day }: { day: string }) {
  const daysAgo = Math.round((Date.parse(`${todayStr()}T12:00:00`) - Date.parse(`${day}T12:00:00`)) / 86_400_000)
  const nut = useDayNutrition(day)
  const workouts = useHevyWorkoutsRange(day, day)
  const watching = useWatchingGlance(day)
  // The reading window the Personal card and Books → Stats already share.
  const reading = useReadingEvents(daysAgo < 120 ? 120 : 400)
  const { data: books = [] } = useLibrary()
  const tasks = useDayTasks(day)
  const { data: blocks = [] } = useTimeBlocks(day)
  const { data: lastPlayed = null } = useLastPlayed(day)

  const rows = useMemo(() => buildDiary({
    day,
    meals: (nut.data?.meals ?? []).filter(m => m.source === 'log'),
    workouts: (workouts.data ?? []).map(w => ({ id: w.id, title: w.title, start_time: w.start_time, minutes: getWorkoutDuration(w) })),
    watches: watching.last30,
    reading: reading.data ?? [],
    bookTitles: new Map(books.map(b => [b.id, b.title])),
    tasksDone: tasks.done,
    planned: blocks,
    lastPlayed,
  }), [day, nut.data, workouts.data, watching.last30, reading.data, books, tasks.done, blocks, lastPlayed])

  const loading = nut.isLoading || workouts.isLoading || watching.loading || tasks.isLoading
  return (
    <Card>
      <CardHeader icon={<History />} title="What happened" subtitle={loading ? undefined : `${rows.length} ${rows.length === 1 ? 'thing' : 'things'}`} />
      {loading ? (
        <div className="flex flex-col gap-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-6 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <p className="text-body text-fg-muted">Nothing recorded for this day.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-line">
          {rows.map(r => (
            <li key={r.key} className="flex min-w-0 items-center gap-2.5 py-2">
              <span className="w-[5.5rem] shrink-0 text-meta tabular-nums text-fg-muted">{r.when}</span>
              <span aria-label={LABEL[r.kind]} className="shrink-0 text-fg-muted [&_svg]:h-4 [&_svg]:w-4">{ICON[r.kind]}</span>
              <Truncate className="min-w-0 flex-1 text-body text-fg">{r.title}</Truncate>
              {r.detail && <span className="shrink-0 text-meta tabular-nums text-fg-muted">{r.detail}</span>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}
