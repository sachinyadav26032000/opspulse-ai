/* ==========================================================================
   app.html check —  node tools/appcheck.mjs
   --------------------------------------------------------------------------
   app.html used to run on its own PRNG: five hand-written risk cards, a ticker
   of invented one-liners, connector counts that drifted upward on a timer. It
   now reads the shared store, so this harness exists to keep it that way — the
   failure mode it guards against is someone reintroducing a literal and the
   screen quietly going back to describing a company that does not exist.

   Every assertion is "this number came from the dataset", not "this number is
   present": ids must be engine insight ids, connector counts must match record
   counts, and the analytics series must be finite at all three ranges.

       npm install --no-save jsdom && node tools/appcheck.mjs
   ========================================================================== */

import { JSDOM } from 'jsdom';
import fs from 'fs';

const rel = (p) => new URL(p, import.meta.url);
const html = fs.readFileSync(rel('../app.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/app.html', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;

globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.Blob = window.Blob;
globalThis.FileReader = window.FileReader;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
Object.defineProperty(globalThis, 'performance', { value: { now: () => Number(process.hrtime.bigint() / 1000000n) }, configurable: true });
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); } };
window.scrollTo = () => {};
window.Element.prototype.scrollIntoView = () => {};

const errors = [];
const origErr = console.error;
console.error = (...a) => { errors.push(a.join(' ')); origErr(...a); };

/* analytics.js is a classic script that assigns window.Analytics; app.html
   loads it with a plain <script> tag, so evaluate it the same way here. */
new Function('window', 'document', fs.readFileSync(rel('../assets/analytics.js'), 'utf8'))(window, window.document);

await import(rel('../assets/app.js').href);
await new Promise((r) => setTimeout(r, 1200));       // let the deferred auto-select run

const { buildAnalytics, analyticsBounds, dayIndexOf } = await import(rel('../assets/app-data.js').href);
const { createStore } = await import(rel('../data/store.js').href);

const $ = (s) => window.document.querySelector(s);
const $$ = (s) => [...window.document.querySelectorAll(s)];
const g = (s) => `\x1b[32m${s}\x1b[0m`, r = (s) => `\x1b[31m${s}\x1b[0m`, dim = (s) => `\x1b[2m${s}\x1b[0m`;
let checks = 0, fails = 0;
const ok = (label, cond, detail = '') => {
  checks++;
  if (cond) console.log(`  ${g('PASS')} ${label}${detail ? dim('  · ' + detail) : ''}`);
  else { fails++; console.log(`  ${r('FAIL')} ${label}  ${detail}`); }
};

console.log('\n=== app.html against the shared store ===\n');

console.log('— The decision feed —');
const cards = $$('.risk');
ok('rendered from the engine', cards.length > 0, `${cards.length} cards`);
ok('cards carry engine insight ids, not r1…r5',
  cards.length > 0 && cards.every((c) => /^ins_/.test(c.getAttribute('data-id') || '')),
  cards.slice(0, 3).map((c) => c.getAttribute('data-id')).join(', '));
ok('no card shows undefined or NaN',
  !/undefined|NaN/.test($('#feed')?.textContent || 'undefined'));

const detail = $('#detail')?.textContent || '';
ok('the top-ranked insight opened in the detail pane', detail.length > 200 && !/undefined|NaN/.test(detail),
  detail.slice(0, 54).replace(/\s+/g, ' ').trim() + '…');
ok('its dollar range shows the arithmetic behind it',
  /how/i.test(detail) || /uncosted/i.test(detail));

console.log('\n— Numbers that have to come from records —');
const kpiVals = $$('.kpi .v').map((v) => v.textContent.trim());
ok('KPI strip populated', kpiVals.length === 5 && kpiVals.every((v) => v && !/undefined|NaN/.test(v)), kpiVals.join(' | '));

const probe = createStore({ autoStart: false });
const counts = $$('.src .cnt').map((c) => Number(c.textContent.replace(/,/g, '')));
ok('connector counts are real record counts',
  counts[0] === probe.dataset.tickets.length && counts[2] === probe.dataset.qa.length && counts[3] === probe.dataset.nps.length,
  `tickets ${counts[0]} · qa ${counts[2]} · nps ${counts[3]}`);

const qa = $$('.qa-row b').map((b) => b.textContent.trim());
ok('QA bars are scored from the reviews', qa.length > 0 && qa.every((s) => /^\d+%$/.test(s)), qa.join(' '));
ok('health gauge shows the engine score', $('#gaugeNum')?.textContent === String(probe.engine.health.score),
  `${$('#gaugeNum')?.textContent} vs engine ${probe.engine.health.score}`);
