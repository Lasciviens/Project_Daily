// Verifies src/features/books/epub/ (zip.ts, opf.ts, partialMd5.ts) against
// independent tools: node's crypto for MD5, Python's zipfile for building and
// re-checking real EPUB archives. Run: node scripts/verify-epub-tools.cjs
require('sucrase/register')
const crypto = require('node:crypto')
const zlib = require('node:zlib')
const { execFileSync } = require('node:child_process')
const z = require('../src/features/books/epub/zip.ts')
const o = require('../src/features/books/epub/opf.ts')
const m = require('../src/features/books/epub/partialMd5.ts')
let n = 0
const ok = (c, msg) => { if (!c) { console.error('FAIL', msg); process.exit(1) } n++ }
const eq = (x, y, msg) => ok(JSON.stringify(x) === JSON.stringify(y), `${msg}: ${JSON.stringify(x)} !== ${JSON.stringify(y)}`)
const inflate = async d => new Uint8Array(zlib.inflateRawSync(Buffer.from(d)))

// ── MD5 ──
for (const len of [0, 1, 55, 56, 63, 64, 65, 1000, 5000]) {
  const buf = crypto.randomBytes(len)
  eq(m.md5(new Uint8Array(buf)), crypto.createHash('md5').update(buf).digest('hex'), `md5 of ${len} bytes`)
}
eq(m.md5(new TextEncoder().encode('abc')), '900150983cd24fb0d6963f7d28e17f72', 'md5("abc")')

// KOReader's partialMD5, re-implemented independently here (offsets 0, 1024 << 2i).
const ref = buf => {
  const h = crypto.createHash('md5')
  for (let i = -1; i <= 10; i++) {
    const at = i < 0 ? 0 : 1024 * 4 ** i
    if (at >= buf.length) break
    h.update(buf.subarray(at, at + 1024))
  }
  return h.digest('hex')
}
for (const len of [10, 1024, 1025, 4096, 70000, 300000, 2_000_000]) {
  const buf = crypto.randomBytes(len)
  eq(m.partialMd5(new Uint8Array(buf)), ref(buf), `partialMd5 of ${len} bytes`)
}

// ── A real EPUB made by Python's zipfile ──
const OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>Harry Potter &amp; the Stone</dc:title>
    <dc:creator opf:role="aut">J. K. Rowling</dc:creator>
    <dc:language>en</dc:language>
    <dc:publisher>Bloomsbury</dc:publisher>
    <dc:date>1997-06-26</dc:date>
    <dc:identifier id="uid">urn:isbn:978-0-7475-3269-9</dc:identifier>
    <dc:subject>Magic</dc:subject><dc:subject>Fantasy</dc:subject><dc:subject>Magic</dc:subject>
    <dc:description>&lt;p&gt;A boy wizard.&lt;/p&gt;</dc:description>
    <meta name="calibre:series" content="Harry Potter"/>
    <meta name="calibre:series_index" content="1"/>
    <meta name="cover" content="cov"/>
  </metadata>
  <manifest><item id="cov" href="images/cover.jpg" media-type="image/jpeg"/><item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/></spine>
