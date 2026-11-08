import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getISOWeek } from 'date-fns'
import { formatWeekdayDate } from '../../../shared/utils/dateFormat'
import { ChevronRight } from 'lucide-react'
import { Button, Card, KeepRoom, PageHeroArt, SectionLabel, Skeleton, ToneDot, Truncate, cx, useHeroArt } from '../../../shared/ui'
import { rememberLayout, rememberedLayout } from '../../../shared/hooks/useLayoutMemory'
import { useBreakpoint } from '../../../shared/hooks/useBreakpoint'
import { useEntityModal } from '../../../shared/modals/useEntityModal'
import { useDailyBrief, type BriefFailure } from '../hooks/useDailyBrief'
import { BRIEF_SECTION_ORDER, BRIEF_SECTION_TITLE, alwaysShown, type BriefLine, type BriefSectionId } from '../briefRules'
import { HomeHeroArt } from './HomeHeroArt'

/** Tasks · Schedule · Training · Weather on a phone; the rest behind Show all. */
const PHONE_SECTIONS = 4

function Line({ line, lead }: { line: BriefLine; lead?: boolean }) {
  const modal = useEntityModal()
  const text = (
    <Truncate lines={2} className={cx('min-w-0', line.tone && line.tone !== 'neutral' ? 'tone-text' : lead ? 'text-fg' : 'text-fg-2')}>
      {line.text}
    </Truncate>
  )
  const body = <span data-tone={line.tone} className="min-w-0">{text}</span>
  const cls = cx('flex min-w-0 items-start gap-1', lead ? 'text-ui font-semibold' : 'text-body')
  const linkCls = cx(cls, 'group -mx-1 rounded-control px-1 text-left hover:bg-surface-hover [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:items-center')
  const chevron = <ChevronRight aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-faint group-hover:text-accent-600" />
  const media = line.media
  if (media) {
    return (
      <button type="button" onClick={() => modal.open({ kind: 'media', tmdbId: media.tmdbId, mediaType: media.mediaType })} className={cx(linkCls, 'w-full')}>
        {body}{chevron}
      </button>
    )
  }
  if (!line.href) return <p className={cls}>{body}</p>
  return <Link to={line.href} className={linkCls}>{body}{chevron}</Link>
}

/** A line's box: 20px, or a 44px row on touch (the brief's lines are links). */
const LINE_BOX = 'flex min-h-5 items-center [@media(pointer:coarse)]:min-h-[44px]'
/** A section's label column beside its lines once the card is 24rem wide. */
const SECTION_GRID = 'grid min-w-0 grid-cols-1 gap-0.5 @[24rem]:grid-cols-[6.5rem_minmax(0,1fr)] @[24rem]:gap-3'
const shownKey = (id: BriefSectionId) => `brief:${id}:shown`

/** A section still loading: its label and a line, in the loaded section's grid; KeepRoom gives it its last height. */
function SectionSkeleton() {
  return (
    <>
      <dt aria-hidden className="flex h-4 items-center @[24rem]:mt-0.5"><Skeleton className="h-2.5 w-16" /></dt>
      <dd aria-hidden className={LINE_BOX}><Skeleton className="h-3.5 w-2/3" /></dd>
    </>
  )
}

/** A section whose read failed: what failed and Try again, on the section's one line. */
function FailedLine({ failure }: { failure: BriefFailure }) {
  return (
    <p className={cx(LINE_BOX, 'flex-wrap gap-x-2 text-body text-fg-muted')}>
      {failure.text}
      <Button variant="ghost" size="sm" loading={failure.retrying} onClick={failure.retry}>Try again</Button>
    </p>
  )
}

/**
 * Whether a section still loading will most likely show: as it did when this device last had its data; with
 * nothing remembered, when every outcome shows it at this hour (`alwaysShown`: tasks, food, the schedule until
 * 22:00) — training, weather, watch and money show only with some data, so a first visit keeps them no room.
 */
function expected(id: BriefSectionId, always: ReadonlySet<BriefSectionId>): boolean {
  const last = rememberedLayout(shownKey(id))
  return typeof last === 'boolean' ? last : always.has(id)
}

/**
 * The rule-based morning brief (no AI): greeting and date, the one headline
 * that matters most right now, then compact labelled sections. Phones show
 * the headline plus the first few sections, the rest behind a "Show all".
 * A media line opens that title's popup; other lines link to their page.
 * Home has no header controls, so its header art (THEME.md §6.5) sits
 * behind the top of this card, the page's first, placed beside the greeting.
 */
