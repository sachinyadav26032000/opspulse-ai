/* Task 2: both panel headers must be the same fixed height, both content areas
   must start at the same y, and structural gaps must sit on one unit. */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
/* Repo root, resolved from this file's own location — never an absolute path
   baked in at authoring time, or the suite only runs on one machine. */
const R = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const css = fs.readFileSync(`${R}/assets/live.css`, 'utf8');
const flat = css.replace(/\n/g, ' ');
let fail = 0;
const ok = (c, m) => { console.log(`${c ? ' ok ' : 'FAIL'}  ${m}`); if (!c) fail++; };
const rule = (sel) => (flat.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')) || [])[1] || '';

console.log('── equal header height ──');
const top = rule('.lv-top');
ok(/min-height:\s*var\(--chrome-h\)/.test(top), 'header has a FIXED min-height (not content-driven)');
ok(/flex-wrap:\s*nowrap/.test(top), 'header no longer wraps — wrapping was the cause of the mismatch');
ok(/--chrome-h:\s*56px/.test(css), 'chrome height is 56px = 7 units');
ok(/--u:\s*8px/.test(css), 'rhythm unit declared once as --u: 8px');
// Both panels use the same .lv-top class, so equal height is structural.
const sdUsesTop = fs.readFileSync(`${R}/assets/servicedesk.js`, 'utf8').includes("el('div', 'lv-top')");
const opUsesTop = fs.readFileSync(`${R}/assets/opspulse.js`, 'utf8').includes("el('div', 'lv-top')");
ok(sdUsesTop && opUsesTop, 'both panels render the SAME .lv-top class → equal height is structural, not coincidental');

console.log('\n── content areas share a top edge ──');
ok(/\.op-root, \.sd-root \{[^}]*flex-direction: column/.test(flat), 'both roots are flex columns');
ok(/\.op-root, \.sd-root \{[^}]*height: 100%/.test(flat), 'both roots fill their pane-host');
ok(/\.lv-body \{[^}]*flex: 1/.test(flat), 'body takes the remainder directly beneath the header');
const demo = fs.readFileSync(`${R}/demo.html`, 'utf8');
ok(/grid-template-rows:\s*auto auto 1fr/.test(demo), 'hosts share one grid row → identical top edge');

console.log('\n── nothing gets squeezed now that wrapping is off ──');
for (const sel of ['.lv-live', '.lv-spacer']) ok(/flex: none/.test(rule(sel)), `${sel} holds its size`);
ok(/flex: none/.test(rule('.lv-btn')), '.lv-btn holds its size');
ok(/overflow-x: auto/.test(rule('.lv-nav')) && /min-width: 0/.test(rule('.lv-nav')), '.lv-nav absorbs the overflow instead');
ok((css.match(/^\.lv-nav button \{/gm) || []).length === 1, 'no duplicate .lv-nav button rule left behind');

console.log('\n── 8px rhythm on structural gaps ──');
const rhythm = [
  ['.lv-top', 'padding'], ['.lv-body', 'padding'], ['.panel + .panel', 'margin-top'],
  ['.panel-hd', 'padding'], ['.sd-tools', 'padding'], ['.pager', 'padding'], ['.sd-side', 'padding'],
];
for (const [sel, prop] of rhythm) {
  const body = rule(sel);
  const m = new RegExp(prop + ':\\s*([^;]+)').exec(body);
  const v = m ? m[1].trim() : '(missing)';
  ok(/var\(--u\)/.test(v), `${sel} ${prop}: ${v}`);
}
console.log(fail ? `\n${fail} CHECK(S) FAILED` : '\nall checks passed');
process.exit(fail ? 1 : 0);
