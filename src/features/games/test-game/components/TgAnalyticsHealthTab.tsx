import { useHealthData, type TgaBase } from './tgAnalyticsData'
import { TGA_GRID } from './tgAnalyticsFormat'

/** Data health: how complete the metadata is, where the art lives, how fresh each source is. */
export function TgAnalyticsHealthTab({ base }: { base: TgaBase }) {
  const d = useHealthData(base)
  return <div className={TGA_GRID} data-fields={d.coverage.fields.length} />
}