export function DailyBrief() {
  const { brief, hour, headlineLoading, pending, failed, unsure } = useDailyBrief()
  const isPhone = useBreakpoint() === 'phone'
  const [expanded, setExpanded] = useState(false)
  const byId = new Map(brief.sections.map(s => [s.id, s]))
  const always = alwaysShown(hour)
  // Every section in its place as its own data lands (a failed read: its line); one still loading keeps its place
  // when it will most likely show.
  const slots = BRIEF_SECTION_ORDER.filter(id => failed.has(id) || (pending.has(id) ? expected(id, always) : byId.has(id)))
  // A phone shows the first four, the rest behind Show all. On a first visit a section that only some data shows
  // keeps no room, so when Training and Weather land they can still fold Food away (outside data fills in where it
  // is); after that the memory gives them their places from the start. Keeping Food folded until they had answered
  // measured worse (a light account's first visit 0.009 → 0.055) and changed nothing at night.
  const visible = isPhone && !expanded ? slots.slice(0, PHONE_SECTIONS) : slots
  const hidden = slots.length - visible.length
  const { layerRef: artLayerRef, contentRef: artContentRef, place: artPlace, behind: artBehind } = useHeroArt<HTMLElement>()
  // Which sections showed, for the next visit's room (every section, also the ones folded away on a phone). A
  // section still loading or whose read failed teaches nothing.
  const shown = BRIEF_SECTION_ORDER.map(id => (pending.has(id) || failed.has(id) || unsure.has(id) ? '-' : byId.has(id) ? '1' : '0')).join('')
  useEffect(() => {
    BRIEF_SECTION_ORDER.forEach((id, i) => { if (shown[i] !== '-') rememberLayout(shownKey(id), shown[i] === '1') })
  }, [shown])

  return (
    <Card className="relative isolate">
      <PageHeroArt layerRef={artLayerRef} place={artPlace} behind={artBehind}><HomeHeroArt /></PageHeroArt>
      <div className="relative z-10">
        {/* The greeting and the date need no data: drawn at once, also while the rest loads. */}
        <header ref={artContentRef} className="mb-3">
          <h1 id="daily-brief-title" className="text-title font-bold tracking-tight text-fg sm:text-head">{brief.greeting}</h1>
          <p className="text-meta tabular-nums text-fg-muted">{formatWeekdayDate(new Date(), 'long')} · Week {getISOWeek(new Date())}</p>
        </header>
        <div className="mb-4 flex items-start gap-2 rounded-row bg-surface-2 px-3 py-2.5">
          {headlineLoading
            ? <Skeleton rounded="rounded-full" className="mt-1.5 h-2 w-2 shrink-0" />
            : <ToneDot tone={brief.headline.tone ?? 'accent'} className="mt-1.5 shrink-0" />}
          <KeepRoom
            ids="brief:headline" loading={headlineLoading} remember={failed.size === 0 && unsure.size === 0} className="min-w-0 flex-1"
            skeleton={<span aria-hidden className={LINE_BOX}><Skeleton className="h-3.5 w-3/4" /></span>}
          >
            <Line line={brief.headline} lead />
          </KeepRoom>
        </div>

        {slots.length > 0 && (
          // One column of sections; two side by side once the card is wide
          // (a wide Home main track), so the right half isn't left empty.
          <div className="@container">
            <dl className="grid grid-cols-1 gap-x-8 gap-y-3 @[46rem]:grid-cols-2">
              {visible.map(id => {
                const section = byId.get(id)
                const failure = failed.get(id)
                return (
                  <KeepRoom
                    key={id} ids={`brief:${id}`} loading={pending.has(id)} remember={!failure && !unsure.has(id)} className={SECTION_GRID}
                    skeleton={<SectionSkeleton />}
                  >
                    {(section || failure) && (
                      <>
                        <dt><SectionLabel className="@[24rem]:pt-0.5">{section?.title ?? BRIEF_SECTION_TITLE[id]}</SectionLabel></dt>
                        <dd className="min-w-0 space-y-0.5">
                          {failure ? <FailedLine failure={failure} /> : section?.lines.map((line, i) => <Line key={i} line={line} />)}
                        </dd>
                      </>
                    )}
                  </KeepRoom>
                )
              })}
            </dl>
          </div>
        )}

        {isPhone && (hidden > 0 || expanded) && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            aria-expanded={expanded}
            className="mt-2 inline-flex min-h-[44px] items-center text-meta font-semibold text-accent-600"
          >
            {expanded ? 'Show less' : `Show all (${hidden} more)`}
          </button>
        )}
      </div>
    </Card>
  )
}
