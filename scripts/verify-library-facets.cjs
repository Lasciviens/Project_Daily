// Verifies src/features/books/libraryFacets.ts and epub/sendDraft.ts (sucrase, no test framework).
require('sucrase/register')
const f = require('../src/features/books/libraryFacets.ts')
const d = require('../src/features/books/epub/sendDraft.ts')
let n = 0
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1) } n++ }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`)
let id = 0
const book = p => ({ id: `b${++id}`, title: 'T', author: null, series: null, series_index: null, kind: 'book', read_status: 'want', categories: [], subjects: [], on_device: false, ...p })

eq(f.foldKey('Jø Nesbø'), 'jo nesbo', 'fold ø')
eq(f.foldKey('  Şeker   Portakalı! '), 'seker portakali', 'fold Turkish + punctuation')
eq(f.splitAuthors('Rowling, J. K.'), ['Rowling, J. K.'], '"Last, First" stays whole')
eq(f.splitAuthors('Terry Pratchett & Neil Gaiman'), ['Terry Pratchett', 'Neil Gaiman'], '& splits')
eq(f.splitAuthors('A; B\nC'), ['A', 'B', 'C'], '; and newline split')

const lib = [
  book({ title: 'Chamber', author: 'J. K. Rowling', series: 'Harry Potter', series_index: '2', read_status: 'finished', categories: ['Fantasy'], subjects: ['Magic'] }),
  book({ title: 'Stone', author: 'j.k. rowling', series: 'harry potter', series_index: '1', read_status: 'reading', categories: ['fantasy', 'Kids'] }),
  book({ title: 'Prisoner', author: 'J. K. Rowling', series: 'Harry Potter', series_index: '3', categories: ['Fantasy'] }),
  book({ title: 'Good Omens', author: 'Terry Pratchett & Neil Gaiman', categories: ['Fantasy'] }),
  book({ title: 'Morning news', author: 'NRK', kind: 'news', series: 'Harry Potter', categories: ['Fantasy'] }),
  book({ title: 'Untold', series: 'Harry Potter' }),
]
const authors = f.facets(lib, 'author')
eq(authors.map(a => [a.label, a.books.length]), [['J. K. Rowling', 3], ['Neil Gaiman', 1], ['Terry Pratchett', 1]], 'authors: "j.k. rowling" joins "J. K. Rowling" (majority spelling), co-authors split, news left out')
const hp = f.facets(lib, 'collection')[0]
eq([hp.label, hp.books.map(b => b.title)], ['Harry Potter', ['Stone', 'Chamber', 'Prisoner', 'Untold']], 'collection: one, majority spelling, series order, unnumbered last, news never')
eq(f.collectionProgress(hp.books), { finished: 1, reading: 1, total: 4 }, 'collection progress')
eq(f.facets(lib, 'category').map(c => [c.label, c.books.length]), [['Fantasy', 4], ['Kids', 1]], 'categories fold case, majority spelling')
eq(f.booksWith(lib, 'collection', 'harry potter').length, 4, 'booksWith by key')
eq(f.knownValues(lib, 'category'), ['Fantasy', 'Kids'], 'known values A–Z')

const names = ['J. K. Rowling', 'Jo Nesbø', 'Neil Gaiman', 'Karl Ove Knausgård']
eq(f.suggest(names, 'nesb'), ['Jo Nesbø'], 'word start, accent-free')
eq(f.suggest(names, 'ro'), ['J. K. Rowling'], 'word start ranks')
eq(f.suggest(names, 'knausgard'), ['Karl Ove Knausgård'], 'å folded')
eq(f.suggest(names, 'jk row'), ['J. K. Rowling'], 'compact match')
eq(f.suggest(names, 'J. K. Rowling'), [], 'an exact match is not suggested again')
eq(f.suggest(names, ''), [], 'nothing typed → nothing')
eq(f.canonical(names, '  jo NESBO '), 'Jo Nesbø', 'canonical picks the library spelling')
eq(f.canonical(names, 'New Author'), 'New Author', 'a new value is kept')
eq(f.cleanTags(['Fantasy'], ['fantasy', 'FANTASY', ' Sci-fi ', '']), ['Fantasy', 'Sci-fi'], 'tags: library spelling, no duplicates, empty dropped')

// ── send draft ──
const meta = { title: 'Stone', authors: ['J.K. Rowling'], language: 'en', publisher: 'B', year: 1997, isbn: '9780747532699', description: 'x', subjects: ['Magic'], series: 'harry potter', seriesIndex: '1', coverPath: null }
const draft = d.draftFromMeta(meta, 'hp1.epub', true)
eq([draft.title, draft.author, draft.series, draft.subjects, draft.status, draft.writeIntoFile], ['Stone', 'J.K. Rowling', 'harry potter', ['Magic'], 'want', true], 'draft from the file')
eq(d.draftFromMeta(null, 'Rowling_-_Harry_Potter_1.kepub.epub', false).title, 'Rowling - Harry Potter 1', 'title from the file name when there are no details')
eq(d.missingFields({ ...draft, author: '', language: ' ' }), ['author', 'language'], 'missing fields')
const known = { author: ['J. K. Rowling'], collection: ['Harry Potter'], category: ['Fantasy'], subject: ['Magic'] }
const norm = d.normalizeDraft({ ...draft, author: 'j. k. rowling & New Person', categories: ['fantasy'] }, known)
eq([norm.author, norm.series, norm.categories], ['J. K. Rowling & New Person', 'Harry Potter', ['Fantasy']], 'normalize to library spellings')
eq(d.findDuplicate(lib, { ...draft, title: 'STONE', author: 'J.K. Rowling' })?.title, 'Stone', 'duplicate by title + author, case-free')
eq(d.findDuplicate(lib, { ...draft, title: 'Morning news', author: '' }), null, 'news is never a duplicate')
eq(d.opfEditOf({ ...norm, writeIntoFile: false }), null, 'no file edit when switched off')
eq(d.opfEditOf(norm), { title: 'Stone', authors: ['J. K. Rowling', 'New Person'], language: 'en', series: 'Harry Potter', seriesIndex: '1', subjects: ['Magic'] }, 'file edit')
eq(d.opfEditOf({ ...norm, series: '' }).seriesIndex, null, 'no index without a series')
const row = d.bookRowOf(norm, meta)
eq([row.title, row.read_status, row.publisher, row.published_year, row.isbn, row.categories], ['Stone', 'want', 'B', 1997, '9780747532699', ['Fantasy']], 'library row')
eq(f.facets([book({ series: 'harry potter' }), book({ series: 'Harry Potter' })], 'collection')[0].label, 'Harry Potter', 'a tie takes the capitalised spelling')
eq(f.editDistance('rowlng', 'rowling'), 1, 'edit distance one')
eq(f.nearMatch(['J. K. Rowling', 'Tolkien'], 'J.K. Rowlng'), 'J. K. Rowling', 'one letter off finds the library spelling')
eq(f.nearMatch(['Tolkien'], 'Tolkein'), 'Tolkien', 'two swapped letters count as one')
eq(f.nearMatch(['Nesbo'], 'Nesbø'), null, 'already the same once folded')
eq(f.nearMatch(['Loe'], 'Lee'), null, 'short names are never guessed')
eq(f.nearMatch(['Hamsun'], 'Murakami'), null, 'nothing close')
eq([d.languageCode('English'), d.languageCode(' norsk '), d.languageCode('en-GB'), d.languageCode('Türkçe')], ['en', 'nb', 'en-GB', 'tr'], 'language names become codes')
const known2 = book({ title: 'Stone (mine)', author: 'J. K. Rowling', categories: ['Fantasy'], subjects: [], language: 'en', read_status: 'reading' })
const again = d.draftFromBook(known2, meta, 'x.epub', true)
eq([again.title, again.categories, again.subjects, again.status], ['Stone (mine)', ['Fantasy'], ['Magic'], 'reading'], 'the same file again starts from the library row')
eq(d.updateFor({ title: 'A', categories: ['Fantasy'], publisher: 'Mine', isbn: null }, { title: 'B', categories: [], subjects: [], publisher: 'File', isbn: '123', author: '' }),
  { title: 'B', isbn: '123' }, 'update: typed fields replace, empty lists never wipe, file facts only fill gaps')
eq(d.updateFor({ title: 'A' }, { title: 'A' }), {}, 'nothing changed → empty update')
console.log(`verify-library-facets: ${n} assertions passed`)
