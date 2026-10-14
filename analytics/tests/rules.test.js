// Rules and statistics: each rule fires on a fixture built to trigger it and stays silent below its minimum n.
//   node analytics/tests/rules.test.js
const R = require('../rules.js');
let bad = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) bad = 1; };
const day = (device, o) => Object.assign({date: '2026-10-10', device, views: 0, other: 0, seen: 0, went_downloads: 0, pressed: 0, started: 0, submitted: 0, signup_unseen: 0, wrong_platform: 0}, o);
const base = o => Object.assign({days: 28, views: 0, daily: [], pages: [], reach: [], by_release: [], who: {source: [], lang: []}, downloads_page: {views: 0, clicked: 0}, wrong_platform: {presses: 0, wrong: 0}, broken: {errors: [], speed: []}}, o);
const ids = ins => R.verdicts(ins).map(c => c.id);

// ---- statistics ----
const w = R.wilson(50, 100);
ok(Math.abs(w.lo - 0.4223) < 0.005 && Math.abs(w.hi - 0.5777) < 0.005, 'wilson 50/100 at 90%: 42%–58%');
ok(R.certainty(50, 100) === 'clear' && R.certainty(5, 100) === 'clear' && R.certainty(5, 29) === 'too-early' && R.certainty(15, 30) === 'early' && R.certainty(30, 60) === 'early', 'certainty labels: clear needs 100 and a narrow interval; early from 30; else too early');
ok(R.certainty(10, 99) === 'early' && R.certainty(50, 99) === 'early', 'under 100 page views is never clear');
ok(R.needMore(0, 0) === 68 && R.needMore(50, 100) === 0 && R.needMore(10, 20) === 48, 'needs about N more page views (' + [R.needMore(0, 0), R.needMore(50, 100), R.needMore(10, 20)] + ')');
ok(R.compare({k: 5, n: 100}, {k: 50, n: 100}) === 'below' && R.compare({k: 60, n: 100}, {k: 20, n: 100}) === 'above' && R.compare({k: 3, n: 5}, {k: 2, n: 5}) === 'same', 'intervals that do not overlap are different');

