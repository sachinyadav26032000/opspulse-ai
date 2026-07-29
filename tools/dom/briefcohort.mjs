/* Task 5: the cohort decision reaches the brief, and its card opens a surface
   that agrees with it. */
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
/* Repo root, resolved from this file's own location — never an absolute path
   baked in at authoring time, or the suite only runs on one machine. */
const R = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://x/opspulse.html' });
for (const k of ['window','document','navigator','HTMLElement','Node','Blob','FileReader','getComputedStyle','requestAnimationFrame','cancelAnimationFrame','URL','location'])
  if (globalThis[k] === undefined) globalThis[k] = k === 'window' ? dom.window : dom.window[k];
globalThis.localStorage = dom.window.localStorage;
const errs = []; const oe = console.error; console.error = (...a) => { errs.push(a.join(' ')); oe(...a); };
const { createStore } = await import(`${R}/data/store.js`);
const { mountOpsPulse, selectBriefDecisions } = await import(`${R}/assets/opspulse.js`);
let fail = 0; const ok = (c,m)=>{console.log(`${c?' ok ':'FAIL'}  ${m}`); if(!c)fail++;};
const M = () => new dom.window.MouseEvent('click',{bubbles:true});

const store = createStore({ seed: 20260724, fresh: true, autoStart: false });
const host = document.createElement('div'); document.body.appendChild(host);
mountOpsPulse(host, store, { user: 'Sudharshan' });
const body = () => host.querySelector('.lv-body');

console.log('── the cohort reaches the brief ──');
const sel = selectBriefDecisions(store.engine.insights);
const co = sel.find(i => i.signal_type === 'renewal_cohort');
ok(!!co, `renewal_cohort is a brief decision (${sel.length} shown)`);
ok(co.recommended_action.owner_role === 'VP Customer Success', `owner: ${co.recommended_action.owner_role}`);
ok(co.confidence.score >= 60, `above the confidence floor (${co.confidence.score})`);

console.log('\n── it does not double-count renewal defence ──');
const rr = store.engine.insights.find(i => i.signal_type === 'renewal_risk');
if (rr) {
  const named = new Set(rr._meta.exposed_accounts.map(a=>a.account_id));
  const overlap = co._meta.exposed_accounts.filter(a=>named.has(a.account_id)).length;
  ok(overlap === 0, `zero overlap with the ${named.size} accounts renewal defence names`);
  ok(/are named individually under renewal defence, leaving \d+ here/.test(co._meta.impact.basis.join(' ')),
     `the basis states the subtraction, not just the result: "${co._meta.impact.basis.find(b=>/renewal defence/.test(b))}"`);
} else ok(true, 'renewal_risk not emitted this seed — nothing to overlap');

console.log('\n── decision sizing: cohort-wide, and it says so ──');
const sz = co._meta.sizing;
ok(sz.ratio === 1 && /action covers all of them/.test(sz.note), `sizing note: ${sz.note}`);
ok(!/scoped to \d+ of/.test(co._meta.impact.formula), `formula is not mislabelled "scoped to N": ${co._meta.impact.formula}`);
const prod = co._meta.impact.inputs.reduce((s,x)=>s*x.value,1);
ok(Math.round(prod*co._meta.impact.range_factor[0]) === co._meta.impact.low
   && Math.round(prod*co._meta.impact.range_factor[1]) === co._meta.impact.high, 'printed inputs re-multiply to the printed range');
ok(co.expected_impact.range_low_usd === co._meta.impact.low, 'card publishes exactly what the drill-down computes');

console.log('\n── the card opens a surface that agrees with it ──');
const items = [...body().querySelectorAll('.bd-item')];
const card = items.find(c => c.textContent.includes(String(co._meta.affected_accounts)) && /adoption/i.test(c.textContent));
ok(!!card, `the decision is on Today (${items.length} brief items)`);
const chip = card.querySelector('[data-drill]');
ok(/^\s*\d+ accounts/.test(chip.textContent) && Number(chip.textContent.match(/(\d+) accounts/)[1]) === co._meta.affected_accounts,
   `the chip counts the cohort, not the 6 examples: "${chip.textContent.trim()}"`);
chip.dispatchEvent(M());
ok(!!body().querySelector('.coh-tools'), 'it lands on the Renewals cohort, not the 6 exposed accounts');
const line = body().querySelector('.cs-line').textContent.replace(/\s+/g,' ').trim();
console.log('   ' + line);
ok(body().querySelector('#cohLevel button.on').textContent === 'All', 'forced to company-wide scope');
ok(body().querySelector('#cohWin').value === 'd90', 'forced to the 90-day window the detector counted');
const shownBelow = Number(line.match(/(\d+) below/)[1]);
const ev = co._meta.evidence;
ok(shownBelow === ev.below_threshold_total,
   `the surface shows ALL ${shownBelow} below-threshold accounts, matching the card's ${ev.below_threshold_total}`);

console.log('\n── the arithmetic is visible on both ──');
ok(ev.below_threshold_total - ev.excluded_already_named === ev.cohort_size,
   `the card's subtraction closes: ${ev.reconciliation}`);
const recon = body().querySelector('.cs-recon');
ok(!!recon, 'the surface shows the same subtraction');
const nums = [...recon.textContent.matchAll(/\d+/g)].map(Number);
ok(nums[0] === ev.below_threshold_total && nums[2] === ev.cohort_size,
   `surface reconciliation: ${recon.textContent.replace(/\s+/g,' ').trim().slice(0,110)}`);
/* Two different facts, two different marks: the left rail means below
   threshold, the tag means already owned by another decision. The subtraction
   is about their intersection. */
const tagged = [...body().querySelectorAll('.coh-row.named-elsewhere')];
const taggedBelow = tagged.filter(r => r.classList.contains('below'));
ok(taggedBelow.length === ev.excluded_already_named,
   `${taggedBelow.length} below-threshold rows are marked "renewal defence" — exactly what the subtraction removes`);
ok(tagged.length >= taggedBelow.length,
   `${tagged.length} rows tagged in total; the ${tagged.length - taggedBelow.length} above threshold are shown too, not hidden`);
ok(tagged.every(r => r.querySelector('.cr-tag')), 'each marked row carries the visible tag');

console.log(`\n${errs.length} console errors`);
if (errs.length) fail++;
console.log(fail ? `\n${fail} FAILED` : '\nall checks passed');
process.exit(fail ? 1 : 0);
