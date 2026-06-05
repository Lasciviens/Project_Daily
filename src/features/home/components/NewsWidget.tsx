import { useState } from 'react'
import { useNews } from '../hooks/useHomeData'
import { NEWS_FEEDS } from '../api/newsApi'

export function NewsWidget() {
  const [feedKey, setFeedKey] = useState('nrk')
  const { data, isLoading, error } = useNews(feedKey)

  return (
    <div className="bg-white rounded-xl border border-ink-200 p-4 shadow-sm flex flex-col">
      {/* Header + feed selector */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-ink-400 uppercase tracking-wide">News</h3>
        <div className="flex gap-1">
          {NEWS_FEEDS.map(f => (
            <button
              key={f.key}
              onClick={() => setFeedKey(f.key)}
              className={`px-2 py-0.5 text-xs rounded-md font-medium transition-colors duration-150 ${
                feedKey === f.key
                  ? 'bg-accent-500 text-white'
                  : 'text-ink-500 hover:bg-ink-100'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <div className="text-ink-400 text-sm">Loading…</div>}
      {error && <div className="text-ink-400 text-sm">Feed unavailable</div>}

      {data && (
        <ul className="space-y-3">
          {data.slice(0, 6).map((item, i) => (
            <li key={i}>
              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className="group block"
              >
                <div className="text-sm font-medium text-ink-800 group-hover:text-accent-600 leading-snug line-clamp-2 transition-colors duration-150">
                  {item.title}
                </div>
                <div className="text-xs text-ink-400 mt-0.5">
                  {new Date(item.pubDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
