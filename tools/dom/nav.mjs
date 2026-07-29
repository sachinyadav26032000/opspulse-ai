import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
/* Repo root, resolved from this file's own location — never an absolute path
   baked in at authoring time, or the suite only runs on one machine. */
const R = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://x/opspulse.html' });
for (const k of ['window','document','navigator','HTMLElement','Node','Blob','FileReader','getComputedStyle','requestAnimationFrame','cancelAnimationFrame','URL','location'])
  if (globalThis[k] === undefined) globalThis[k] = k === 'window' ? dom.window : dom.window[k];
globalThis.localStorage = dom.window.localStorage;
const errs=[]; const oe=console.error; console.error=(...a)=>{errs.push(a.join(' ')); oe(...a);};
const { createStore } = await import(`${R}/data/store.js`);
const { mountOpsPulse } = await import(`${R}/assets/opspulse.js`);
let fail=0; const ok=(c,m)=>{console.log(`${c?' ok ':'FAIL'}  ${m}`); if(!c)fail++;};
const M=()=>new dom.window.MouseEvent('click',{bubbles:true});

const store = createStore({ seed: 20260724, fresh: true, autoStart: false });
const host = document.createElement('div'); document.body.appendChild(host);
mountOpsPulse(host, store);
const nav = () => host.querySelector('#opNav');
const tabs = () => [...nav().querySelectorAll(':scope > button')].map(b=>b.querySelector('span').textContent);
const body = () => host.querySelector('.lv-body');

console.log('── the four tabs ──');
console.log('   ' + tabs().join(' · ') + '   [+ More]');
/* Renewals replaced Workspace as a primary tab in Task 3: it is the workflow
   the buyer described, and a fifth tab overflowed the header at 1280px.
   Workspace is reached from a decision, not navigated to cold. */
ok(tabs().join(',') === 'Today,Decision Feed,Renewals,Risk Radar', 'exactly the four agreed tabs, in order');
ok(!tabs().includes('Executive Copilot'), 'Executive Copilot is NOT a tab');
ok(!tabs().includes('Dashboard'), '"Dashboard" no longer appears (avoid-list)');
ok(!!nav().querySelector('.lv-more'), 'overflow trigger present');

console.log('\n── overflow ──');
const trig = () => nav().querySelector('.lv-more > button');
ok(trig().getAttribute('aria-haspopup') === 'menu', 'trigger declares a menu');
ok(trig().getAttribute('aria-expanded') === 'false', 'starts collapsed');
trig().dispatchEvent(M());
const menu = nav().querySelector('.lv-more-menu');
ok(!!menu && menu.getAttribute('role') === 'menu', 'menu opens with role=menu');
const items = [...menu.querySelectorAll('button')].map(b=>b.querySelector('span').textContent);
ok(items.join(',') === 'Workspace,Decision Ledger,Assurance', `overflow holds: ${items.join(' · ')}`);
ok(trig().getAttribute('aria-expanded') === 'true', 'aria-expanded flips');

console.log('\n── every view still reachable ──');
const pick = (label) => [...nav().querySelector('.lv-more-menu').querySelectorAll('button')]
  .find(b => b.querySelector('span').textContent === label);
pick('Assurance').dispatchEvent(M());
ok(/Governance rules in force/.test(body().textContent), 'Assurance reachable from overflow');
ok(!nav().querySelector('.lv-more-menu'), 'menu closes on selection');
ok(nav().querySelector('.lv-more > button').classList.contains('on'), 'More shows active while an overflow view is open');
trig().dispatchEvent(M());
pick('Decision Ledger').dispatchEvent(M());
ok(/Decision Ledger/.test(body().textContent), 'Decision Ledger reachable from overflow');

// Copilot has no tab — it must still be reachable from the brief.
[...nav().querySelectorAll(':scope > button')][0].dispatchEvent(M());
const ask = [...body().querySelectorAll('.brief-cta button')].find(b=>/Ask about the operation/.test(b.textContent));
ok(!!ask, 'brief still offers "Ask about the operation"');
ask.dispatchEvent(M());
ok(/Executive Copilot/.test(body().textContent), 'Copilot reachable without a tab');

console.log('\n── dismissal ──');
[...nav().querySelectorAll(':scope > button')][0].dispatchEvent(M());
trig().dispatchEvent(M());
ok(!!nav().querySelector('.lv-more-menu'), 'menu open');
document.dispatchEvent(M());
ok(!nav().querySelector('.lv-more-menu'), 'outside click closes it');
trig().dispatchEvent(M());
document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
ok(!nav().querySelector('.lv-more-menu'), 'Escape closes it');

console.log(`\n${errs.length} console errors`);
console.log(fail||errs.length ? `\n${fail} CHECK(S) FAILED` : '\nall checks passed');
process.exit(fail||errs.length ? 1 : 0);
