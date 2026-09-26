import { ImageOff } from 'lucide-react'
import type { TgaAssetCategory, assetInventory } from './tgAnalyticsHealth'
import { fmtInt, plural } from './tgAnalyticsFormat'
import { assetCategoryLabel, assetHeadline, mirroredLine } from './tgAnalyticsHealthCopy'
import { formatBytes } from './scrape/tgScrapeModel'
import { TgAnalyticsCard, TgAnalyticsEmpty } from './TgAnalyticsCard'
import { TgAnalyticsHealthMeter } from './TgAnalyticsHealthMeter'

// A row is its own container: narrow, the name and size sit over the bar and
// the image count; from 24rem it is one line with fixed-width figures, so the
// bars line up — in one column or, in a wide card, two.
const GRID = [
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-1.5',
  '@[24rem]/arow:grid-cols-[minmax(5.5rem,8.5rem)_minmax(0,1fr)_minmax(5.75rem,auto)_minmax(4rem,auto)] @[24rem]/arow:gap-y-0 @[24rem]/arow:py-1',
].join(' ')

function Row({ c, max }: { c: TgaAssetCategory; max: number }) {
  const name = assetCategoryLabel(c.category)
  return (
    <li className="@container/arow min-w-0">
      <div className={GRID} title={`${name}: ${plural(c.images, 'image')} on ${plural(c.games, 'game')}`}>
        <span className="col-start-1 row-start-1 min-w-0 truncate text-[13px] font-medium text-[var(--tg-text)]">{name}</span>
        <span className="col-start-1 row-start-2 @[24rem]/arow:col-start-2 @[24rem]/arow:row-start-1">
          <TgAnalyticsHealthMeter value={c.bytes} max={max} />
        </span>
        <span className="col-start-2 row-start-2 whitespace-nowrap text-right text-[12px] tabular-nums text-[var(--tg-muted)] @[24rem]/arow:col-start-3 @[24rem]/arow:row-start-1">
          {plural(c.images, 'image')}
          <span className="sr-only"> on {plural(c.games, 'game')}</span>
        </span>
        <span className="col-start-2 row-start-1 whitespace-nowrap text-right text-[13px] font-semibold tabular-nums text-[var(--tg-text)] @[24rem]/arow:col-start-4">
          {formatBytes(c.bytes)}
        </span>
      </div>
    </li>
  )
}

/**
 * The original images the handheld uploaded from ES-DE, per category, biggest
 * first — a bar is the category's size. A tally of the rows this page holds,
 * which is what the handheld sent, not what storage bills.
 */
export function TgAnalyticsAssets({ assets, className = '' }: { assets: ReturnType<typeof assetInventory>; className?: string }) {
  const { categories, images, mirrored } = assets
  const max = Math.max(1, ...categories.map(c => c.bytes))
  const mirror = mirrored > 0 && <p className="mt-2 text-[12px] leading-relaxed text-[var(--tg-muted)]">{mirroredLine(mirrored)}</p>

  return (
    <TgAnalyticsCard label="ES-DE original images" meta={images ? 'bars show size' : undefined} className={className}>
      {images ? (
        <>
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[var(--tg-text)]">{fmtInt(images)}</span>
            <span className="text-[13px] font-medium text-[var(--tg-text-2)]">{assetHeadline(assets, formatBytes)}</span>
          </p>
          <ul aria-label="Image categories" className="mt-4 grid grid-cols-1 gap-x-6 @[40rem]:grid-cols-2">
            {categories.map(c => <Row key={c.category} c={c} max={max} />)}
          </ul>
          <p className="mt-3 text-[12px] leading-relaxed text-[var(--tg-muted)]">
            Counted from the rows on this page — the handheld’s uploads, not your storage bill.
          </p>
          {mirror}
        </>
      ) : (
        <>
          <TgAnalyticsEmpty icon={ImageOff} title="No original images yet" hint="The handheld hasn’t uploaded original images yet — run the Termux widget." />
          {mirror}
        </>
      )}
    </TgAnalyticsCard>
  )
}
