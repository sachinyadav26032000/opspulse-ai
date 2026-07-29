/* Renewals × Adoption: controls, summary, table, and the row -> account path. */
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
let fail = 0; const ok = (c,m)=>{console.log(`${c?' ok ':'FAIL'}  ${m}`); if(!c)fail++;};
const M = () => new dom.window.MouseEvent('click',{bubbles:true});

const store = createStore({ seed: 20260724, fresh: true, autoStart: false });
const host = document.createElement('div'); document.body.appendChild(host);
mountOpsPulse(host, store, { user: 'Sudharshan' });
const body = () => host.querySelector('.lv-body');
const tabs = () => [...host.querySelectorAll('#opNav > button')].map(b=>b.querySelector('span').textContent);

console.log('── nav ──');
ok(tabs().includes('Renewals'), `Renewals is a primary tab: ${tabs().join(' · ')}`);
ok(tabs().length === 4, `still 4 primary tabs (fits at 1280) — ${tabs().length}`);
[...host.querySelectorAll('#opNav > button')].find(b=>b.querySelector('span').textContent==='Renewals').dispatchEvent(M());

console.log('\n── controls: three, not a report builder ──');
let b = body();
ok(!!b.querySelector('#cohLevel'), 'scope level segmented control');
ok([...b.querySelectorAll('#cohLevel button')].map(x=>x.textContent).join(',') === 'My queue,Region,All', 'three levels: My queue / Region / All');
ok(b.querySelector('#cohLevel button.on').textContent === 'Region', 'defaults to Region');
ok(!!b.querySelector('#cohWin'), 'renewal window select');
ok(b.querySelector('#cohWin').value === 'quarter', 'window defaults to this quarter');
ok(Number(b.querySelector('#cohThr').value) === 60, 'adoption threshold defaults to 60');
ok(b.querySelectorAll('.coh-tools select, .coh-tools input, .coh-tools .seg').length <= 4, 'no more controls than the workflow needs');

console.log('\n── summary line ──');
const line = b.querySelector('.cs-line').textContent.replace(/\s+/g,' ').trim();
console.log('   ' + line);
ok(/\d+ accounts renewing in Q\d \d{4}/.test(line), 'names the window');
ok(/below \d+% adoption/.test(line), 'names the threshold');
ok(/at risk/.test(line), 'names the money at risk');

console.log('\n── table ──');
const rows = () => [...body().querySelectorAll('.coh-row')];
ok(rows().length > 20, `${rows().length} rows — a working list, not a shortlist`);
const arrs = rows().map(r => Number(r.querySelector('.cr-arr').textContent.replace(/[^0-9]/g,'')));
ok(arrs.every((v,i)=>i===0||v<=arrs[i-1]), 'sorted by ARR descending');
ok(rows().some(r => r.classList.contains('below')), `${rows().filter(r=>r.classList.contains('below')).length} rows marked below threshold`);
ok(rows().every(r => r.querySelector('.cr-trend svg')), 'every row has a sparkline from usage_history');
ok(rows().some(r => r.querySelector('.cr-eff.gained')), 'rows where credit terms change the deadline are marked');
const hdr = b.querySelector('.coh-head').textContent.replace(/\s+/g,' ').trim();
const cols = [...b.querySelector('.coh-head').children].map(x=>x.textContent.trim());
ok(cols.join(' | ') === 'Account | ARR | Renewal | Effective churn | Adoption | Trend | Why | Owner', `columns: ${cols.join(' | ')}`);

console.log('\n── below-threshold marking is a rail, not filled cells ──');
const fs = await import('node:fs');
const css = fs.readFileSync(`${R}/assets/live.css`,'utf8');
ok(/\.coh-row\.below \{ border-left-color/.test(css), 'below-threshold uses a left rail');
ok(!/\.coh-row\.below \{[^}]*background:/.test(css), 'no filled background on at-risk rows');

console.log('\n── controls actually re-query ──');
const before = rows().length;
b.querySelector('#cohLevel button').dispatchEvent(M());   // My queue
const afterCsm = rows().length;
ok(afterCsm < before, `switching to My queue narrows the book (${before} -> ${afterCsm})`);
[...body().querySelectorAll('#cohLevel button')][2].dispatchEvent(M());  // All
ok(rows().length > before, `All widens it (${rows().length})`);
[...body().querySelectorAll('#cohLevel button')][1].dispatchEvent(M());  // back to Region

const thr = body().querySelector('#cohThr');
thr.value = '90';
thr.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
const b90 = body().querySelectorAll('.coh-row.below').length;
ok(b90 > 0, `raising the threshold to 90% flags more accounts (${b90})`);

console.log('\n── a row opens the account drill-down, with no insight context ──');
body().querySelector('#cohThr').value = '60';
body().querySelector('#cohThr').dispatchEvent(new dom.window.Event('change',{bubbles:true}));
rows()[0].dispatchEvent(M());
const ab = body();
ok(!!ab.querySelector('.acct-head'), 'account detail rendered from the cohort');
ok(!!ab.querySelector('.acct-why p')?.textContent.trim(), 'risk_reason present even though no insight flagged it');
ok(ab.querySelectorAll('.sig').length >= 1, `${ab.querySelectorAll('.sig').length} evidence rows`);
const crumbs = [...ab.querySelectorAll('.crumbs .crumb')].map(x=>x.textContent);
ok(crumbs[0] === 'Renewals', `breadcrumb returns to the cohort: ${crumbs.join(' > ')}`);
ab.querySelector('.crumbs .crumb').dispatchEvent(M());
ok(!!body().querySelector('.coh-row'), 'breadcrumb goes back to the table');

console.log(`\n${errs.length} console errors`);
console.log(fail || errs.length ? `\n${fail} CHECK(S) FAILED` : '\nall checks passed');
process.exit(fail || errs.length ? 1 : 0);
