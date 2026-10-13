import { useMemo, useState } from 'react'
import { ChevronDown, Dices, Plus, X } from 'lucide-react'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, IconButton, SegmentedControl, Skeleton, TonePill } from '../../../shared/ui'
import { DateInput } from '../../../shared/components/DateInput'
import { withProgress } from '../../../shared/hooks/useMutationWithFeedback'
import { formatDate } from '../../../shared/utils/dateFormat'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useAllSeasons } from '../hooks/useTMDB'
import { useMarkEpisodeWatched, useSetEpisodeDates, useWatchedEpisodes } from '../hooks/useWatchedEpisodes'
import {
  DEFAULT_SPREAD, fixedSpreadEpisodes, fmt, planSpread, seedFrom, spreadDefaultStart, spreadHeadline, spreadWrites,
  type SpreadEpisode, type SpreadInput, type SpreadMode, type SpreadStyle,
} from '../spreadWatched'
import { SpreadMonthStrip } from './SpreadMonthStrip'

const STYLES: { value: SpreadStyle; label: string; hint: string }[] = [
  { value: 'steady', label: 'Steady', hint: 'A little, regularly' },
  { value: 'mixed', label: 'Mixed', hint: 'Some evenings 1, some 3' },
  { value: 'binge', label: 'Binge', hint: 'Fewer days, many at once' },
]
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
// 24-hour times (a native time field follows the browser's 12-hour locale).
const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

interface Props {
  tvId: number
  tvName: string
  tvEntryId: string
  seasons: number[]
  defaultRuntime: number | null
  /**
   * A fixed set of episodes — the when-watched sheet's "Spread over dates…"
   * for a selection, Up to here or the gaps. Without it the sheet offers a
   * from–to range over every aired episode.
   */
  only?: { season: number; episode: number }[]
  /** What the save does (spreadWatched.ts `SpreadMode`); default `watched`. */
  mode?: SpreadMode
  /** `saved`: true after a successful save. */
  onClose: (saved?: boolean) => void
  /**
   * Completing the series: called after the episodes are marked, with the
   * first and last planned times (the series' start and finish). The button
   * then reads "Mark N & complete".
   */
  onSaved?: (range: { firstAt: string; lastAt: string }) => Promise<unknown>
}

const key = (s: number, e: number) => `${s}x${e}`
const label = (s: number, e: number) => `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`
const plural = (n: number) => `${n} episode${n === 1 ? '' : 's'}`
/** A few episodes by name ("S01E02, S01E05"); more as first – last. */
const fixedLabel = (eps: SpreadEpisode[]) => (eps.length <= 3
  ? eps.map(e => label(e.season, e.episode)).join(', ')
  : `${label(eps[0].season, eps[0].episode)} – ${label(eps[eps.length - 1].season, eps[eps.length - 1].episode)}`)

/** The save button and the toast, per mode. */
const WORDS: Record<SpreadMode, { verb: string; button: (n: number) => string; loading: (n: number) => string; done: (n: number) => string; note?: string }> = {
  watched: { verb: 'Mark watched', button: n => `Mark ${plural(n)}`, loading: n => `Marking ${plural(n)}…`, done: n => `${plural(n)} marked watched` },
  again: { verb: 'Count the plays', button: n => `Count ${n} play${n === 1 ? '' : 's'}`, loading: n => `Counting another play of ${plural(n)}…`, done: n => `Another play of ${plural(n)} counted`, note: 'each gets one more play' },
  redate: { verb: 'Change dates', button: n => `Change ${n} date${n === 1 ? '' : 's'}`, loading: () => 'Changing watched dates…', done: n => `${n} watched date${n === 1 ? '' : 's'} changed`, note: 'plays stay' },
}

/**
 * Mark a run of episodes watched across a period you remember roughly, with
 * breaks you didn't watch in. Every change replans at once (spreadWatched.ts).
 */
