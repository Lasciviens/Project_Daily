import { useState } from 'react'
import { ChevronDown, ChevronLeft } from 'lucide-react'
import { useTestGameStore } from '../testGameStore'
import {
  ALL_PLATFORMS, STATUS_SECTIONS, platformInfo, platformLabels,
  type PlatformGroup,
} from '../testGameModel'
import { headerNoteText, type TgHeaderConfig } from '../tgTypes'
import { TgDropdown } from './TgDropdown'
import { TgMobilePlatformSheet } from './TgMobilePlatformSheet'
import { Truncate } from '../../../../shared/ui/Truncate'

/**
 * Left side of the phone's scope row: what the grid below is scoped to.
 * Library → the design's "PS2 ▾" platform pill, which opens every platform
 * grouped by maker. Wishlist/Completed → their platform scope (the
 * active section pill above names the section; a title here squeezed both to
 * "Wis…"/"S…"). Queue/Analytics/Advanced → the section title, nothing to pick.
 * A platform label never shrinks below ~4.5rem.
 */
export function TgMobileScope({ groups, header }: { groups: PlatformGroup[]; header: TgHeaderConfig }) {
  const section = useTestGameStore(s => s.section)
  const platform = useTestGameStore(s => s.platform)
  const setPlatform = useTestGameStore(s => s.setPlatform)
  const scrapeReview = useTestGameStore(s => (s.scrapeMode === 'search' ? s.scrapeReview : null))
  const setScrapeReview = useTestGameStore(s => s.setScrapeReview)
  const [pickerOpen, setPickerOpen] = useState(false)

  if (section === 'library') {
    // The page's effective platform: a persisted platform with no games left
    // falls back to All there, and the pill must say what the grid shows.
    const current = header.platformKey ?? platform
    // Two systems sharing a short name ("Arcade") are spelled out in full.
    const labels = platformLabels(groups.flatMap(g => g.platforms))
    // "All" on the pill (the row is tight at 393px); the sheet spells it out.
    const label = labels.get(current) ?? platformInfo(current).short
    return (
      <>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          aria-haspopup="dialog"
          aria-label={`Platform: ${current === ALL_PLATFORMS ? 'All platforms' : label}`}
          // The design's platform pill reads larger and bolder than the filter pills.
          className="tg-select min-w-[4.5rem] !text-[15px] !font-semibold"
        >
          <Truncate>{label}</Truncate>
          <ChevronDown aria-hidden className="tg-chev ml-auto shrink-0" strokeWidth={2} />
        </button>
        <TgMobilePlatformSheet open={pickerOpen} onClose={() => setPickerOpen(false)} groups={groups} current={current} onPick={setPlatform} />
      </>
    )
  }

  if (STATUS_SECTIONS[section]) {
    const value = header.activeTab ?? ALL_PLATFORMS
    const active = header.tabs.find(t => t.key === value)
    if (header.tabs.length === 0) return null
    return (
      <TgDropdown
        value={value}
        options={header.tabs.map(t => ({ value: t.key, label: t.label, count: t.count }))}
        onChange={(k: string) => header.onTab?.(k)}
        buttonLabel={active?.label ?? 'All'}
        ariaLabel={`${header.title} platform`}
        align="start"
        className="!min-w-[4.5rem]"
      />
    )
  }

  // A ScreenScraper result under review is a step of its own: Back sits
  // here, always on screen, however far the review has scrolled.
  if (section === 'scrape' && scrapeReview) {
    return (
      <div className="flex min-w-0 items-center gap-1">
        <button type="button" onClick={() => setScrapeReview(null)} aria-label="Back to results"
          className="-ml-2 inline-flex min-h-[44px] shrink-0 items-center gap-0.5 pr-1.5 text-[14px] font-semibold text-[var(--tg-accent)]">
          <ChevronLeft className="h-5 w-5" strokeWidth={2.2} aria-hidden /> Results
        </button>
        <Truncate as="p" className="tg-muted text-[13px]">{scrapeReview.title}</Truncate>
      </div>
    )
  }

  return (
    <div className="min-w-0 flex-1">
      <Truncate as="h2" className="text-[16px] font-bold leading-tight">{header.title}</Truncate>
      {/* Two lines on a phone: the queue's split doesn't fit one. A tap on a cut
          line opens a bubble (an in-place "More" would push the list down). */}
      <Truncate as="p" lines={2} reveal="popover" className="tg-muted text-[12px] leading-snug">{header.subtitle}</Truncate>
      {header.note && <Truncate as="p" fullText={headerNoteText(header.note, header.subtitleTitle)} className="tg-muted text-[12px] leading-snug">{header.note}</Truncate>}
    </div>
  )
}