// ---- hidden-on-phone ----
let ins = base({daily: [day('phone', {views: 60, other: 60, seen: 9})]});
ok(ids(ins).includes('hidden-on-phone'), 'hidden-on-phone fires: 9 of 60 phone views');
ok(R.verdicts(ins)[0].finding.includes('15%'), 'hidden-on-phone: 15% in the sentence');
ok(!ids(base({daily: [day('phone', {views: 49, other: 49, seen: 1})]})).includes('hidden-on-phone'), 'hidden-on-phone silent below 50 phone views');
ok(!ids(base({daily: [day('phone', {views: 60, other: 60, seen: 30})]})).includes('hidden-on-phone'), 'hidden-on-phone silent at 50%');
// ---- signup-instead ----
ok(ids(base({daily: [day('phone', {submitted: 10, signup_unseen: 6})]})).includes('signup-instead'), 'signup-instead fires: 6 of 10');
ok(!ids(base({daily: [day('phone', {submitted: 9, signup_unseen: 9})]})).includes('signup-instead'), 'signup-instead silent below 10 signups');
ok(!ids(base({daily: [day('phone', {submitted: 20, signup_unseen: 9})]})).includes('signup-instead'), 'signup-instead silent under 50%');
// ---- downloads-page-leak ----
ok(ids(base({downloads_page: {views: 40, clicked: 10}})).includes('downloads-page-leak'), 'downloads-page-leak fires: 10 of 40 press');
ok(!ids(base({downloads_page: {views: 29, clicked: 0}})).includes('downloads-page-leak') && !ids(base({downloads_page: {views: 40, clicked: 20}})).includes('downloads-page-leak'), 'downloads-page-leak silent below 30 views and at 50%');
// ---- wrong-platform ----
ok(ids(base({wrong_platform: {presses: 20, wrong: 3}})).includes('wrong-platform') && !ids(base({wrong_platform: {presses: 19, wrong: 19}})).includes('wrong-platform') && !ids(base({wrong_platform: {presses: 100, wrong: 5}})).includes('wrong-platform'), 'wrong-platform: fires at 15%, silent under 20 presses and under 10%');
// ---- channels ----
const src = (key, views, download_pct) => ({key, views, active_median: 5, download_pct, signup_pct: 0});
const chan = o => base(Object.assign({daily: [day('desktop', {views: 200, pressed: 20})], who: {source: [], lang: []}}, o));
let c = R.verdicts(chan({who: {source: [src('reddit.com', 40, 60)], lang: []}}));
ok(c.some(x => x.id === 'good-channel' && /reddit\.com/.test(x.finding)), 'good-channel fires: Reddit 60% against a 10% site');
c = R.verdicts(chan({daily: [day('desktop', {views: 200, pressed: 100})], who: {source: [src('facebook.com', 40, 5)], lang: []}}));
ok(c.some(x => x.id === 'weak-channel'), 'weak-channel fires: 5% against a 50% site');
ok(!ids(chan({who: {source: [src('reddit.com', 29, 90)], lang: []}})).some(i => /channel/.test(i)), 'channels silent below 30 views from the source');
ok(!ids(chan({who: {source: [src('x.com', 40, 12)], lang: []}})).some(i => /channel/.test(i)), 'channels silent when intervals overlap');
// ---- broken ----
const pg = (page, views, o) => Object.assign({page, views, phone_views: 0, errors: [], dead: [], faq: [], lcp_n: 0, lcp_median: '', lcp_slow: 0}, o);
c = R.verdicts(base({pages: [pg('index', 100, {errors: [{code: 'res-error-img-hero-png', count: 5}]})]}));
ok(c[0].id === 'broken' && c[0].finding.includes('5%') && /hero-png/.test(c[0].finding), 'broken fires: a file error on 5% of a page’s views');
ok(!ids(base({pages: [pg('index', 49, {errors: [{code: 'js-error-ab', count: 49}]})]})).includes('broken') && !ids(base({pages: [pg('index', 100, {errors: [{code: 'js-error-ab', count: 1}]})]})).includes('broken'), 'broken silent below 50 views and under 2%');
c = R.verdicts(base({pages: [pg('index', 100, {errors: [{code: 'res-error-script-count-js', count: 30}]})]}));
ok(c[0].id === 'broken' && /blocked/.test(c[0].finding) && /no action/.test(c[0].finding), 'broken: a blocked counter is named as an ad blocker, no action');
// ---- slow-phones ----
ok(ids(base({broken: {errors: [], speed: [{device: 'phone', n: 30, median: 5.1, slow_pct: 70}]}})).includes('slow-phones') && !ids(base({broken: {errors: [], speed: [{device: 'phone', n: 29, median: 9, slow_pct: 90}]}})).includes('slow-phones') && !ids(base({broken: {errors: [], speed: [{device: 'phone', n: 90, median: 3, slow_pct: 20}]}})).includes('slow-phones'), 'slow-phones: fires over 4 s, silent under 30 measured and at 3 s');
// ---- looks-clickable ----
c = R.verdicts(base({pages: [pg('index', 100, {dead: [{code: 'dead-img-picture', count: 4}]})]}));
ok(c[0].id === 'looks-clickable' && c[0].finding.includes('4%'), 'looks-clickable fires: 4% of views');
ok(!ids(base({pages: [pg('index', 49, {dead: [{code: 'dead-img-picture', count: 40}]})]})).includes('looks-clickable') && !ids(base({pages: [pg('index', 100, {dead: [{code: 'dead-img-picture', count: 2}]})]})).includes('looks-clickable'), 'looks-clickable silent below 50 views and under 3%');
// ---- drop-off ----
const reach = (views, sections) => ({release: 'UX-1', page: 'index', views, sections});
c = R.verdicts(base({reach: [reach(100, {hero: 100, picture: 90, trust: 40, faq: 35})]}), {labels: {trust: 'Trust'}});
ok(c[0].id === 'drop-off' && /50 points/.test(c[0].finding) && /“Trust”/.test(c[0].finding), 'drop-off fires: 50 points lost before Trust');
ok(!ids(base({reach: [reach(49, {a: 49, b: 0})]})).includes('drop-off') && !ids(base({reach: [reach(100, {a: 100, b: 75})]})).includes('drop-off'), 'drop-off silent below 50 views and under 30 points');
ok(R.verdicts(base({reach: [reach(100, {b: 60, a: 100})]}), {order: {index: ['a', 'b']}})[0].finding.includes('“a” and “b”'), 'drop-off follows the page’s section order when given');
// ---- arabic-gap ----
const lang = (key, views, download_pct) => ({key, views, active_median: 1, download_pct, signup_pct: 0});
ok(ids(base({who: {source: [], lang: [lang('ar', 40, 5), lang('en', 100, 40)]}})).includes('arabic-gap') && !ids(base({who: {source: [], lang: [lang('ar', 29, 0), lang('en', 100, 40)]}})).includes('arabic-gap') && !ids(base({who: {source: [], lang: [lang('ar', 40, 35), lang('en', 100, 40)]}})).includes('arabic-gap'), 'arabic-gap: fires wholly below, silent under 30 views and when intervals overlap');
// ---- release-effect ----
const rel = (release, first, views, o) => Object.assign({page: 'index', release, first, last: first, views, seen: 0, went: 0, pressed: 0, submitted: 0, signup_unseen: 0}, o);
c = R.verdicts(base({by_release: [rel('UX-2026.10.01.01', '2026-10-01T00:00:00Z', 100, {seen: 10}), rel('UX-2026.10.10.01', '2026-10-10T00:00:00Z', 100, {seen: 60})]}));
ok(c[0].id === 'release-effect' && /from 10% to 60%/.test(c[0].finding) && c[0].options[0] === 'Keep it', 'release-effect fires and says keep it when better');
ok(!ids(base({by_release: [rel('a', '2026-10-01T00:00:00Z', 29, {seen: 1}), rel('b', '2026-10-10T00:00:00Z', 100, {seen: 60})]})).includes('release-effect') && !ids(base({by_release: [rel('a', '2026-10-01T00:00:00Z', 100, {seen: 10}), rel('b', '2026-10-10T00:00:00Z', 100, {seen: 14})]})).includes('release-effect'), 'release-effect silent below 30 views each and when intervals overlap');
// ---- ranking, limits, the empty state ----
ins = base({daily: [day('phone', {views: 500, other: 500, seen: 10, submitted: 20, signup_unseen: 18})], downloads_page: {views: 40, clicked: 5}, wrong_platform: {presses: 30, wrong: 9},
  pages: [pg('index', 100, {errors: [{code: 'js-error-ab', count: 5}], dead: [{code: 'dead-img-picture', count: 5}]})], broken: {errors: [], speed: [{device: 'phone', n: 50, median: 6, slow_pct: 80}]}});
const many = R.verdicts(ins);
ok(many.length === 5 && many[0].impact >= many[4].impact, 'at most five cards, highest impact first (' + many.map(x => x.id).join(', ') + ')');
ok(many.every(x => x.options.length >= 1 && x.evidence && ['clear', 'early', 'too-early'].includes(x.certainty)), 'every card has options, an evidence block and a certainty label');
ok(many.every(x => !/download button/i.test(x.finding + x.options.join(' '))), 'no card suggests adding a download button');
ok(R.verdicts(base({})).length === 0 && R.verdicts(null).length === 0 && R.verdicts({}).length === 0, 'no data, no cards, no errors');
const q = R.nothingClear(base({views: 14, days: 7, daily: [day('phone', {other: 10, views: 10})]}));
ok(q.finding === 'Nothing is clear yet.' && /about 45 days/.test(q.options[0]) && /90 more/.test(q.options[0]), 'nothing clear: says how many page views and how many days (' + q.options[0] + ')');
ok(R.nothingClear(base({})).finding === 'No page views yet.', 'no page views at all is said plainly');
process.exitCode = bad;
