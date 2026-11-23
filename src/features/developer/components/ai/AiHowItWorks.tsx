import type { ReactNode } from 'react'
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react'
import { ChevronDown, ExternalLink } from 'lucide-react'
import { Card, CardHeader, MetaLine, PageBoard, Skeleton, TonePill, ToneDot } from '../../../../shared/ui'
import { useChatInstructions, useClaudeDescribe, useToolSettings } from '../../../ai/claude/hooks/useClaude'
import { chatToolModes, formatCount, formatUsd, modelNameOf, sourceUrl } from '../../../ai/claude/ledgerRules'
import { toolLabel } from '../../../ai/chat/chatRules'
import type { Describe, DescribeJob } from '../../../ai/claude/types'
import { AI_HOW_BOARD, type AiHowSection } from '../../developerBoards'
import { AI_GLOSSARY } from './aiGlossary'
import { PlainText, ReadFailed } from './aiBits'
import { AiDiagnose } from './AiDiagnose'

// Developer → AI → Learn → How it works: what the `claude` function says about itself (`describe`) — whether its key
// is set, the path of one request, its parts with their source files, every job with its fixed instructions
// and answer shape, and the rules that are code — plus the page's own glossary, the check of the connection
// (Diagnose). Nothing here can be changed.

/** A source file as a link to its page on GitHub; a path that isn't a plain repo path stays text. */
function SourceLink({ file }: { file: string }) {
  const url = sourceUrl(file)
  if (!url) return <span className="break-all font-mono text-meta text-fg-muted">{file}</span>
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 text-meta font-semibold text-accent-600">
      <span className="min-w-0 break-all font-mono">{file}</span>
      <ExternalLink aria-hidden className="h-3 w-3 shrink-0" />
    </a>
  )
}

/** A long fixed text behind one line: closed until asked for. */
function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Disclosure as="div" className="rounded-row border border-line">
      <DisclosureButton className="group flex min-h-[40px] w-full items-center justify-between gap-2 px-3 text-left text-body font-medium text-fg-2">
        {title}
        <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-fg-faint transition-transform group-data-[open]:rotate-180" />
      </DisclosureButton>
      <DisclosurePanel className="border-t border-line p-2">{children}</DisclosurePanel>
    </Disclosure>
  )
}

