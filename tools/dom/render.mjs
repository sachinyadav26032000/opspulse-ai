/* Mounts the real OpsPulse UI in jsdom and walks every screen, including the
   new Decision Ledger and Assurance surfaces. Catches runtime errors that a
   syntax check cannot: bad property reads, null derefs, missing DOM nodes. */
import { JSDOM } from 'jsdom';

import { fileURLToPath } from 'node:url';
/* Repo root, resolved from this file's own location — never an absolute path
   baked in at authoring time, or the suite only runs on one machine. */
const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost:5500/' });
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Blob', 'FileReader', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'URL']) {
  if (globalThis[k] === undefined) globalThis[k] = k === 'window' ? dom.window : dom.window[k];
}
globalThis.localStorage = dom.window.localStorage;

const errors = [];
dom.window.addEventListener('error', (e) => errors.push(String(e.error || e.message)));
const origErr = console.error;
console.error = (...a) => { errors.push(a.map(String).join(' ')); origErr(...a); };

const { createStore } = await import(`${ROOT}/data/store.js`);
const { mountOpsPulse } = await import(`${ROOT}/assets/opspulse.js`);

let fail = 0;
const ok = (c, m) => { console.log(`${c ? ' ok ' : 'FAIL'}  ${m}`); if (!c) fail++; };

const store = createStore({ seed: 20260724, fresh: true, autoStart: false });
const host = document.createElement('div');
document.body.appendChild(host);

mountOpsPulse(host, store);
ok(true, 'mountOpsPulse() completed without throwing');

const navButtons = [...host.querySelectorAll('#opNav > button')];   // primary tabs only
const labels = navButtons.map((b) => b.querySelector('span')?.textContent);
console.log(`\n  nav: ${labels.join(' · ')}\n`);

// Ledger + Assurance moved to the overflow menu; reach them through it.
// idempotent: only click the trigger if the menu is not already showing
const openMore = () => {
  if (host.querySelector('#opNav .lv-more-menu')) return;
  host.querySelector('#opNav .lv-more > button').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));
};
const NAVX = (name) => {
  const top = [...host.querySelectorAll('#opNav > button')].find(b=>b.querySelector('span')?.textContent===name);
  if (top) return top;
  openMore();
  return [...host.querySelectorAll('#opNav .lv-more-menu button')].find(b=>b.querySelector('span')?.textContent===name);
};
ok(!!NAVX('Decision Ledger'), 'Decision Ledger reachable (overflow)');
ok(!!NAVX('Assurance'), 'Assurance reachable (overflow)');
ok(!labels.includes('Data Upload'), 'Data Upload was demoted out of the primary nav');
ok(!!host.querySelector('#opData'), 'Data moved to the top chrome as a utility button');
ok(labels[0] === 'Today', 'Today is the first nav item');
ok(labels.length === 4, 'four primary tabs');
const NAV = (name) => NAVX(name);

// Walk every screen.
const body = () => host.querySelector('.lv-body');
for (const [i, b] of [...host.querySelectorAll('#opNav > button')].entries()) {
  const before = errors.length;
  b.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const rendered = body().textContent.trim().length;
  ok(errors.length === before && rendered > 100, `screen "${labels[i]}" rendered clean (${rendered} chars)`);
}

// The Data (upload) screen is still reachable from the chrome.
host.querySelector('#opData').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
ok(body().textContent.includes('Data upload'), 'Data upload screen still reachable from the chrome');

// --- Commit a decision through the real UI path ---
NAV('Decision Feed').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));  // Decision Feed
const commitBtn = [...body().querySelectorAll('button')].find((x) => x.textContent.startsWith('Commit decision'));
ok(!!commitBtn, 'the feed exposes a "Commit decision" action');
commitBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

ok(store.decisions.length === 1, 'committing recorded exactly one decision');
ok(body().textContent.includes('Decision Ledger'), 'committing navigates to the ledger');
const ledgerText = body().textContent;
ok(ledgerText.includes('DEC-001'), 'the ledger shows the decision id');
ok(/Cleared|Improving|Holding|Worsening/.test(ledgerText), 'the ledger shows an outcome state');
ok(ledgerText.includes('at decision'), 'the ledger shows the confidence snapshot');
ok(/Decisions committed/.test(ledgerText), 'the ledger KPI header rendered');

// Lifecycle buttons work.
const prog = [...body().querySelectorAll('button')].find((x) => x.textContent === 'Mark in progress');
ok(!!prog, 'ledger row exposes "Mark in progress"');
prog.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
ok(store.decisions[0].status === 'in_progress', 'lifecycle transition applied through the UI');
ok(body().textContent.includes('In progress'), 'ledger re-rendered with the new status');

// Committing the same signal twice must not double-record.
NAV('Decision Feed').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const again = [...body().querySelectorAll('button')].find((x) => x.textContent.startsWith('In the ledger'));
ok(!!again, 'an already-committed signal shows as "In the ledger", not a fresh commit');
again.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
ok(store.decisions.length === 1, 'duplicate commit was refused');

// --- Assurance screen content ---
NAV('Assurance').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const a = body().textContent;
ok(a.includes('Detectors and declared thresholds'), 'Assurance shows the detector table WITH its title');
ok(a.includes('Provenance of the current feed'), 'Assurance shows the provenance table WITH its title');
ok(a.includes('Governance rules in force'), 'Assurance shows the governance rules');
ok(a.includes('Signal coverage'), 'Assurance shows signal coverage');
ok(/PASS|FAIL/.test(a), 'Assurance reports the contract validation result');
ok(a.includes('60%'), 'Assurance states the confidence floor');

// --- Copilot knows about the ledger ---
(NAVX('Today')).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
const askBtn = [...body().querySelectorAll('.brief-cta button')].find((x)=>/Ask about the operation/.test(x.textContent));
askBtn.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));
const sug = [...body().querySelectorAll('.suggest button')].find((x) => x.textContent.includes('decided'));
ok(!!sug, 'Copilot offers the ledger question');
sug.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
ok(body().textContent.includes('DEC-001'), 'Copilot answers from the real ledger');

console.log(`\n${errors.length} console/window errors captured`);
if (errors.length) console.log(errors.slice(0, 10).join('\n'));
console.log(fail || errors.length ? `\n${fail} CHECK(S) FAILED` : '\nall checks passed');
process.exit(fail || errors.length ? 1 : 0);
