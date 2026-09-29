import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Bot, ChevronDown, Clapperboard, Dumbbell, ExternalLink, Gamepad2, HeartPulse, Home,
  ListChecks, PlugZap, Server, Smartphone, TrainFront, UtensilsCrossed, type LucideIcon,
} from 'lucide-react'
import { Card, CardHeader, TonePill, cx } from '../../../shared/ui'
import {
  AUTH_LABEL, COST_LABEL, DIRECTION_LABEL, DIRECTION_TONE, INTEGRATIONS_PATH, OFFICIAL_TONE, TRANSPORT_LABEL,
  type ApiCategory, type ApiEntry,
} from '../apiRegistry'

// One API on Settings → Integrations and APIs: what it is for and where it shows up, with the
// wiring (functions, secrets by name, cadence, limits) behind "Details".

const CATEGORY_ICON: Record<ApiCategory, LucideIcon> = {
  Platform: Server, AI: Bot, Productivity: ListChecks, Health: HeartPulse, Training: Dumbbell,
  Food: UtensilsCrossed, Media: Clapperboard, Games: Gamepad2, Travel: TrainFront, Home, Device: Smartphone,
}

const LINK = 'inline-flex min-h-[44px] items-center gap-1 text-body font-medium text-accent-600 hover:underline'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 py-1.5">
      <dt className="text-meta text-fg-muted">{label}</dt>
      <dd className="break-words text-body text-fg-2">{children}</dd>
    </div>
  )
}

function Mono({ items }: { items: readonly string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {items.map(s => <code key={s} className="chip font-mono">{s}</code>)}
    </span>
  )
}

export function ApiCard({ api }: { api: ApiEntry }) {
  const [open, setOpen] = useState(false)
  const detailsId = useId()
  const Icon = CATEGORY_ICON[api.category]

  return (
    <Card as="article" className="flex w-full min-w-0 flex-col" aria-label={api.name}>
      <CardHeader wrap icon={<Icon />} title={api.name} subtitle={`${api.provider} · ${api.category}`} />

      <div className="flex flex-wrap gap-1.5">
        <TonePill tone={api.official ? OFFICIAL_TONE.official : OFFICIAL_TONE.unofficial}>
          {api.official ? 'Official' : 'Unofficial'}
        </TonePill>
        <TonePill tone="neutral">{AUTH_LABEL[api.auth]}</TonePill>
        <TonePill tone={DIRECTION_TONE[api.direction]}>{DIRECTION_LABEL[api.direction]}</TonePill>
      </div>

      <p className="mt-3 text-body text-fg">{api.purpose}</p>

      <div className="mt-2">
        <p className="section-label">Used in</p>
        <ul className="flex flex-wrap gap-x-4">
          {api.usedIn.map(u => (
            <li key={u.label + u.path}><Link to={u.path} className={LINK}>{u.label}</Link></li>
          ))}
        </ul>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-x-4 border-t border-line pt-1">
        <a href={api.docsUrl} target="_blank" rel="noopener noreferrer" className={LINK}>
          Docs <ExternalLink aria-hidden className="h-3.5 w-3.5" />
        </a>
        {api.hasIntegrationCard && (
          <Link to={INTEGRATIONS_PATH} className={LINK}><PlugZap aria-hidden className="h-3.5 w-3.5" /> Status</Link>
        )}
        <button type="button" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(o => !o)}
          className="ml-auto inline-flex min-h-[44px] items-center gap-1 rounded-control px-2 text-body font-medium text-fg-2 hover:bg-surface-hover">
          Details <ChevronDown aria-hidden className={cx('h-4 w-4 transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      {open && <ApiDetails id={detailsId} api={api} />}
    </Card>
  )
}

function ApiDetails({ id, api }: { id: string; api: ApiEntry }) {
  return (
    <dl id={id} className="mt-1 divide-y divide-line border-t border-line">
      <Row label="Connected">
        <span className="block">{api.transports.map(t => TRANSPORT_LABEL[t]).join(' · ')}</span>
        <span className="block text-fg-muted">{api.connection}</span>
      </Row>
      {api.edgeFunctions && <Row label="Functions"><Mono items={api.edgeFunctions} /></Row>}
      {api.endpoints && <Row label="Endpoints"><Mono items={api.endpoints} /></Row>}
      <Row label="Auth">{AUTH_LABEL[api.auth]}{api.authNote && <span className="block text-fg-muted">{api.authNote}</span>}</Row>
      {api.secrets && <Row label="Secrets"><Mono items={api.secrets} /></Row>}
      <Row label="Cadence">{api.cadence}</Row>
      {api.tables && <Row label="Tables"><Mono items={api.tables} /></Row>}
      {api.migrations && <Row label="Migrations">{api.migrations.join(', ')}</Row>}
      {api.cost && <Row label="Cost">{COST_LABEL[api.cost]}</Row>}
      {api.limits && <Row label="Limits">{api.limits}</Row>}
      {api.caveats && (
        <Row label="Caveats">
          <ul className="list-disc space-y-1 pl-4">{api.caveats.map(c => <li key={c}>{c}</li>)}</ul>
        </Row>
      )}
      {api.moreDocs && (
        <Row label="More docs">
          <span className="flex flex-wrap gap-x-4">
            {api.moreDocs.map(d => (
              <a key={d.url} href={d.url} target="_blank" rel="noopener noreferrer" className={LINK}>
                {d.label} <ExternalLink aria-hidden className="h-3.5 w-3.5" />
              </a>
            ))}
          </span>
        </Row>
      )}
      <Row label="Since">
        {api.since}
        {api.sinceIsHistoryStart && <span className="block text-fg-muted">Or earlier — the git history starts on this day.</span>}
        <code className="block break-all font-mono text-meta text-fg-faint">{api.sinceFrom}</code>
      </Row>
    </dl>
  )
}
