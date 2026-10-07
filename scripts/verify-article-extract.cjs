#!/usr/bin/env node
/*
 * Verification — articleExtract.ts (Home → News → the in-app reader) and its
 * hand mirror in supabase/functions/news-article/index.ts.
 * Against the REAL un-mocked module via sucrase (no unit-test runner by convention).
 *
 * Run: node scripts/verify-article-extract.cjs            (inline fixtures + mirror check)
 *      node scripts/verify-article-extract.cjs --live     (also fetches a few real articles)
 */
require('sucrase/register')
const fs = require('fs')
const path = require('path')

const { extractArticle, decodeEntities, elementRegions } = require('../src/features/home/articleExtract')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

console.log('\n1 · The edge function carries the same extraction code')
{
  const block = (file) => {
    const s = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
    const a = s.indexOf('// <article-extract>')
    const b = s.indexOf('// </article-extract>')
    return a >= 0 && b > a ? s.slice(a, b) : null
  }
  const src = block('src/features/home/articleExtract.ts')
  const fn = block('supabase/functions/news-article/index.ts')
  check('both files have the <article-extract> block', !!src && !!fn)
  check('news-article mirror is identical to src/features/home/articleExtract.ts', src === fn, 'copy the block from the src file into the function')
}

console.log('\n2 · Helpers')
check('entities: named, numeric, Norwegian', decodeEntities('&aring;&oslash;&aelig; &#8211; &#x27;a&#39; &amp;') === "åøæ – 'a' &")
check('unknown entity left alone', decodeEntities('&bogus;') === '&bogus;')
check('nested <article> regions both found', elementRegions('<article>a<article>b</article>c</article>', 'article').length === 2)

const PAGE = `<!doctype html><html><head>
<meta charset="utf-8"><title>Fallback title | Site</title>
<meta property="og:title" content="Kaffe &amp; kake i Tromsø">
<meta property="og:description" content="En kort ingress om saken.">
<meta property="og:image" content="//cdn.example.no/main.jpg?w=1200">
<meta property="og:site_name" content="Eksempel">
<meta property="article:published_time" content="2026-10-07T08:00:00Z">
<meta name="author" content="Kari Nordmann">
</head><body>
<nav><p>Forsiden · Nyheter · Sport · Kultur · Meny som er lang nok</p></nav>
<article class="teaser"><p>Les også: en annen sak som ikke hører hjemme her</p></article>
<article>
  <h1>Kaffe &amp; kake i Tromsø</h1>
  <p>En kort ingress om saken.</p>
  <p>Første avsnitt i saken er lenger enn tjuefem tegn, med <a href="#">en lenke</a> inni.</p>
  <script>var tracking = "<p>Not text from a script tag, should vanish</p>"</script>
  <figure><img src="/img/inline.jpg" width="800" alt="Et bilde"><figcaption>Foto: Noen Fotograf som tok bildet</figcaption></figure>
  <h2>En mellomtittel</h2>
  <p>Andre avsnitt fortsetter historien med flere detaljer om kafeen.</p>
  <img src="/img/avatar-author.jpg" width="48">
  <img src="/img/writer.jpg" width="480" alt="Bilde av Håkon F. Høydal">
  <img src="/img/writer2.jpg" width="1080" alt="Bilde av Mari Malm">
  <img srcset="/img/a.jpg 40w, /img/b.jpg 640w, /img/c.jpg 2000w" src="data:image/gif;base64,AAAA">
  <aside><p>Annonse: kjøp noe helt annet her i dag</p></aside>
  <p>Del artikkelen på Facebook og andre steder i dag</p>
  <p>Tredje avsnitt avslutter saken med et sitat fra eieren av stedet.</p>
  <h2>En tittel uten avsnitt etter</h2>
</article>
<footer><p>Copyright Eksempel AS, alle rettigheter forbeholdt</p></footer>
</body></html>`

console.log('\n3 · Metadata and body from a page')
{
  const a = extractArticle(PAGE, 'https://www.example.no/sak/1')
  check('title from og:title, entities decoded', a.title === 'Kaffe & kake i Tromsø', a.title)
  check('lead, site, byline, date', a.lead === 'En kort ingress om saken.' && a.siteName === 'Eksempel' && a.byline === 'Kari Nordmann' && a.published === '2026-10-07T08:00:00Z')
  check('protocol-relative og:image made https', a.image === 'https://cdn.example.no/main.jpg?w=1200', a.image)
  check('three body paragraphs, in order', a.paragraphs.length === 3 && a.paragraphs[0].startsWith('Første avsnitt') && a.paragraphs[2].startsWith('Tredje'), JSON.stringify(a.paragraphs))
  check('link text kept inside a paragraph', a.paragraphs[0].includes('med en lenke inni'))
  check('the lead is not repeated as a paragraph', !a.paragraphs.includes('En kort ingress om saken.'))
  check('script, aside, nav, footer and teaser article are gone', !a.paragraphs.some(p => /tracking|Annonse|Forsiden|Copyright|Les også/.test(p)))
  check('"Del artikkelen" boilerplate skipped', !a.paragraphs.some(p => p.startsWith('Del artikkelen')))
  check('mid-heading kept; a heading with nothing after it dropped', a.blocks.some(b => b.kind === 'h' && b.text === 'En mellomtittel') && !a.blocks.some(b => b.kind === 'h' && /uten avsnitt/.test(b.text)))
  const imgs = a.blocks.filter(b => b.kind === 'img').map(b => b.src)
  check('inline image absolutized; avatar and "Bilde av <name>" byline portraits skipped; srcset picks ≤1280w', imgs.length === 2 && imgs[0] === 'https://www.example.no/img/inline.jpg' && imgs[1] === 'https://www.example.no/img/b.jpg', JSON.stringify(imgs))
  check('figcaption dropped', !a.paragraphs.some(p => p.startsWith('Foto:')))
  check('short article flagged as maybe truncated', a.likelyTruncated === true)
}

