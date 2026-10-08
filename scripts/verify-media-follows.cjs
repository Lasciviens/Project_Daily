#!/usr/bin/env node
/** verify-media-follows.cjs — What's new rules and the follow-list retry (src/features/media/trakt/followRules.ts), shared with trakt-api. */
require('sucrase/register')
const F = require('../src/features/media/trakt/followRules.ts')
let n = 0
const ok = (a, e, label) => { const x = JSON.stringify(a), y = JSON.stringify(e); if (x !== y) { console.error(`FAIL ${label}\n  expected ${y}\n  actual   ${x}`); process.exit(1) } n++ }

const film = { id: 1, release_date: '2026-11-20', poster_path: '/p.jpg', genre_ids: [28, 12], adult: false, video: false }
// Feature films only
ok(F.followRejectReason(film, 'company'), null, 'a feature film passes')
ok(F.followRejectReason({ ...film, genre_ids: [99] }, 'company'), 'non_feature_genre', 'a documentary is out')
ok(F.followRejectReason({ ...film, genre_ids: [10770, 18] }, 'collection'), 'non_feature_genre', 'a TV movie is out, collections too')
ok(F.followRejectReason({ ...film, genre_ids: [99] }, 'actor'), 'non_feature_genre', 'a person follow drops documentaries too')
ok(F.followRejectReason({ ...film, video: true }, 'keyword'), 'video', 'TMDB video=true (direct-to-video, compilations) is out')
ok(F.followRejectReason({ ...film, adult: true }, 'company'), 'adult', 'adult titles are out')
ok(F.followRejectReason({ ...film, media_type: 'tv' }, 'collection'), 'not_movie', 'a non-movie part is out')
ok(F.followRejectReason({ ...film, media_type: 'movie' }, 'collection'), null, 'media_type movie passes')
ok(F.followRejectReason({ id: 2 }, 'company'), 'stub', 'no date and no poster is a stub')
ok(F.followRejectReason({ id: 2, poster_path: '/x.jpg' }, 'company'), null, 'announced with a poster but no date passes')
ok(F.followRejectReason({ ...film, job: 'Producer' }, 'director'), 'not_director', 'a director follow keeps Director credits only')
ok(F.followRejectReason({ ...film, job: 'Director' }, 'director'), null, 'Director credit passes')
for (const c of ['Self', 'Himself', 'Herself - Host', 'Themselves', 'Self (archive footage)', 'Tony Stark (archive footage)', 'Archive Footage', 'Tony Stark (uncredited)', 'Narrator', 'Narrator (voice)'])
  ok(F.followRejectReason({ ...film, character: c }, 'actor'), 'not_a_role', `"${c}" is not a role`)
for (const c of ['Tony Stark', 'Groot (voice)', 'Selfridge', 'Dr. Self', '', null])
  ok(F.followRejectReason({ ...film, character: c }, 'actor'), null, `"${c}" is a role`)
ok(F.isFollowFeature(film, 'company'), true, 'isFollowFeature mirrors the reason')

// New by the film's own date
ok(F.isNewByDate('2019-04-24', '2026-10-06'), false, 'Avengers: Endgame (2019) is never new, however late TMDB lists it')
ok(F.isNewByDate('2026-12-18', '2026-10-06'), true, 'an upcoming film is new')
ok(F.isNewByDate('2026-10-06', '2026-10-06'), true, 'out today is new')
ok(F.isNewByDate('2026-09-06', '2026-10-06'), true, 'out exactly 30 days ago is still new')
ok(F.isNewByDate('2026-09-05', '2026-10-06'), false, 'out 31 days ago is not')
ok(F.isNewByDate(null, '2026-10-06'), true, 'announced without a date is new')
ok(F.isNewByDate('2026-09-10', '2026-10-06T23:30:00.000Z'), true, 'a timestamp asOf uses its day')

// Stored events: judged on the day they were written
ok(F.isShowableFollowEvent({ release_date: '2019-04-24', created_at: '2026-10-01T07:07:00Z' }), false, 'the reported Endgame row is hidden')
ok(F.isShowableFollowEvent({ release_date: '2026-09-20', created_at: '2026-09-25T07:07:00Z' }), true, 'a film new when reported stays, even weeks later')
ok(F.isShowableFollowEvent({ release_date: null, created_at: '2026-09-25T07:07:00Z' }), true, 'an undated event stays')

// Details and trailers
ok(F.followDetailsReject({ runtime: 8, status: 'Released' }), 'short', 'an 8-minute short is out')
ok(F.followDetailsReject({ runtime: 0, status: 'Post Production' }), null, 'unknown runtime never rejects')
ok(F.followDetailsReject({ runtime: 120, status: 'Canceled' }), 'canceled', 'a cancelled film is out')
ok(F.followDetailsReject(null), null, 'no details never reject')
ok(F.isFollowTrailer({ site: 'YouTube', type: 'Trailer', official: true, key: 'k' }), true, 'an official YouTube trailer counts')
ok(F.isFollowTrailer({ site: 'YouTube', type: 'Trailer', key: 'k' }), true, 'official missing counts (TMDB default true)')
for (const t of ['Teaser', 'Clip', 'Featurette', 'Behind the Scenes', 'Bloopers'])
  ok(F.isFollowTrailer({ site: 'YouTube', type: t, official: true, key: 'k' }), false, `${t} is not a trailer`)
ok(F.isFollowTrailer({ site: 'YouTube', type: 'Trailer', official: false, key: 'k' }), false, 'an unofficial trailer is out')
ok(F.isFollowTrailer({ site: 'Vimeo', type: 'Trailer', key: 'k' }), false, 'only YouTube (the app links YouTube)')

// The linked Trakt list: a film is done only when Trakt took it (pending_list_ids, migration 136)
ok(F.followListToSend([3, 4], [5, 3], new Set([3, 4, 5])), [3, 4, 5], 'waiting films first, then new ones, each once')
ok(F.followListToSend([3, 4], [5], new Set([4, 5])), [4, 5], 'a waiting film TMDB no longer lists for the follow is dropped')
ok(F.followListToSend([3, 4], [], null), [3, 4], 'TMDB listed nothing: the waiting films are all kept (a bad answer never empties the queue)')
ok(F.followListToSend([3], [], new Set()), [3], 'an empty TMDB list counts as nothing listed')
ok(F.followListToSend([0, -2, Number.NaN], [7], null), [7], 'invalid ids are never sent')
ok(F.followListPending({ ids: [1, 2, 3], accepted: 3, notFound: [] }, new Set()), [], 'Trakt took every film: nothing waits')
ok(F.followListPending({ ids: [1, 2, 3], accepted: 0, notFound: [] }, new Set()), [1, 2, 3], 'refused (420 account limit) or no Trakt sign-in: every film waits for the next check')
ok(F.followListPending({ ids: [1, 2, 3, 4], accepted: 2, notFound: [] }, new Set()), [3, 4], 'a request failed half-way: the films not taken wait')
ok(F.followListPending({ ids: [1, 2, 3], accepted: 3, notFound: [2, 3] }, new Set([2])), [2], 'Trakt doesn\'t know a new film yet: it waits; an older unknown film is dropped')
ok(F.followListPending({ ids: [1, 2, 3], accepted: 1, notFound: [1, 3] }, new Set([1, 3])), [2, 3, 1], 'not-found films are judged only among those sent; the rest wait anyway')

console.log(`verify-media-follows: ${n} assertions passed`)