function StatusCard({ about }: { about: Describe }) {
  const { provider, limits } = about
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-lead font-semibold text-fg">Anthropic key</p>
        <TonePill tone={about.configured ? 'success' : 'warn'}>
          <ToneDot tone={about.configured ? 'success' : 'warn'} />
          {about.configured ? 'Set on the server' : 'Not set'}
        </TonePill>
      </div>
      <p className="mt-1 text-meta text-fg-2">
        {about.configured
          ? 'The key lives only on the server, as the secret ANTHROPIC_API_KEY. The app never sees it: it only learns that it is set.'
          : 'Until the key is set, every job answers “not set up” and nothing is sent. You set it yourself: Supabase → Edge Functions → Secrets → ANTHROPIC_API_KEY. Never paste it in a chat.'}
      </p>
      <dl className="mt-3 grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-x-3 gap-y-1 border-t border-line pt-3 text-meta">
        {([
          ['Provider', provider.name], ['SDK', provider.sdk], ['Anthropic API version', provider.apiVersion], ['Endpoint', provider.endpoint],
          ['Calls', `${formatCount(limits.callsPerMinute)} a minute · ${formatCount(limits.callsPerDay)} a day at most`],
          ['Budget ceiling', `${formatUsd(limits.monthlyBudgetMaxUsd)} a month`],
          ['Request size', `${formatCount(limits.requestMaxBytes)} bytes at most`],
        ] as const).filter(([, v]) => v).map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-medium text-fg-muted">{label}</dt>
            <dd className="min-w-0 break-words tabular-nums text-fg">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}

function JobCard({ job, about }: { job: DescribeJob; about: Describe }) {
  return (
    <Card className="flex flex-col gap-2.5">
      <div>
        <p className="text-lead font-semibold text-fg">{job.title}</p>
        <MetaLine className="text-meta text-fg-muted" items={[
          <span className="font-mono">{job.name}</span>, job.version && <span className="whitespace-nowrap">instructions version {job.version}</span>,
          job.kind && job.kind.replace(/_/g, ' '), job.callers.length > 0 && `asked from: ${job.callers.join(', ')}`,
        ]} />
      </div>
      {job.what && <p className="text-body text-fg-2">{job.what}</p>}
      <MetaLine className="text-meta tabular-nums text-fg-2" items={[
        job.defaults.model && `Default model: ${modelNameOf(about.models, job.defaults.model)}`,
        job.defaults.effort && `effort ${job.defaults.effort}`,
        job.defaults.maxOutputTokens > 0 && `longest answer ${formatCount(job.defaults.maxOutputTokens)} tokens`,
      ]} />
      {job.features.length > 0 && (
        <ul aria-label="Anthropic features used" className="flex list-disc flex-col gap-0.5 pl-4 text-meta text-fg-2 marker:text-fg-faint">
          {job.features.map(f => <li key={f}>{f}</li>)}
        </ul>
      )}
      {job.instructions && <Fold title="The fixed instructions, as sent"><PlainText>{job.instructions}</PlainText></Fold>}
      {job.answerSchema != null && <Fold title="The answer’s shape (JSON Schema)"><PlainText>{JSON.stringify(job.answerSchema, null, 2)}</PlainText></Fold>}
      {job.tools.length > 0 && (
        <Fold title={`Tools (${job.tools.length})`}>
          <ul className="flex flex-col gap-1.5 p-1 text-meta">
            {job.tools.map(t => <li key={t.name}><span className="font-mono font-medium text-fg">{t.name}</span> <span className="text-fg-2">— {t.what}</span></li>)}
          </ul>
        </Fold>
      )}
      {job.sourceFiles.length > 0 && (
        <ul aria-label="Source files" className="flex flex-col gap-0.5">
          {job.sourceFiles.map(f => <li key={f}><SourceLink file={f} /></li>)}
        </ul>
      )}
    </Card>
  )
}

/**
 * What a NEW Ask AI chat will start with: your own words (the second system block, after the fixed rules), the tools and
 * their modes, and the limits of photos. A chat keeps what it started with. Read-only here: Settings changes it.
 */
function AskAiSetup({ about }: { about: Describe }) {
  const tools = useToolSettings()
  const words = useChatInstructions()
  const modes = chatToolModes(about.chat.tools, tools.data ?? [])
  const mode = { on: 'allowed', ask: 'ask first', off: 'off' } as const
  const lim = about.chat.limits
  return (
    <Card>
      <CardHeader variant="label" title="Ask AI: what a new chat starts with" />
      <dl className="flex flex-col gap-2 text-meta text-fg-2">
        <div>
          <dt className="text-body font-semibold text-fg">Your instructions</dt>
          <dd>{words.isError ? 'Could not be read.' : words.data ? <span className="whitespace-pre-wrap break-words">{words.data}</span> : 'None written. Settings → Your instructions.'}</dd>
          <dd className="text-fg-muted">Every new chat starts with these words, and so does the phone’s answer. They are kept apart from the assistant’s fixed safety rules and from your messages, and they cannot change those rules.</dd>
        </div>
        <div>
          <dt className="text-body font-semibold text-fg">Tools</dt>
          <dd>{about.chat.tools.map(t => `${toolLabel(t.name)}: ${mode[modes[t.name]]}`).join(' · ')}</dd>
          <dd className="text-fg-muted">Ask AI, the Training coach and the phone each use their own set of these. Off stops a tool at once; anything else you change reaches chats you start afterwards, and a chat shows the tools it started with.</dd>
        </div>
        <div>
          <dt className="text-body font-semibold text-fg">Photos and voice</dt>
          <dd>Up to {lim.imagesPerMessage} photos in a message and {lim.imagesPerChat} in a chat, each shrunk in the browser to at most {formatCount(lim.photoLongSide)} px. A photo is kept with its chat, so the chat can be continued as it was, and goes when the chat is deleted or its days run out. The first photo in a chat makes that answer a little dearer.</dd>
          <dd>The microphone uses your browser’s own speech recognition and only fills the message box. Lasci’s Board never receives the sound; the browser’s maker may process it (on an iPhone, Apple).</dd>
        </div>
        <div>
          <dt className="text-body font-semibold text-fg">The coach chat and the phone</dt>
          <dd>Training → Coach → Chat with the coach opens Ask AI with the coach’s own instructions and read-only tools. The phone’s question uses the same read tools you leave on (and your instructions), one round at most, and cannot propose, write or take photos.</dd>
        </div>
        <div>
          <dt className="text-body font-semibold text-fg">About me</dt>
          <dd>The About me tool reads the notes in Developer → Memory. You edit them there; the chat never writes them.</dd>
        </div>
      </dl>
    </Card>
  )
}

export function AiHowItWorks() {
  const about = useClaudeDescribe()
  // Diagnose does not need the description: it stays usable when the description could not be read.
  if (about.isError) {
    return (
      <div className="flex max-w-4xl flex-col gap-3">
        <AiDiagnose />
        <ReadFailed what="the function’s description of itself" error={about.error} onRetry={() => { void about.refetch() }} retrying={about.isFetching} />
      </div>
    )
  }
  const d = about.data
  const wait = (h: string) => <Skeleton rounded="rounded-card" className={`${h} w-full`} />
  const sections: Record<AiHowSection, ReactNode> = {
    diagnose: <AiDiagnose />,
    chat: d ? <AskAiSetup about={d} /> : wait('h-72'),
    status: d ? <StatusCard about={d} /> : wait('h-60'),
    steps: !d ? wait('h-96') : (
      <Card>
        <CardHeader variant="label" title="The path of one request" />
        {d.steps.length === 0
          ? <p className="text-body text-fg-muted">The function lists no steps.</p>
          : (
            <ol className="flex flex-col gap-3">
              {d.steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-2 text-meta font-semibold tabular-nums text-fg-2">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-body font-semibold text-fg">
                      {s.title}
                      {s.part && <span className="chip font-mono">{s.part}</span>}
                    </p>
                    <p className="text-body text-fg-2">{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
      </Card>
    ),
    jobs: !d ? wait('h-72') : d.jobs.length === 0
      ? <Card><p className="text-body text-fg-muted">The function lists no jobs.</p></Card>
      : <div className="flex flex-col gap-3">{d.jobs.map(j => <JobCard key={j.name} job={j} about={d} />)}</div>,
    parts: !d ? wait('h-80') : (
      <Card>
        <CardHeader variant="label" title="The function’s parts" />
        <ul className="-my-2 divide-y divide-line">
          {d.parts.map(p => (
            <li key={p.name} className="py-2">
              <p className="text-body font-semibold text-fg">{p.name}</p>
              <p className="text-meta text-fg-2">{p.what}</p>
              {p.file && <SourceLink file={p.file} />}
            </li>
          ))}
        </ul>
      </Card>
    ),
    rules: !d ? wait('h-56') : (
      <Card>
        <CardHeader variant="label" title="Fixed rules (they are code)" />
        <ul className="flex list-disc flex-col gap-1.5 pl-4 text-body text-fg-2 marker:text-fg-faint">
          {d.safetyRules.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </Card>
    ),
    glossary: (
      <Card>
        <CardHeader variant="label" title="Glossary" />
        <dl className="flex flex-col gap-2">
          {AI_GLOSSARY.map(g => (
            <div key={g.term}>
              <dt className="text-body font-semibold text-fg">{g.term}</dt>
              <dd className="text-meta text-fg-2">{g.what}</dd>
            </div>
          ))}
        </dl>
      </Card>
    ),
  }
  return <PageBoard sections={sections} layout={AI_HOW_BOARD} stackGap="gap-3" stackClassName="max-w-4xl" />
}
