/* The clickable spine: decision -> exposed accounts -> one account. */
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
const nav = (n) => [...host.querySelectorAll('#opNav > button')].find(b => b.querySelector('span')?.textContent === n);

console.log('── LEVEL 1 -> 2 : the money figure is the affordance ──');
/* The FIRST drill link on the brief may now belong to a cohort-wide decision
   (renewal_cohort), which deliberately opens the Renewals surface rather than
   an exposed-accounts list — see briefcohort.mjs. This suite is about the
   account spine, so target an account-scoped decision explicitly. */
const link = [...body().querySelectorAll('.drill-link')]
  .find(l => /exposed accounts/.test(l.getAttribute('title') || ''));
ok(!!link, 'brief exposes a drill affordance on the figure itself');
ok(link.getAttribute('role') === 'button' && link.getAttribute('tabindex') === '0', 'affordance is keyboard-reachable');
ok(/accounts ·/.test(link.textContent), `the figure itself is the affordance: "${link.textContent.trim()}"`);
ok(![...body().querySelectorAll('.bd-actions button')].some(x => /exposed accounts/.test(x.textContent)), 'no extra button was added');
link.dispatchEvent(M());

console.log('\n── LEVEL 2 : the exposed accounts ──');
let b = body();
ok(!!b.querySelector('.drill-parent'), 'parent decision stays visible — the thread is never lost');
const crumbs = [...b.querySelectorAll('.crumbs .crumb')].map(c => c.textContent);
ok(crumbs.length >= 2 && crumbs[0] === 'Today', `breadcrumb: ${crumbs.join(' > ')}`);
const rows = [...b.querySelectorAll('.acct-row')];
ok(rows.length === 6, `${rows.length} account rows`);
const arrs = rows.map(r => Number(r.querySelector('.ar-arr').textContent.replace(/[^0-9]/g,'')));
ok(arrs.every((v,i) => i===0 || v <= arrs[i-1]), `sorted by ARR desc: ${arrs.map(v=>'$'+Math.round(v/1000)+'K').join(' > ')}`);
rows.forEach((r,i) => {
  const has = ['.ar-name','.ar-arr','.ar-ren','.ar-why'].every(s => (r.querySelector(s)?.textContent||'').trim().length > 0);
  if (!has) { console.log(`FAIL   row ${i} missing a field`); fail++; }
});
ok(true, 'every row carries name, ARR, renewal and risk_reason');
const total = b.querySelector('.acct-total');
ok(!!total, 'total shown at the bottom');
const shownTotal = Number(total.querySelector('b').textContent.replace(/[^0-9]/g,''));
ok(shownTotal === arrs.reduce((s,v)=>s+v,0), `total ${'$'+shownTotal.toLocaleString('en-US')} equals the sum of the rows`);
ok(/reconciles/.test(total.textContent), 'reconciliation stated explicitly');
ok(/further account/.test(b.textContent), 'says what was scoped out and where it went');

console.log('\n── LEVEL 2 -> 3 : one account ──');
rows[0].dispatchEvent(M());
b = body();
ok(!!b.querySelector('.acct-head'), 'account header rendered');
const c3 = [...b.querySelectorAll('.crumbs .crumb')].map(c => c.textContent);
ok(c3.length === 3, `three-level breadcrumb: ${c3.join(' > ')}`);
ok(!!b.querySelector('.acct-why p')?.textContent.trim(), 'risk_reason in prominent type');
const sigs = [...b.querySelectorAll('.sig')];
ok(sigs.length >= 1, `${sigs.length} evidence rows`);
const sources = new Set(sigs.map(s => s.querySelector('.sg-src').textContent));
ok(sources.size >= 2, `evidence spans ${sources.size} source systems: ${[...sources].join(', ')}`);
ok(sigs.every(s => s.querySelector('.sg-src')?.textContent.trim()), 'every signal names its source system');
ok(sigs.every(s => s.querySelector('.sg-when')?.textContent.trim()), 'every signal carries an observed date');
ok(!!b.querySelector('.acct-action'), 'per-account recommended action present');
ok(/·/.test(b.querySelector('.aa-owner')?.textContent || ''), 'action names an owner');

console.log('\n── navigating back ──');
b.querySelector('.crumbs .crumb:nth-child(3)').dispatchEvent(M());   // decision crumb
ok(!!body().querySelector('.acct-row'), 'breadcrumb returns to the accounts list');
body().querySelector('.crumbs .crumb').dispatchEvent(M());           // Today
ok(!!body().querySelector('.brief-screen'), 'breadcrumb returns to the brief');
// in-app back button on level 3 — again via an account-scoped decision
[...body().querySelectorAll('.drill-link')]
  .find(l => /exposed accounts/.test(l.getAttribute('title') || '')).dispatchEvent(M());
body().querySelector('.acct-row').dispatchEvent(M());
const backBtn = [...body().querySelectorAll('.brief-cta button')].find(x => /Back to the/.test(x.textContent));
ok(!!backBtn, 'level 3 offers an in-app back');
backBtn.dispatchEvent(M());
ok(!!body().querySelector('.acct-row'), 'in-app back returns to the accounts list');

console.log('\n── no router, as agreed ──');
const src = (await import('node:fs')).readFileSync(`${R}/assets/opspulse.js`,'utf8');
ok(!/pushState|popstate|hashchange/.test(src), 'no history API introduced');

console.log(`\n${errs.length} console errors`);
console.log(fail || errs.length ? `\n${fail} CHECK(S) FAILED` : '\nall checks passed');
process.exit(fail || errs.length ? 1 : 0);
