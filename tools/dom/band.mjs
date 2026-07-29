/* Verifies the reduction band: real values from the store, correct noise/signal
   split, full-width span, and that `decisions` agrees with the brief. */
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
/* Repo root, resolved from this file's own location — never an absolute path
   baked in at authoring time, or the suite only runs on one machine. */
const R = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost:5500/demo.html' });
for (const k of ['window','document','navigator','HTMLElement','Node','Blob','FileReader','getComputedStyle','requestAnimationFrame','cancelAnimationFrame','URL','location','Intl'])
  if (globalThis[k] === undefined) globalThis[k] = k === 'window' ? dom.window : dom.window[k];
globalThis.localStorage = dom.window.localStorage;

const { createStore } = await import(`${R}/data/store.js`);
const { selectBriefDecisions, mountOpsPulse } = await import(`${R}/assets/opspulse.js`);
const { openTickets } = await import(`${R}/engine/web/aggregate.js`);

let fail = 0;
const ok = (c, m) => { console.log(`${c ? ' ok ' : 'FAIL'}  ${m}`); if (!c) fail++; };

const html = fs.readFileSync(`${R}/demo.html`, 'utf8');
const d2 = new JSDOM(html);
const doc = d2.window.document;

console.log('── markup ──');
const band = doc.querySelector('.reduction-band');
ok(!!band, 'band exists');
ok(band.parentElement.classList.contains('panes'), 'band is a DIRECT child of .panes (can span the seam)');
ok(band.getAttribute('role') === 'group' && band.getAttribute('aria-label'), 'band is a labelled group');
const nodes = [...band.querySelectorAll('.reduction-node')];
ok(nodes.length === 5, `${nodes.length} nodes`);
ok(band.querySelectorAll('.reduction-sep').length === 4, '4 chevrons between them');
ok(band.querySelectorAll('.reduction-sep[aria-hidden="true"]').length === 4, 'chevrons hidden from AT');
const labels = nodes.map((n) => n.querySelector('.reduction-label').textContent);
ok(labels.join(' > ') === 'all tickets > open > escalations > signals > decisions', labels.join(' › '));
const cls = nodes.map((n) => (n.classList.contains('is-signal') ? 'signal' : 'noise'));
ok(cls.join(',') === 'noise,noise,noise,signal,signal', `colour split: ${cls.join(' · ')}`);

console.log('\n── DOM order & seam ──');
const kids = [...doc.querySelector('.panes').children].map((c) => c.className.replace(' ', '.'));
ok(kids.length === 5, `panes has 5 direct children: ${kids.join(' | ')}`);
ok(doc.querySelectorAll('.pane-tag.right, .pane-host.right').length === 2, 'right column carries the seam border');
ok(!doc.querySelector('.pane'), 'old nested .pane wrappers removed');

console.log('\n── CSS contract ──');
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
ok(/\.reduction-band\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/.test(css), 'band spans full width (grid-column: 1 / -1)');
ok(/font-variant-numeric:\s*tabular-nums/.test(css), 'tabular-nums set (digits will not jitter)');
ok(/\.is-noise \.reduction-value\s*\{\s*color:\s*var\(--text-soft\)/.test(css), 'noise uses the muted token');
ok(/\.is-signal \.reduction-value\s*\{\s*color:\s*var\(--emerald\)/.test(css), 'signal uses the accent token');
ok(/prefers-reduced-motion: no-preference\)\s*\{[^@]*\.reduction-value\s*\{\s*transition/.test(css.replace(/\n/g,'')), 'animation gated behind no-preference');
ok(!/--border|--text-muted|--text-secondary|--accent\b/.test(css), 'no second naming convention introduced (project tokens only)');
ok(/@media \(max-width: 900px\)[^}]*\{[\s\S]*?\.reduction-value \{ font-size: 20px/.test(css), 'narrow-screen sizing kept');

console.log('\n── values are real, not decorative ──');
const store = createStore({ seed: 20260724, fresh: true, autoStart: false });
const d = store.dataset, e = store.engine;
const expected = {
  all: d.tickets.length,
  open: openTickets(d).length,
  signals: e.run.stats.anomalies_flagged,
  escalations: d.escalations.filter((x) => x.status !== 'Closed').length,
  decisions: selectBriefDecisions(e.insights).length,
};
console.log('   ' + ['all','open','escalations','signals','decisions'].map((k) => `${k}=${expected[k]}`).join('  ›  '));
ok(expected.all > expected.open, 'all > open');
const chain = [expected.all, expected.open, expected.escalations, expected.signals, expected.decisions];
ok(chain.every((v, i) => i === 0 || v < chain[i - 1]), `chain reduces monotonically: ${chain.join(' › ')}`);
ok(expected.decisions >= 1 && expected.decisions <= 6, `decisions is a plausible brief size (${expected.decisions})`);

// The band's decisions figure must equal what the brief actually renders.
const h2 = dom.window.document.createElement('div');
dom.window.document.body.appendChild(h2);
mountOpsPulse(h2, store);
const rendered = h2.querySelectorAll('.bd-item').length;
ok(rendered === expected.decisions, `band decisions (${expected.decisions}) === brief cards rendered (${rendered})`);

// Ticks must move the left of the band and leave decisions alone.
const before = { ...expected };
for (let i = 0; i < 6; i++) store.recompute('test');
store.start(); await new Promise((r) => setTimeout(r, 3600)); store.stop();
const after = {
  all: store.dataset.tickets.length,
  decisions: selectBriefDecisions(store.engine.insights).length,
};
ok(after.all > before.all, `all tickets ticked up (${before.all} → ${after.all})`);
ok(after.decisions === before.decisions, `decisions held steady at ${after.decisions} — the stillness is the argument`);

console.log(fail ? `\n${fail} CHECK(S) FAILED` : '\nall checks passed');
process.exit(fail ? 1 : 0);