ok('ticker renders the store feed', $$('#ticker .tick').length > 0, `${$$('#ticker .tick').length} rows`);

console.log('\n— Analytics —');
const av = window.document.getElementById('view-analytics');
for (const days of [7, 30, 90]) {
  const a = buildAnalytics(probe, days);
  const flat = [...a.csat, ...a.nps, ...a.sla, ...a.handle, ...a.channels.Tickets];
  ok(`${days}d series is finite and correctly sized`,
    a.labels.length === days && a.csat.length === days && flat.every(Number.isFinite),
    `nps ${a.nps[0].toFixed(0)}→${a.nps[a.nps.length - 1].toFixed(0)} · median handle ${a.handle[a.handle.length - 1].toFixed(1)}h`);
  window.Analytics.setProvider((d) => buildAnalytics(probe, d));
  try { window.Analytics.render(av); ok(`${days}d renders`, !/undefined|NaN/.test(av.textContent)); }
  catch (e) { ok(`${days}d renders`, false, e.message); }
}

/* The NPS drop is one of the four injected patterns; if the chart is wired to
   the dataset it has to be visible as a decline, not as noise. */
const a90 = buildAnalytics(probe, 90);
const firstQ = a90.nps.slice(6, 20), lastQ = a90.nps.slice(-14);
const avg = (x) => x.reduce((p, q) => p + q, 0) / x.length;
ok('the NPS decline is legible in the trend line',
  avg(firstQ) - avg(lastQ) > 10, `${avg(firstQ).toFixed(0)} → ${avg(lastQ).toFixed(0)}`);

console.log('\n— Custom date range —');
const bounds = analyticsBounds(probe);
ok('the picker is bounded to the dataset', bounds.days === probe.dataset.meta.days,
  `${bounds.minDate} → ${bounds.maxDate} · ${bounds.days} days`);

/* The boundary the picker offers must be the boundary the chart draws. These
   disagreed by a day until the bounds stopped being formatted in UTC. */
const full = buildAnalytics(probe, bounds.days);
const lastLabel = full.labels[full.labels.length - 1];
const maxAsLabel = new Date(Date.parse(bounds.maxDate + 'T00:00:00'))
  .toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
ok('the latest selectable date is the last point on the chart', lastLabel === maxAsLabel,
  `chart "${lastLabel}" vs picker "${maxAsLabel}"`);

const isoOfDay = (d) => {
  const dt = new Date(probe.dataset.meta.day0 + d * 86400000);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};
let roundTripBad = 0;
for (let d = 0; d < bounds.days; d++) if (dayIndexOf(probe, isoOfDay(d)) !== d) roundTripBad++;
ok('every date maps back to its own day, all 90 of them', roundTripBad === 0,
  `${bounds.days - roundTripBad}/${bounds.days} round-trip`);

for (const [label, range, expect] of [
  ['a mid-dataset window', { from: 60, to: 80 }, 21],
  ['a single day', { from: 42, to: 42 }, 1],
  ['dates picked back-to-front', { from: 80, to: 60 }, 21],
  ['a range wider than the data', { from: -5, to: 500 }, bounds.days],
]) {
  const a = buildAnalytics(probe, range);
  const flat = [...a.csat, ...a.nps, ...a.sla, ...a.handle, ...a.channels.Tickets];
  ok(`${label} → ${expect} points, all finite`,
    a.labels.length === expect && a.csat.length === expect && flat.every(Number.isFinite),
    `${a.labels[0]} → ${a.labels[a.labels.length - 1]}`);
}

/* A custom window must not quietly include data from outside it. */
const mid = buildAnalytics(probe, { from: 30, to: 40 });
const inWindow = probe.dataset.tickets.filter((t) => t.day_index >= 30 && t.day_index <= 40).length;
ok('volume matches the records actually inside the window',
  mid.channels.Tickets.reduce((a, b) => a + b, 0) === inWindow,
  `${mid.channels.Tickets.reduce((a, b) => a + b, 0)} vs ${inWindow} tickets`);

/* Drive the real control, not just the data function. */
window.Analytics.setProvider((r) => buildAnalytics(probe, r), bounds);
window.Analytics.render(av);
const from = av.querySelector('#anFrom'), to = av.querySelector('#anTo'), apply = av.querySelector('#anApply');
ok('the toolbar renders the date inputs', !!from && !!to && !!apply,
  from ? `${from.value} → ${to.value}` : 'missing');
