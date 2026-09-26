import { useState } from 'react'
import { Building2 } from 'lucide-react'
import type { studioRows, TgaStudioField } from './tgAnalyticsMore'
import { useAnalyticsHandoff } from './tgAnalyticsHandoff'
import { gamesByStudio } from './tgAnalyticsLists'
import { studiosMeta } from './tgAnalyticsCollection'
import { TgAnalyticsBarList } from './TgAnalyticsBarList'
import { TgAnalyticsCard, TgAnalyticsEmpty } from './TgAnalyticsCard'
import { TgSegmented } from './scrape/TgScrapeParts'

type Studios = ReturnType<typeof studioRows>

const FIELDS: { value: TgaStudioField; label: string }[] = [
  { value: 'developer', label: 'Developer' },
  { value: 'publisher', label: 'Publisher' },
]

/**
 * The studios with the most games, by developer or by publisher. A row opens
 * exactly the games it counts (by that one field); the folded "N more" row
 * only lists them.
 */
export function TgAnalyticsStudios({ developers, publishers, className = '' }: {
  developers: Studios
  publishers: Studios
  className?: string
}) {
  const handoff = useAnalyticsHandoff()
  // Opens on whichever field has anything recorded.
  const [field, setField] = useState<TgaStudioField>(() => (developers.rows.length || !publishers.rows.length ? 'developer' : 'publisher'))
  const data = field === 'developer' ? developers : publishers
  const any = developers.rows.length > 0 || publishers.rows.length > 0
  const noun = field === 'developer' ? 'developers' : 'publishers'

  return (
    <TgAnalyticsCard label="Top studios" meta={data.studios ? studiosMeta(data.studios, data.missing) : undefined} className={className}>
      {any && <TgSegmented size="sm" label="Group studios by" value={field} options={FIELDS} onChange={setField} />}
      {data.rows.length ? (
        <div className="mt-3">
          <TgAnalyticsBarList
            rows={data.rows}
            openLabel={row => `Show games by ${row.label} in the library`}
            onOpen={row => {
              if (!row.target) return
              handoff.open(`${field === 'developer' ? 'Developer' : 'Publisher'}: ${row.label}`, gamesByStudio(handoff.base?.scoped ?? [], field, row.target))
            }}
          />
        </div>
      ) : (
        <TgAnalyticsEmpty
          icon={Building2} className={any ? 'mt-3' : ''}
          title={`No ${noun} recorded`}
          hint="Studios arrive with ES-DE and ScreenScraper metadata, or from a game's Edit form."
        />
      )}
    </TgAnalyticsCard>
  )
}
