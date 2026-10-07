import { ExternalLink, RotateCw } from 'lucide-react'
import { ModalShell } from '../../../shared/modals'
import { Button, SkeletonText } from '../../../shared/ui'
import { formatDateTime } from '../../../shared/utils/dateFormat'
import type { NewsItem } from '../api/newsApi'
import { useNewsArticle } from '../hooks/useNewsArticle'

function OpenOnSite({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="btn-secondary min-h-[44px] w-full sm:w-auto">
      <ExternalLink aria-hidden className="h-4 w-4" /> Open on site
    </a>
  )
}

function ArticleImage({ src, alt }: { src: string; alt?: string }) {
  return (
    <img
      src={src}
      alt={alt ?? ''}
      loading="lazy"
      referrerPolicy="no-referrer"
      className="my-4 w-full rounded-card bg-surface-2 object-cover"
      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
    />
  )
}

/**
 * Reads a headline inside the app: the page is fetched and reduced to its text
 * by the `news-article` edge function. Paywalled pages give only their free
 * part, which the sheet says; when the page can't be read it shows the feed's
 * own summary and the link instead.
 */
export function NewsArticleSheet({ item, source, onClose }: { item: NewsItem | null; source: string; onClose: () => void }) {
  const { data, isLoading, error, refetch, isFetching } = useNewsArticle(item?.link ?? null)
  if (!item) return null
  const when = data?.published ?? item.pubDate
  const meta = [data?.siteName ?? source, data?.byline, when ? formatDateTime(when) : null].filter(Boolean).join(' · ')

  return (
    <ModalShell
      open
      onClose={onClose}
      title={source}
      subtitle={meta || undefined}
      size="lg"
      footer={<div className="flex justify-end"><OpenOnSite url={item.link} /></div>}
    >
      <article className="mx-auto max-w-[40rem]">
        <h2 className="text-head font-semibold text-fg">{data?.title ?? item.title}</h2>

        {isLoading && (
          <div className="mt-4 space-y-4" aria-busy>
            <div className="aspect-video w-full animate-pulse rounded-card bg-surface-2" />
            <SkeletonText lines={6} />
          </div>
        )}

        {error && !data && (
          <div className="mt-4 space-y-3">
            {item.thumbnail && <ArticleImage src={item.thumbnail} />}
            {item.summary && <p className="text-body leading-relaxed text-fg-2">{item.summary}</p>}
            <p data-tone="warn" className="tone-soft w-fit rounded-control px-3 py-2 text-meta text-fg">
              The full article couldn’t be loaded here — {(error as Error).message.replace(/\.$/, '')}. Open it on the site to read the rest.
            </p>
            <Button size="sm" icon={<RotateCw />} loading={isFetching} onClick={() => refetch()}>Try again</Button>
          </div>
        )}

        {data && (
          <>
            {data.lead && <p className="mt-3 text-lead font-medium leading-relaxed text-fg-2">{data.lead}</p>}
            {data.image && <ArticleImage src={data.image} alt={data.title ?? ''} />}
            {data.likelyTruncated && (
              <p data-tone="info" className="tone-soft my-3 w-fit rounded-control px-3 py-2 text-meta text-fg">
                This may be only the free part of the article (paywall or a short page). Open it on the site for the rest.
              </p>
            )}
            <div className="mt-3 space-y-3 text-lead leading-relaxed text-fg">
              {data.blocks.map((b, i) => {
                if (b.kind === 'img') return <ArticleImage key={i} src={b.src!} alt={b.alt} />
                if (b.kind === 'h') return <h3 key={i} className="pt-2 text-title font-semibold text-fg">{b.text}</h3>
                return <p key={i}>{b.text}</p>
              })}
            </div>
            {data.paragraphs.length === 0 && !data.lead && (
              <p className="mt-3 text-body text-fg-muted">No readable text was found on this page.</p>
            )}
          </>
        )}
      </article>
    </ModalShell>
  )
}