console.log('\n4 · JSON-LD articleBody and paywall')
{
  const body = Array.from({ length: 8 }, (_, i) => `Avsnitt ${i + 1} fra articleBody er en hel setning med nok tekst til å telle.`).join('\n')
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, { '@type': 'NewsArticle', headline: 'LD tittel', articleBody: body, author: [{ '@type': 'Person', name: 'A' }, { name: 'B' }], datePublished: '2026-10-06T10:00:00Z', isAccessibleForFree: false }] })}</script></head>
  <body><article><p>Bare en ingress synlig her for alle lesere uten abonnement.</p></article></body></html>`
  const a = extractArticle(html, 'https://www.example.no/pluss')
  check('title falls back to the JSON-LD headline', a.title === 'LD tittel', a.title)
  check('articleBody wins when clearly longer', a.paragraphs.length === 8 && a.paragraphs[7].startsWith('Avsnitt 8'), String(a.paragraphs.length))
  check('authors joined, date from JSON-LD', a.byline === 'A, B' && a.published === '2026-10-06T10:00:00Z')
  check('isAccessibleForFree:false → likely truncated', a.likelyTruncated === true)
  const broken = extractArticle('<html><head><script type="application/ld+json">{oops</script><title>T</title></head><body><main><p>' + 'Tekst i main som er lang nok. '.repeat(30) + '</p></main></body></html>', 'https://x.no/a')
  check('broken JSON-LD ignored; <main> used without <article>', broken.title === 'T' && broken.paragraphs.length === 1 && broken.likelyTruncated === false)
  check('no site name → the host', broken.siteName === 'x.no')
}

// curl, not node's fetch: it follows redirects like the edge function and uses the system proxy.
function get(url, UA) {
  const { execFileSync } = require('child_process')
  const out = execFileSync('curl', ['-sSL', '-m', '20', '-A', UA, '-H', 'Accept: text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', '-w', '\n__URL__%{url_effective}', url], { maxBuffer: 20 * 1024 * 1024 }).toString('utf8')
  const i = out.lastIndexOf('\n__URL__')
  return { text: out.slice(0, i), url: out.slice(i + 8) }
}

function live() {
  console.log('\n5 · Live pages (network)')
  const UA = 'Mozilla/5.0 (compatible; LascisBoard/1.0; +https://lasciviens.github.io/Project_Daily)'
  // The second item's link (the first is sometimes a live page or a podcast).
  const firstLink = (feed) => {
    const links = [...get(feed, UA).text.matchAll(/<item\b[\s\S]*?<link>(?:<!\[CDATA\[)?\s*([^<\]\s]+)/g)].map(m => m[1].replace(/&amp;/g, '&'))
    return links[1] ?? links[0]
  }
  const urls = [
    ['Tek.no', firstLink('https://www.tek.no/api/rss/rss2/medium/collections')],
    ['BBC', firstLink('https://feeds.bbci.co.uk/news/world/rss.xml')],
    ['Ars Technica', firstLink('https://feeds.arstechnica.com/arstechnica/index')],
    ['VG', firstLink('https://www.vg.no/rss/feed/?categories=1')],
    ['CNN Türk', firstLink('https://www.cnnturk.com/feed/rss/all/news')],
  ]
  for (const [name, url] of urls) {
    if (!url) { check(`${name}: feed gave a link`, false); continue }
    const page = get(url, UA)
    const a = extractArticle(page.text, page.url)
    const chars = a.paragraphs.join(' ').length
    console.log(`    ${name}: “${a.title}” · ${a.paragraphs.length} paragraphs, ${chars} chars, ${a.blocks.filter(b => b.kind === 'img').length} images, truncated=${a.likelyTruncated}`)
    check(`${name}: title, image and at least 3 paragraphs`, !!a.title && !!a.image && a.paragraphs.length >= 3, url)
  }
}

;(async () => {
  if (process.argv.includes('--live')) {
    try { live() } catch (e) { failed++; console.log(`  ✗ live run failed — ${e.message}`) }
  }
  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
})()