</package>`
const py = `
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1], 'w')
z.writestr(zipfile.ZipInfo('mimetype'), 'application/epub+zip', compress_type=zipfile.ZIP_STORED)
z.writestr('META-INF/container.xml', '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>', compress_type=zipfile.ZIP_DEFLATED)
z.writestr('OEBPS/content.opf', open(sys.argv[2]).read(), compress_type=zipfile.ZIP_DEFLATED)
z.writestr('OEBPS/images/cover.jpg', bytes(range(256)) * 40, compress_type=zipfile.ZIP_DEFLATED)
z.writestr('OEBPS/text/ch1.xhtml', '<html><body>' + 'Hello ' * 500 + '</body></html>', compress_type=zipfile.ZIP_DEFLATED)
z.close()
`
const tmp = require('node:os').tmpdir()
const fs = require('node:fs')
const path = require('node:path')
const epubPath = path.join(tmp, `verify-epub-${process.pid}.epub`)
const opfFile = path.join(tmp, `verify-opf-${process.pid}.xml`)
fs.writeFileSync(opfFile, OPF)
execFileSync('python3', ['-c', py, epubPath, opfFile])
const bytes = new Uint8Array(fs.readFileSync(epubPath))

;(async () => {
  const entries = z.readEntries(bytes)
  ok(entries && entries.length === 5, 'reads 5 entries')
  eq(entries.map(e => e.name)[0], 'mimetype', 'mimetype first')
  const container = new TextDecoder().decode(await z.readFile(bytes, entries, 'META-INF/container.xml', inflate))
  eq(o.opfPath(container), 'OEBPS/content.opf', 'container → OPF path')
  const opfText = new TextDecoder().decode(await z.readFile(bytes, entries, 'OEBPS/content.opf', inflate))
  eq(opfText, OPF, 'inflated OPF equals the original')
  eq(z.crc32(new TextEncoder().encode(OPF)), entries.find(e => e.name === 'OEBPS/content.opf').crc, 'crc32 matches the archive')

  const meta = o.readOpf(opfText, 'OEBPS/content.opf')
  eq(meta.title, 'Harry Potter & the Stone', 'title decoded')
  eq(meta.authors, ['J. K. Rowling'], 'author')
  eq(meta.language, 'en', 'language')
  eq(meta.publisher, 'Bloomsbury', 'publisher')
  eq(meta.year, 1997, 'year from date')
  eq(meta.isbn, '9780747532699', 'ISBN cleaned')
  eq(meta.subjects, ['Magic', 'Fantasy'], 'subjects deduplicated')
  eq(meta.description, 'A boy wizard.', 'description without tags')
  eq(meta.series, 'Harry Potter', 'calibre series')
  eq(meta.seriesIndex, '1', 'series index')
  eq(meta.coverPath, 'OEBPS/images/cover.jpg', 'cover path resolved from meta cover')
  eq(o.resolvePath('OEBPS/content.opf', '../images/a%20b.jpg#x'), 'images/a b.jpg', 'relative path with .. and escapes')

  // EPUB 3 cover-image + belongs-to-collection
  const opf3 = `<package><metadata><dc:title>X</dc:title><meta property="belongs-to-collection" id="c">Discworld</meta><meta refines="#c" property="group-position">4</meta></metadata><manifest><item id="i" properties="cover-image" href="c.png"/></manifest></package>`
  const m3 = o.readOpf(opf3, 'content.opf')
  eq([m3.series, m3.seriesIndex, m3.coverPath], ['Discworld', '4', 'c.png'], 'EPUB 3 collection and cover-image')

  // ── Rewrite ──
  // Only what changed is written; illustrators, sort names and ids stay.
  const same = o.writeOpf(opfText, { title: meta.title, authors: meta.authors, language: meta.language, series: meta.series, seriesIndex: meta.seriesIndex, subjects: meta.subjects }, 'OEBPS/content.opf')
  eq(same, opfText, 'nothing changed → the OPF is returned untouched (file sent as it is)')
  const ill = `<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf"><dc:title id="t">Stone</dc:title><dc:creator opf:role="aut" opf:file-as="Rowling, J.K.">J.K. Rowling</dc:creator><dc:creator opf:role="ill">Jim Kay</dc:creator><dc:creator id="c3">Ann Translator</dc:creator><meta refines="#c3" property="role" scheme="marc:relators">trl</meta></metadata></package>`
  eq(o.readOpf(ill, 'content.opf').authors, ['J.K. Rowling'], 'illustrator (opf:role) and translator (EPUB 3 refines) are not authors')
  const t2 = o.writeOpf(ill, { title: 'Philosopher’s Stone', authors: ['J.K. Rowling'], language: null, series: null, seriesIndex: null, subjects: [] }, 'content.opf')
  ok(t2.includes('<dc:title id="t">Philosopher’s Stone</dc:title>') && t2.includes('opf:file-as="Rowling, J.K."'), 'a title change keeps the element id and the author sort name')
  const a2 = o.writeOpf(ill, { title: 'Stone', authors: ['J. K. Rowling'], language: null, series: null, seriesIndex: null, subjects: [] }, 'content.opf')
  ok(a2.includes('Jim Kay') && a2.includes('Ann Translator') && a2.includes('<dc:creator>J. K. Rowling</dc:creator>') && !a2.includes('>J.K. Rowling<'), 'an author change keeps the illustrator and translator')
  const edited = o.writeOpf(opfText, { title: 'Harry Potter and the Philosopher’s Stone', authors: ['J. K. Rowling', 'Mary GrandPré'], language: 'en', series: 'Harry Potter', seriesIndex: '1', subjects: ['Fantasy', 'Magic & Wizards'] }, 'OEBPS/content.opf')
  const back = o.readOpf(edited, 'OEBPS/content.opf')
  eq(back.title, 'Harry Potter and the Philosopher’s Stone', 'title written')
  eq(back.authors, ['J. K. Rowling', 'Mary GrandPré'], 'two authors written')
  eq(back.subjects, ['Fantasy', 'Magic & Wizards'], 'subjects replaced and escaped')
  eq([back.series, back.seriesIndex, back.publisher, back.isbn, back.coverPath], ['Harry Potter', '1', 'Bloomsbury', '9780747532699', 'OEBPS/images/cover.jpg'], 'untouched fields kept')
  ok((edited.match(/calibre:series"/g) || []).length === 1, 'one series meta, not two')
  ok(edited.includes('<manifest>') && edited.includes('<spine>'), 'manifest and spine untouched')
  const e3 = o.writeOpf(opf3, { title: 'X', authors: ['Terry Pratchett'], language: null, series: 'Discworld', seriesIndex: '5', subjects: [] }, 'content.opf')
  ok(!/group-position/.test(e3) && /calibre:series_index" content="5"/.test(e3), 'a new series replaces EPUB 3 collection metas')
  ok(/xmlns:dc=/.test(e3), 'dc namespace declared when missing')

  const newBytes = z.replaceFile(bytes, entries, 'OEBPS/content.opf', new TextEncoder().encode(edited))
  const outPath = path.join(tmp, `verify-epub-out-${process.pid}.epub`)
  fs.writeFileSync(outPath, newBytes)
  const check = execFileSync('python3', ['-c', `
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
names = z.namelist()
assert names[0] == 'mimetype' and z.getinfo('mimetype').compress_type == 0
print(len(names), z.read('OEBPS/content.opf').decode('utf-8').count('Philosopher'), len(z.read('OEBPS/images/cover.jpg')), z.read('mimetype').decode())
`, outPath]).toString().trim()
  eq(check, '5 1 10240 application/epub+zip', 'Python reads the rewritten EPUB: every CRC good, mimetype first and stored')
  const again = z.readEntries(newBytes)
  eq(new TextDecoder().decode(await z.readFile(newBytes, again, 'OEBPS/content.opf', inflate)), edited, 'reads back what was written')
  eq(z.readEntries(new Uint8Array([1, 2, 3])), null, 'not a zip → null')
  for (const f of [epubPath, opfFile, outPath]) fs.unlinkSync(f)
  console.log(`verify-epub-tools: ${n} assertions passed`)
})().catch(e => { console.error(e); process.exit(1) })
