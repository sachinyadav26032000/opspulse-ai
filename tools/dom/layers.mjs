/* Verifies the product-layer cards: markup, a11y wiring, copy, and the
   expand/collapse behaviour including single-open and row placement. */
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
/* Repo root, resolved from this file's own location — never an absolute path
   baked in at authoring time, or the suite only runs on one machine. */
const R = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');

const html = fs.readFileSync(`${R}/index.html`, 'utf8');
const js = fs.readFileSync(`${R}/assets/landing.js`, 'utf8');

const dom = new JSDOM(html, { url: 'http://localhost:5500/index.html', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;
const doc = window.document;
// jsdom ships no IntersectionObserver; the pre-existing reveal code needs one.
window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
// jsdom has no matchMedia either; default to "motion allowed" so the animated
// path (the one with the real logic in it) is what gets exercised.
window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
// jsdom has no layout: every offsetTop is 0, so all four cards read as one row —
// which is exactly the 4-column desktop case we want to assert here.
window.eval(js);

let fail = 0;
const ok = (c, m) => { console.log(`${c ? ' ok ' : 'FAIL'}  ${m}`); if (!c) fail++; };
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

const grid = doc.getElementById('layerGrid');
const cards = [...grid.querySelectorAll('.layer-card')];
const panels = [...grid.querySelectorAll('.layer-panel')];

console.log('── markup & a11y ──');
ok(cards.length === 4, `${cards.length} layer cards`);
ok(cards.every((c) => c.tagName === 'BUTTON'), 'every card is a real <button>');
ok(cards.every((c) => c.getAttribute('type') === 'button'), 'type="button" (never submits)');
ok(cards.every((c) => c.getAttribute('aria-expanded') === 'false'), 'all start aria-expanded="false"');
ok(cards.every((c) => doc.getElementById(c.getAttribute('aria-controls'))), 'every aria-controls resolves to a panel');
ok(panels.every((p) => p.getAttribute('role') === 'region'), 'panels are regions');
ok(panels.every((p) => doc.getElementById(p.getAttribute('aria-labelledby'))), 'every panel is labelled by its card');
ok(panels.every((p) => p.hidden), 'all panels start hidden');
ok(cards.every((c) => c.querySelector('.layer-chev')), 'every card has a chevron affordance');
ok(cards.every((c) => c.querySelector('.num') && c.querySelector('.ic svg')), 'numerals and icon chips preserved');
ok(cards.map((c) => c.querySelector('.num').textContent).join() === '01,02,03,04', 'numerals still 01–04 in order');

console.log('\n── copy ──');
const titles = cards.map((c) => c.querySelector('h3').textContent.trim());
ok(titles.join(' · ') === 'Detect · Understand · Prioritize · Act', `titles: ${titles.join(' · ')}`);
ok(/prioritization decides what is urgent/.test(doc.querySelector('#product .lead').textContent), 'subheading replaced (US spelling)');
ok(doc.querySelector('#product h2').textContent.includes('Four layers that produce the decision'), 'headline untouched');
ok(!!doc.querySelector('#product h2 .grad-text'), 'gradient treatment on headline preserved');

console.log('\n── panel content ──');
const expect = [
  ['Sources', 'Zendesk · Aircall · Klaus QA · NPS'],
  ['Method', 'Cross-signal correlation, then a reasoning pass over the evidence'],
  ['Ranked by', 'Revenue exposure, not severity or recency'],
  ['Bound to', 'A named playbook and a named owner'],
];
panels.forEach((p, i) => {
  const dts = [...p.querySelectorAll('dt')].map((x) => x.textContent.trim());
  const dds = [...p.querySelectorAll('dd')].map((x) => x.textContent.trim());
  ok(dts.length === 2 && dts[0] === expect[i][0] && dts[1] === 'Example', `panel ${i + 1} labels: ${dts.join(' / ')}`);
  ok(dds[0] === expect[i][1], `panel ${i + 1} first value matches spec`);
  ok(dds[1].length > 40, `panel ${i + 1} example present`);
});

console.log('\n── behaviour ──');
click(cards[0]);
ok(cards[0].getAttribute('aria-expanded') === 'true', 'clicking card 1 opens it');
ok(!panels[0].hidden, 'panel 1 is visible');
ok(panels[0].previousElementSibling === cards[3], 'panel moved AFTER the last card of the row (spans the row)');

click(cards[2]);
ok(cards[2].getAttribute('aria-expanded') === 'true', 'clicking card 3 opens it');
ok(cards[0].getAttribute('aria-expanded') === 'false', 'card 1 closed — one open at a time');
ok(panels[0].hidden, 'panel 1 hidden again');
ok(panels[2].previousElementSibling === cards[3], 'panel 3 also placed after the row');
ok(grid.querySelectorAll('.layer-panel:not([hidden])').length === 1, 'exactly one panel open');

click(cards[2]);
ok(cards[2].getAttribute('aria-expanded') === 'false', 'clicking an open card closes it');
await new Promise((r) => setTimeout(r, 320));   // transitionend never fires in jsdom; the fallback must
ok(grid.querySelectorAll('.layer-panel:not([hidden])').length === 0, 'panel cleans up even with no transitionend (timeout fallback)');

// Keyboard: a real button turns Enter/Space into a click natively. Assert the
// element type contract rather than simulating the browser's own behaviour.
cards[1].focus();
ok(doc.activeElement === cards[1], 'card is focusable');
click(cards[1]);
ok(cards[1].getAttribute('aria-expanded') === 'true', 'activation via click/Enter/Space opens');

console.log('\n── CSS contract ──');
const css = fs.readFileSync(`${R}/assets/styles.css`, 'utf8');
ok(/\.layer-panel\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/.test(css), 'panel spans full grid row (grid-column: 1 / -1)');
ok(/transition:\s*height 0\.2s ease-out, opacity 0\.2s ease-out/.test(css), 'height+opacity animate ~200ms ease-out');
ok(/prefers-reduced-motion: reduce\)\s*\{[^}]*\.layer-panel\s*\{\s*transition:\s*none/.test(css.replace(/\n/g, '')), 'reduced-motion disables the height transition');
ok(/\.layer-card:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--emerald\)/.test(css), 'visible focus ring in the accent colour');
ok(/\[aria-expanded="true"\] \.layer-chev\s*\{[^}]*rotate\(180deg\)/.test(css), 'chevron rotates 180° when open');

console.log(fail ? `\n${fail} CHECK(S) FAILED` : '\nall checks passed');
process.exit(fail ? 1 : 0);