ok('and they are clamped to the dataset',
  from?.min === bounds.minDate && to?.max === bounds.maxDate, `min ${from?.min} · max ${to?.max}`);
/* The 30-day preset ends today, so the "to" field must show the newest
   selectable date — not the day before it, which is what UTC formatting gave. */
ok('the prefilled dates describe the preset window exactly',
  to?.value === bounds.maxDate && from?.value === isoOfDay(bounds.days - 30),
  `${from?.value} → ${to?.value} (expected …${bounds.maxDate})`);

const pickFrom = new Date(probe.dataset.meta.day0 + 50 * 86400000);
const pickTo = new Date(probe.dataset.meta.day0 + 64 * 86400000);
const asIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
from.value = asIso(pickFrom); to.value = asIso(pickTo);
apply.click();
ok('applying a custom range redraws the charts',
  /15 days/.test(av.querySelector('.an-toolbar .updated')?.textContent || ''),
  av.querySelector('.an-toolbar .updated')?.textContent.replace(/\s+/g, ' ').trim());
ok('no preset stays highlighted while a custom range is active',
  [...av.querySelectorAll('#rangeSeg button')].every((b) => !b.classList.contains('on')));
ok('and a Clear button appears', !!av.querySelector('#anClear'));

av.querySelector('#anClear').click();
ok('clearing returns to the 30-day preset',
  /30-day window/.test(av.querySelector('.an-toolbar .updated')?.textContent || '')
  && av.querySelector('#rangeSeg button[data-v="30"]')?.classList.contains('on'));
ok('the charts still render after all that', !/undefined|NaN/.test(av.textContent));

/* ── Keyboard operability ─────────────────────────────────────────────────
   The sidebar items and the severity tabs are <div>/<span> rather than
   <button>, for layout reasons that predate this file. That means none of the
   behaviour a button gives for free is inherited, and all of it had to be
   added by hand: focusability, Enter/Space, and a selected state something
   other than a CSS class can read. A regression here is silent — the mouse
   path keeps working perfectly while the app becomes unusable by keyboard. */
console.log('\n— Keyboard operability —');
const press = (el, key) => {
  const e = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  return e.defaultPrevented;
};
const tabs = $$('.tab'), navItems = $$('.nav-item');

ok('every tab and sidebar item is focusable', [...tabs, ...navItems].every((e) => e.hasAttribute('tabindex')),
  `${tabs.length} tabs + ${navItems.length} nav items`);
ok('they carry a role and a selected state',
  [...tabs, ...navItems].every((e) => e.hasAttribute('role') && e.hasAttribute('aria-selected')));

press(tabs[1], 'Enter');
ok('Enter activates a severity tab', tabs[1].classList.contains('active'), tabs[1].textContent.trim());
ok('aria-selected follows the class', tabs[1].getAttribute('aria-selected') === 'true'
  && tabs[0].getAttribute('aria-selected') === 'false');
const prevented = press(tabs[2], ' ');
ok('Space activates a tab and does not scroll the page',
  tabs[2].classList.contains('active') && prevented);
ok('exactly one tab is selected', tabs.filter((t) => t.getAttribute('aria-selected') === 'true').length === 1);

press(navItems[2], 'Enter');
ok('Enter activates a sidebar view', $('#viewTitle').textContent === 'Analytics', $('#viewTitle').textContent);
ok('exactly one sidebar item is selected',
  navItems.filter((n) => n.getAttribute('aria-selected') === 'true').length === 1);

/* Same class of defect as the two apps: an icon reused inside one menu makes
   two destinations read as one. */
const iconOf = (e) => { const svg = e.querySelector('svg'); return svg ? svg.innerHTML.replace(/\s+/g, '') : null; };
const seenIcons = new Map(); const dupeIcons = [];
for (const n of navItems) {
  const k = iconOf(n); if (!k) continue;
  const label = (n.textContent || '').replace(/\s+/g, ' ').trim();
  if (seenIcons.has(k)) dupeIcons.push(`"${label}" = "${seenIcons.get(k)}"`); else seenIcons.set(k, label);
}
ok('every sidebar item has its own icon', dupeIcons.length === 0, dupeIcons.join('; ') || `${seenIcons.size} distinct`);

const allIds = $$('[id]').map((e) => e.id);
ok('no duplicate element ids', [...new Set(allIds.filter((x, i) => allIds.indexOf(x) !== i))].length === 0);

ok('no console errors during boot', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log(`\n${fails ? r(`${fails} CHECK(S) FAILED`) : g('ALL APP CHECKS PASSED')}  (${checks - fails}/${checks})\n`);
process.exit(fails ? 1 : 0);
