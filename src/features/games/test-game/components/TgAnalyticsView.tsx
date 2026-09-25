import { StatsPanel } from '../../components/StatsPanel'

// The existing stats dashboard, reused as-is. It is styled with the app's
// cream/ink tokens, which follow the theme on their own — not restyled here.
export function TgAnalyticsView() {
  return (
    <div className="tg-panel p-5">
      <StatsPanel />
    </div>
  )
}