export function SpreadWatchedSheet({ tvId, tvName, tvEntryId, seasons, defaultRuntime, only, mode = 'watched', onClose, onSaved }: Props) {
  const TODAY = todayStr()
  // A fixed set needs only its own seasons from TMDB.
  const all = useAllSeasons(tvId, only ? [...new Set(only.map(r => r.season))] : seasons)
  const { data: watched = [] } = useWatchedEpisodes(tvEntryId)
  const mark = useMarkEpisodeWatched()
  const setDates = useSetEpisodeDates()

  // Every aired episode in watching order.
  const episodes = useMemo(() => all.seasons
    .slice().sort((a, b) => a.season_number - b.season_number)
    .flatMap(s => s.episodes
      .filter(e => !e.air_date || e.air_date <= TODAY)
      .map(e => ({ season: s.season_number, episode: e.episode_number, airDate: e.air_date, runtime: e.runtime }))),
  [all.seasons, TODAY])
  const watchedKeys = useMemo(() => new Set(watched.map(w => key(w.season_number, w.episode_number))), [watched])
  const watchedAt = useMemo(() => new Map(watched.map(w => [key(w.season_number, w.episode_number), w.watched_at])), [watched])
  const fixed = useMemo(() => {
    if (!only) return null
    const info = new Map(all.seasons.flatMap(s => s.episodes.map(e => [key(s.season_number, e.episode_number), { airDate: e.air_date, runtime: e.runtime }] as const)))
    return fixedSpreadEpisodes(only, info)
  }, [only, all.seasons])

  const [from, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(null)
  const [overwrite, setOverwrite] = useState(false)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState(TODAY)
  const [breaks, setBreaks] = useState<{ from: string; to: string }[]>([])
  const [style, setStyle] = useState<SpreadStyle>('mixed')
  const [more, setMore] = useState(false)
  const [weekdays, setWeekdays] = useState(DEFAULT_SPREAD.weekdays)
  const [maxPerDay, setMaxPerDay] = useState(DEFAULT_SPREAD.maxPerDay)
  const [startTime, setStartTime] = useState(DEFAULT_SPREAD.startTime)
  const [runtime, setRuntime] = useState(defaultRuntime ?? DEFAULT_SPREAD.runtime)
  const [respectAir, setRespectAir] = useState(true)
  const [seed, setSeed] = useState(() => seedFrom(String(tvId)))
  const [saving, setSaving] = useState(false)

  const fromKey = from ?? (episodes[0] ? key(episodes[0].season, episodes[0].episode) : '')
  const toKey = to ?? (episodes.length ? key(episodes[episodes.length - 1].season, episodes[episodes.length - 1].episode) : '')
  const fromIdx = Math.max(0, episodes.findIndex(e => key(e.season, e.episode) === fromKey))
  const toIdx = Math.max(fromIdx, episodes.findIndex(e => key(e.season, e.episode) === toKey))
  const inRange = fixed ?? episodes.slice(fromIdx, toIdx + 1)
  const alreadyWatched = inRange.filter(e => watchedKeys.has(key(e.season, e.episode))).length
  // A fixed set for a rewatch or new dates is planned whole; marking never
  // re-dates an episode already watched unless asked to (the range's checkbox).
  const planAll = fixed ? mode !== 'watched' : overwrite
  const toPlan: SpreadEpisode[] = planAll ? inRange : inRange.filter(e => !watchedKeys.has(key(e.season, e.episode)))
  // Until a start is picked: a rewatch the day after its last kept date, else the first air date.
  const startDay = start || spreadDefaultStart(mode, toPlan, watchedAt, TODAY)
  const words = WORDS[mode]

  const input: SpreadInput = { start: startDay, end, breaks, weekdays, style, maxPerDay, startTime, runtime, respectAirDates: respectAir, seed }
  // The plan is recomputed when anything it reads changes; the input object is
  // keyed by its JSON so a new object with the same values doesn't replan.
  const inputKey = JSON.stringify(input)
  const result = useMemo(() => planSpread(input, toPlan, TODAY),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inputKey, toPlan.length, fromIdx, toIdx, overwrite, watchedKeys, TODAY, episodes, fixed])

  // Through the one episode write path: new episodes marked, watched ones
  // counted again (repeat_count + 1 at the planned time) or re-dated.
  async function save() {
    if (!result.ok) return
    const w = spreadWrites(result.plan, watchedKeys, mode)
    const refs = (items: typeof result.plan) => items.map(p => ({ season: p.season, episode: p.episode, at: p.at }))
    const n = result.plan.length
    setSaving(true)
    const ok = await withProgress(async () => {
      if (w.mark.length) await mark.mutateAsync({ tvEntryId, episodes: refs(w.mark), watchedOn: TODAY })
      if (w.again.length) await mark.mutateAsync({ tvEntryId, episodes: refs(w.again), again: true, watchedOn: TODAY })
      if (w.redate.length) await setDates.mutateAsync({ tvEntryId, episodes: refs(w.redate) })
      if (onSaved) await onSaved({ firstAt: result.plan[0].at, lastAt: result.plan[n - 1].at })
      return true
    }, {
      loading: words.loading(n),
      success: onSaved ? `${plural(n)} marked · series completed` : words.done(n),
    })
    setSaving(false)
    if (ok) onClose(true)
  }

  const loading = all.loading && (fixed ? all.seasons.length === 0 : episodes.length === 0)

  return (
    <ModalShell
      onClose={() => onClose()}
      size="lg"
      title="Spread watched dates"
      subtitle={tvName}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => onClose()}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!result.ok || saving} onClick={() => { void save() }}>
            {result.ok
              ? `${words.button(result.plan.length)}${onSaved ? ' & complete' : ''}`
              : onSaved ? 'Mark & complete' : words.verb}
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-24 w-full" /></div>
      ) : (
        // Tablet and wider: fields left, the live result pinned right (a 680px
        // laptop would otherwise scroll it out of sight while you edit).
        <div className="flex flex-col gap-4 md:grid md:grid-cols-[minmax(0,1fr)_15rem] md:items-start md:gap-5">
        <div className="flex min-w-0 flex-col gap-4">
          {all.failed && <p className="text-meta text-warn">Some seasons didn't load from TMDB — their episodes are left out.</p>}

          <Field label="Episodes">
            {fixed ? (
              // The set picked before (selection, Up to here): shown, not chosen again.
              <p className="text-body text-fg tabular-nums">
                {fixed.length > 0 && <>{fixedLabel(fixed)} · </>}
                {plural(fixed.length)}
                {words.note && <span className="text-fg-muted"> · {words.note}</span>}
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <EpisodeSelect episodes={episodes} value={key(inRange[0]?.season ?? 1, inRange[0]?.episode ?? 1)} onChange={setFrom} aria="From episode" />
                  <span className="text-meta text-fg-muted">to</span>
                  <EpisodeSelect episodes={episodes.slice(fromIdx)} value={key(episodes[toIdx]?.season ?? 1, episodes[toIdx]?.episode ?? 1)} onChange={setTo} aria="To episode" />
                </div>
                <p className="mt-1 text-meta text-fg-muted tabular-nums">
                  {plural(inRange.length)}
                  {alreadyWatched > 0 && <> · {alreadyWatched} already watched</>}
                </p>
              </>
            )}
            {!fixed && alreadyWatched > 0 && (
              <label className="mt-1 flex min-h-[44px] items-center gap-2 text-body text-fg-2">
                <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} className="h-4 w-4 accent-accent-500" />
                Give the watched ones new dates too
              </label>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Started">
              <DateInput value={startDay} onChange={v => setStart(v)} max={TODAY} aria-label="Started watching" className="input w-full tabular-nums" />
            </Field>
            <Field label="Finished">
              <DateInput value={end} onChange={v => setEnd(v || TODAY)} max={TODAY} aria-label="Finished watching" className="input w-full tabular-nums" />
            </Field>
          </div>

          <Field label="Breaks" hint="Periods you didn't watch">
            <div className="flex flex-col gap-1.5">
              {breaks.map((b, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
                  <DateInput value={b.from} onChange={v => setBreaks(bs => bs.map((x, j) => (j === i ? { ...x, from: v } : x)))} aria-label="Break from" placeholder="From" className="input w-full tabular-nums" />
                  <DateInput value={b.to} onChange={v => setBreaks(bs => bs.map((x, j) => (j === i ? { ...x, to: v } : x)))} aria-label="Break until" placeholder="Until" className="input w-full tabular-nums" />
                  <IconButton label="Remove break" onClick={() => setBreaks(bs => bs.filter((_, j) => j !== i))} className="text-fg-faint hover:text-fg-2"><X /></IconButton>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setBreaks(bs => [...bs, { from: '', to: '' }])}
                className="flex min-h-[44px] w-fit items-center gap-1.5 rounded-control px-1 text-body text-fg-muted transition-colors hover:text-accent-600"
              >
                <Plus className="h-4 w-4" /> Add a break
              </button>
            </div>
          </Field>

          <Field label="Pattern" hint={STYLES.find(s => s.value === style)?.hint}>
            <SegmentedControl size="sm" options={STYLES.map(s => ({ value: s.value, label: s.label }))} value={style} onChange={setStyle} />
          </Field>

          <div>
            <button
              type="button"
              aria-expanded={more}
              onClick={() => setMore(m => !m)}
              className="flex min-h-[44px] items-center gap-1 text-meta font-medium text-fg-muted transition-colors hover:text-fg-2"
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${more ? 'rotate-180' : ''}`} /> More options
            </button>
            {more && (
              <div className="mt-1 flex flex-col gap-3 rounded-row border border-line bg-surface-2 p-3">
                <Field label="Watched on">
                  <div className="flex gap-1">
                    {WEEKDAYS.map((d, i) => (
                      <button
                        key={i}
                        type="button"
                        aria-pressed={weekdays[i]}
                        aria-label={WEEKDAY_NAMES[i]}
                        title={WEEKDAY_NAMES[i]}
                        onClick={() => setWeekdays(w => w.map((x, j) => (j === i ? !x : x)))}
                        className={`grid h-11 w-9 place-items-center rounded-control text-meta font-semibold transition-colors ${weekdays[i] ? 'bg-accent-50 text-accent-700 ring-1 ring-inset ring-accent-500/30' : 'text-fg-faint hover:bg-surface-hover'}`}
                      >{d}</button>
                    ))}
                  </div>
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Most a day">
                    <NumberBox value={maxPerDay} min={1} max={50} onChange={setMaxPerDay} aria="Most episodes a day" />
                  </Field>
                  <Field label="Evenings from">
                    <select value={startTime} onChange={e => setStartTime(e.target.value)} className="select h-11 w-full tabular-nums" aria-label="Evenings start at">
                      {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Episode, min">
                    <NumberBox value={runtime} min={5} max={240} onChange={setRuntime} aria="Episode length in minutes" />
                  </Field>
                </div>
                <label className="flex min-h-[44px] items-center gap-2 text-body text-fg-2">
                  <input type="checkbox" checked={respectAir} onChange={e => setRespectAir(e.target.checked)} className="h-4 w-4 accent-accent-500" />
                  Never before an episode aired
                </label>
              </div>
            )}
          </div>

        </div>
          <div className="rounded-card border border-line bg-surface-2 p-3 md:sticky md:top-0" aria-live="polite">
            {result.ok ? (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-title font-semibold text-fg">{spreadHeadline(result.stats)}</p>
                    <ul className="mt-1 space-y-0.5 text-meta text-fg-muted tabular-nums">
                      <li>{formatDate(result.stats.firstDay)} → {formatDate(result.stats.lastDay)}</li>
                      <li>{result.stats.watchDays} watching day{result.stats.watchDays === 1 ? '' : 's'} of {result.stats.activeDays}</li>
                      <li>{fmt(Math.round(result.stats.perWatchDay * 10) / 10)} on a day you watched</li>
                      {result.stats.breakDays > 0 && <li>{result.stats.breakDays} days of breaks left out</li>}
                    </ul>
                  </div>
                  <IconButton label="Shuffle the days" onClick={() => setSeed(s => s + 1)} className="shrink-0 text-fg-faint hover:text-fg-2"><Dices /></IconButton>
                </div>
                <SpreadMonthStrip months={result.stats.months} />
                {result.stats.movedToAirDate > 0 && (
                  <p className="mt-2 text-meta text-warn">{result.stats.movedToAirDate} episode{result.stats.movedToAirDate === 1 ? '' : 's'} moved to the day {result.stats.movedToAirDate === 1 ? 'it' : 'they'} aired{result.stats.busiestDay > maxPerDay ? ` (up to ${result.stats.busiestDay} on one day)` : ''}.</p>
                )}
              </>
            ) : (
              <>
                <p className="text-body font-medium text-fg-2">{result.error}</p>
                {result.suggestions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {result.suggestions.map(s => (
                      <button key={s.kind} type="button" onClick={() => (s.kind === 'maxPerDay' ? setMaxPerDay(s.value) : setEnd(s.value))} className="min-h-[44px]">
                        <TonePill tone="info">{s.kind === 'maxPerDay' ? `Allow ${s.value} a day` : `Finish on ${formatDate(s.value)}`}</TonePill>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </ModalShell>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-meta font-medium text-fg-2">{label}{hint && <span className="font-normal text-fg-muted"> · {hint}</span>}</span>
      {children}
    </div>
  )
}

function EpisodeSelect({ episodes, value, onChange, aria }: { episodes: SpreadEpisode[]; value: string; onChange: (k: string) => void; aria: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} aria-label={aria} className="select h-11 w-auto min-w-[7rem] tabular-nums">
      {episodes.map(e => <option key={key(e.season, e.episode)} value={key(e.season, e.episode)}>{label(e.season, e.episode)}</option>)}
    </select>
  )
}

function NumberBox({ value, min, max, onChange, aria }: { value: number; min: number; max: number; onChange: (n: number) => void; aria: string }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={aria}
      value={value}
      onChange={e => { const n = Number(e.target.value.replace(/\D/g, '')); onChange(Math.min(max, Math.max(min, n || min))) }}
      className="input h-11 w-full tabular-nums"
    />
  )
}
