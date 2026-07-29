/* config/thresholds.js — the dials reach every detector, and the panel drives them. */
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
const { mountOpsPulse } = await import(`${R}/assets/opspulse.js`);
const { TUNABLE } = await import(`${R}/config/thresholds.js`);
const { THRESHOLDS } = await import(`${R}/engine/web/detect.js`);
const { REVENUE_THRESHOLDS: RT } = await import(`${R}/engine/web/revenue.js`);
const { COHORT_DEFAULTS: CD } = await import(`${R}/engine/web/cohort.js`);
let fail = 0; const ok = (c,m)=>{console.log(`${c?' ok ':'FAIL'}  ${m}`); if(!c)fail++;};
const M = () => new dom.window.MouseEvent('click',{bubbles:true});

console.log('── one file, every consumer ──');
ok(Object.keys(TUNABLE).join(',') === 'adoption_worklist_threshold,adoption_decision_threshold,renewal_window_days,usage_decline_pct,silent_account_days,usage_cliff_pct',
   `the named dials: ${Object.keys(TUNABLE).join(', ')}`);
ok(THRESHOLDS.min_sample === 40 && THRESHOLDS.rate_z === 2.5, 'detect.js reads DETECTION from config');
ok(RT.silent_usage_drop === -TUNABLE.usage_decline_pct, `revenue silent_usage_drop tracks the dial (${RT.silent_usage_drop})`);
ok(RT.renewal_window_days === TUNABLE.renewal_window_days, 'revenue renewal window tracks the dial');
ok(CD.adoption_worklist_threshold === TUNABLE.adoption_worklist_threshold, 'cohort default tracks the worklist dial');
/* Two bars on one metric, and the names now say which is which. */
ok(RT.adoption_decision_threshold === 40 && TUNABLE.adoption_worklist_threshold === 60,
   `decision bar ${RT.adoption_decision_threshold}% is stricter than worklist bar ${TUNABLE.adoption_worklist_threshold}%`);
ok(RT.adoption_decision_threshold !== TUNABLE.adoption_worklist_threshold, 'they are not collapsed into one');

console.log('\n── no thresholds left hardcoded in detector logic ──');
const fs = await import('node:fs');
for (const f of ['engine/web/detect.js','engine/web/revenue.js','engine/web/cohort.js']) {
  const src = fs.readFileSync(`${R}/${f}`,'utf8');
  ok(!/^\s*(export )?const [A-Z_]*THRESHOLDS\s*=\s*\{/m.test(src), `${f} declares no threshold block of its own`);
}

const store = createStore({ seed: 20260724, fresh: true, autoStart: false });
const host = document.createElement('div'); document.body.appendChild(host);
mountOpsPulse(host, store, { user: 'Sudharshan' });
const body = () => host.querySelector('.lv-body');
const find = (label) => [...host.querySelectorAll('#opNav button')].find(x => x.querySelector('span')?.textContent.trim() === label);
const go = (label) => {
  let b = find(label);
  if (!b) { find('More').dispatchEvent(M()); b = find(label); }   // Assurance lives in the overflow
  b.dispatchEvent(M());
};

console.log('\n── the panel sits beside the counts it produces ──');
go('Assurance');
let rows = [...body().querySelectorAll('.thr-row')];
ok(rows.length === 6, `6 dials rendered (${rows.length})`);
ok(rows.map(r=>r.querySelector('label').textContent.trim()).join(' | ')
   === 'Worklist: adoption below | Decision: adoption below | Renewal window | Usage decline at | Collapse at | Silent after',
   `each dial is named in business terms: ${rows.map(r=>r.querySelector('label').textContent.trim()).join(' | ')}`);
const txt = body().textContent;
ok(!/min_sample|rate_z|cohort_t/.test(txt), 'statistical bars are NOT on the panel');
ok(/ours to defend/.test(txt), 'the panel states why they are withheld');

console.log('\n── turning a dial re-runs the engine ──');
const kpis = () => body().querySelector('.drill-kpis').textContent;
const before = body().querySelector('.thr-grid').textContent;
let inp = document.getElementById('thr_usage_decline_pct');
inp.value = '5'; inp.dispatchEvent(new dom.window.Event('change'));
ok(TUNABLE.usage_decline_pct === 5, 'the dial wrote through to config');
ok(RT.silent_usage_drop === -5, 'and the revenue detector saw it immediately');
ok(body().querySelector('.thr-grid').textContent !== before, 'the dial\'s own live count moved');
ok(/selects \d+ accounts/.test(body().querySelector('.thr-grid').textContent), 'each dial reports the set it selects');

console.log('\n── a bad value is refused, not absorbed ──');
inp = document.getElementById('thr_adoption_worklist_threshold');
const keep = TUNABLE.adoption_worklist_threshold;
inp.value = '0'; inp.dispatchEvent(new dom.window.Event('change'));
ok(TUNABLE.adoption_worklist_threshold === keep, 'zero rejected');
inp.value = 'abc'; inp.dispatchEvent(new dom.window.Event('change'));
ok(TUNABLE.adoption_worklist_threshold === keep, 'non-numeric rejected');
ok(document.getElementById('thr_adoption_worklist_threshold').value === String(keep), 'the field reverts to the live value');

console.log('\n── the cohort honours the dial ──');
inp = document.getElementById('thr_adoption_worklist_threshold');
inp.value = '90'; inp.dispatchEvent(new dom.window.Event('change'));
go('Renewals');
const thr = Number(body().querySelector('#cohThr').value);
ok(thr === 90, `cohort threshold picks up the configured default (${thr})`);

console.log(`\n${errs.length} console errors`);
if (errs.length) fail++;
console.log(fail ? `\n${fail} FAILED` : '\nall checks passed');
process.exit(fail ? 1 : 0);
