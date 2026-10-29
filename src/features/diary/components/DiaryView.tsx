import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
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
import { readDiaryDraft, writeDiaryDraft } from '../diaryDrafts'
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

/** Typing pauses this long before the words save by themselves. */
const AUTOSAVE_MS = 2000

function DiaryEntryCard({ day }: { day: string }) {
  const entry = useDiaryEntry(day)
  const { mutate, isPending } = useSaveDiaryEntry()
  const saved = entry.data?.body ?? ''
  // What is typed belongs to its day; the device copy brings it back after a reload.
  const [typed, setTyped] = useState<Record<string, string>>({})
  const draft = typed[day] ?? readDiaryDraft(day)
  const text = draft ?? saved
  const dirty = draft != null && draft !== saved
  // A failed save waits for the next change or Retry instead of trying again by itself.
  const [failed, setFailed] = useState<{ day: string; text: string } | null>(null)
  const stuck = dirty && failed?.day === day && failed.text === draft
  const canSave = entry.isSuccess && dirty && !isPending && !stuck

  const saveNow = useCallback((body: string) => {
    setFailed(null)
    mutate({ day, body }, {
      onSuccess: () => setTyped(t => {
        if (t[day] !== body) return t
        const rest = { ...t }
        delete rest[day]
        return rest
      }),
      onError: () => setFailed({ day, text: body }),
    })
  }, [day, mutate])

  useEffect(() => {
    if (!canSave || draft == null) return
    const timer = setTimeout(() => saveNow(draft), AUTOSAVE_MS)
    return () => clearTimeout(timer)
  }, [canSave, draft, saveNow])

  const subtitle = entry.isLoading ? undefined
    : entry.isError ? "Couldn't load this day's words"
    : isPending ? 'Saving…'
    : stuck ? 'Not saved'
    : dirty ? 'Not saved yet'
    : saved && entry.data?.updated_at ? `Saved ${formatDateTime(entry.data.updated_at)}`
    : 'Not written yet'

  return (
    <Card>
      <CardHeader icon={<NotebookPen />} title="Your day" subtitle={subtitle}
        action={entry.isError ? <Button size="sm" onClick={() => entry.refetch()}>Retry</Button>
          : stuck && draft != null ? <Button size="sm" onClick={() => saveNow(draft)}>Retry</Button>
          : undefined} />
      <textarea
        aria-label="Your day"
        className="input min-h-[9rem] w-full resize-y"
        value={text}
        // Never over words that didn't load: a save would replace them.
        disabled={!entry.isSuccess}
        maxLength={20000}
        placeholder="How was your day? Where were you, and with whom? Tap the microphone on the keyboard to speak."
        onChange={e => {
          const v = e.target.value
          setTyped(t => ({ ...t, [day]: v }))
          writeDiaryDraft(day, v)
        }}
        onBlur={() => { if (canSave && draft != null) saveNow(draft) }}
      />
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
  const library = useLibrary()
  const tasks = useDayTasks(day)
  const blocks = useTimeBlocks(day)
  const lastPlayed = useLastPlayed(day)

  const rows = useMemo(() => buildDiary({
    day,
    meals: (nut.data?.meals ?? []).filter(m => m.source === 'log'),
    workouts: (workouts.data ?? []).map(w => ({ id: w.id, title: w.title, start_time: w.start_time, minutes: getWorkoutDuration(w) })),
    watches: watching.last30,
    reading: reading.data ?? [],
    bookTitles: new Map((library.data ?? []).map(b => [b.id, b.title])),
    tasksDone: tasks.done,
    planned: blocks.data ?? [],
    lastPlayed: lastPlayed.data ?? null,
  }), [day, nut.data, workouts.data, watching.last30, reading.data, library.data, tasks.done, blocks.data, lastPlayed.data])

  // Every source counts: none pops in later, and one that fails is named, never read as "nothing".
  const sources = [
    { name: 'Food', loading: nut.isLoading, failed: nut.isError },
    { name: 'Training', loading: workouts.isLoading, failed: workouts.isError },
    { name: 'Watching', loading: watching.loading, failed: watching.failed },
    { name: 'Reading', loading: reading.isLoading || library.isLoading, failed: reading.isError || library.isError },
    { name: 'Tasks', loading: tasks.isLoading, failed: tasks.isError },
    { name: 'Plans', loading: blocks.isLoading, failed: blocks.isError },
    { name: 'Games', loading: lastPlayed.isLoading, failed: lastPlayed.isError },
  ]
  const loading = sources.some(x => x.loading)
  const failed = sources.filter(x => x.failed).map(x => x.name)

  return (
    <Card>
      <CardHeader icon={<History />} title="What happened" subtitle={loading ? undefined : `${rows.length} ${rows.length === 1 ? 'thing' : 'things'}`} />
      {loading ? (
        <div className="flex flex-col gap-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-6 w-full" />)}</div>
      ) : (
        <>
          {rows.length === 0 ? (
            <p className="text-body text-fg-muted">{failed.length ? 'Nothing else recorded for this day.' : 'Nothing recorded for this day.'}</p>
          ) : (
            <ol className="flex flex-col divide-y divide-line">
              {rows.map(r => (
                <li key={r.key} className="flex min-w-0 items-start gap-2 py-1.5">
                  <span className="w-[2.6rem] shrink-0 pt-px text-meta tabular-nums text-fg-muted">{r.when}</span>
                  <span aria-label={LABEL[r.kind]} className="shrink-0 pt-0.5 text-fg-muted [&_svg]:h-4 [&_svg]:w-4">{ICON[r.kind]}</span>
                  <Truncate lines={r.kind === 'food' ? 2 : 1} className="min-w-0 flex-1 text-body text-fg">{r.title}</Truncate>
                  {r.detail && <span className="shrink-0 pt-px text-meta tabular-nums text-fg-muted">{r.detail}</span>}
                </li>
              ))}
            </ol>
          )}
          {failed.length > 0 && <p role="alert" className="mt-2 text-meta text-fg-muted">Couldn't load: {failed.join(', ')}</p>}
        </>
      )}
    </Card>
  )
}
