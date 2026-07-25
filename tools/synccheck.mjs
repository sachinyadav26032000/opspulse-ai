/* ==========================================================================
   Cross-tab sync check —  node tools/synccheck.mjs
   --------------------------------------------------------------------------
   Runs three stores in ONE process on a real BroadcastChannel, standing in for
   three browser tabs, and asserts they hold the same operation: same records,
   same ids, same mutations, same numbers on screen.

   Leadership is injected rather than taken from navigator.locks — Node has no
   lock manager, which is exactly why the store stays solo there by default.
   Injecting it is what makes follower behaviour testable at all.

   Counting rows is not the assertion. Two stores can hold 10,042 tickets each
   and disagree about every one of them, so this compares ids, timestamps, the
   fields a live resolution writes, and the id counters a tab would need if it
   inherited the simulator.

       npm install --no-save jsdom && node tools/synccheck.mjs

   Runs alongside verify.mjs (the engine finds the patterns) and uicheck.mjs
   (the UI renders them).
   ========================================================================== */

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="desk"></div><div id="pulse"></div></body></html>', {
  url: 'http://localhost/demo.html', pretendToBeVisual: true,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.Blob = window.Blob;
globalThis.FileReader = window.FileReader;
globalThis.Event = window.Event;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
Object.defineProperty(globalThis, 'performance', { value: { now: () => Number(process.hrtime.bigint() / 1000000n) }, configurable: true });
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };

const rel = (p) => new URL(p, import.meta.url).href;
const { createStore } = await import(rel('../data/store.js'));
const { CHANNEL } = await import(rel('../data/sync.js'));
const { mountServiceDesk } = await import(rel('../assets/servicedesk.js'));
const { mountOpsPulse } = await import(rel('../assets/opspulse.js'));
const { toCsv } = await import(rel('../data/csv.js'));
const { KAGGLE_COLUMNS } = await import(rel('../data/generator.js'));

let checks = 0, fails = 0;
const g = (s) => `\x1b[32m${s}\x1b[0m`, r = (s) => `\x1b[31m${s}\x1b[0m`, dim = (s) => `\x1b[2m${s}\x1b[0m`;
const ok = (label, cond, detail = '') => {
  checks++;
  if (cond) console.log(`  ${g('PASS')} ${label}${detail ? dim('  · ' + detail) : ''}`);
  else { fails++; console.log(`  ${r('FAIL')} ${label}  ${detail}`); }
};
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
/* Adopting a snapshot rebuilds 90 days from the seed before applying the live
   tail, which is ~150ms of real work — and more when the machine is busy. */
const settle = () => sleep(500);

/* Prefer this over settle() wherever the harness is waiting for something
   OBSERVABLE. A fixed sleep that is long enough today is a test that fails
   once every fifteen runs on a loaded machine, and a flaky assertion is worse
   than no assertion: it trains you to re-run instead of read. */
async function waitUntil(fn, ms = 10000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { if (fn()) return true; } catch { /* not ready yet */ }
    await sleep(40);
  }
  return false;
}
const sameTail = (a, b) => () => a.dataset.tickets.length === b.dataset.tickets.length;

/* A tab that wins the lock, and a tab that waits for it. Returning true means
   "leadership is being managed" — a follower simply never gets granted, which
   is what the browser's lock manager does to every tab but one. */
const asLeader = () => ({ channel: new BroadcastChannel(CHANNEL), requestLeadership: (grant) => { grant(); return true; } });
let promoteB = null;                          // held so the failover test can fire it
const asFollower = (capture) => ({
  channel: new BroadcastChannel(CHANNEL),
  requestLeadership: (grant) => { if (capture) promoteB = grant; return true; },
});

console.log('\n=== Cross-tab sync check ===\n');

const A = createStore({ autoStart: false, fresh: true, sync: asLeader() });
const B = createStore({ autoStart: false, sync: asFollower(true) });
await settle();

console.log('— Roles —');
ok('tab A holds the simulator', A.isLeader === true);
ok('tab B is a follower', B.isLeader === false);
ok('both report themselves synced', A.synced && B.synced);

/* ── The live tail, which is the thing that used to diverge ─────────────── */
console.log('\n— Live traffic crosses the tab boundary —');
const beforeA = A.dataset.tickets.length;
A.start();
/* Run until the simulator has actually done the thing under test. Resolutions
   are drawn `rng.int(0, 2)` per tick, so a fixed three-tick window produces
   none about once in twenty-five runs — and the resolution-replication check
   below would then assert against an empty set. */
await waitUntil(() => A.counters.resolved > 0 && A.counters.added > 0, 30000);
await sleep(9000);             // ≥1 engine pass on top of that
A.stop();
await waitUntil(sameTail(A, B));

const lastLive = (s) => [...s.dataset.tickets].reverse().find((t) => t.is_live);
const la = lastLive(A), lb = lastLive(B);

console.log(dim(`  A ticked ${A.dataset.tickets.length - beforeA} tickets into existence`));
ok('B received them all', A.dataset.tickets.length === B.dataset.tickets.length,
  `A ${A.dataset.tickets.length} · B ${B.dataset.tickets.length}`);
ok('the newest live ticket is the SAME ticket, not just a count',
  !!la && !!lb && la.ticket_id === lb.ticket_id && la.created_at === lb.created_at,
  `${la?.ticket_id} @ ${la?.created_at} vs ${lb?.ticket_id} @ ${lb?.created_at}`);
ok('escalations agree', A.dataset.escalations.length === B.dataset.escalations.length,
  `${A.dataset.escalations.length} vs ${B.dataset.escalations.length}`);
ok('NPS + QA agree',
  A.dataset.nps.length === B.dataset.nps.length && A.dataset.qa.length === B.dataset.qa.length,
  `nps ${A.dataset.nps.length}/${B.dataset.nps.length} · qa ${A.dataset.qa.length}/${B.dataset.qa.length}`);

/* Live RESOLUTIONS mutate tickets that already existed in both copies — the
   case a naive "append what's new" sync silently gets wrong. */
const resolvedA = A.dataset.tickets.filter((t) => t.resolved_live);
const mismatched = resolvedA.filter((t) => {
  const m = B.dataset.tickets.find((x) => x.ticket_id === t.ticket_id);
  return !m || m.resolved_at !== t.resolved_at || m.ticket_status !== t.ticket_status
    || m.time_to_resolution_hrs !== t.time_to_resolution_hrs || m.sla_breached !== t.sla_breached;
});
ok('live resolutions replicated field-for-field',
  resolvedA.length > 0 && mismatched.length === 0,
  `${resolvedA.length} resolutions · ${mismatched.length} mismatched`);

ok('open backlog is the same number in both tabs',
  A.dataset.tickets.filter((t) => !t.resolved_at).length === B.dataset.tickets.filter((t) => !t.resolved_at).length,
  `${A.dataset.tickets.filter((t) => !t.resolved_at).length}`);
ok('id counters match, so a failover cannot reissue an id',
  A.dataset.meta.next_ticket_seq === B.dataset.meta.next_ticket_seq
  && A.dataset.meta.next_escalation_seq === B.dataset.meta.next_escalation_seq,
  `TK seq ${A.dataset.meta.next_ticket_seq}`);
ok('the engine agrees across tabs',
  A.engine.insights.length === B.engine.insights.length
  && A.engine.health.score === B.engine.health.score,
  `${A.engine.insights.length} insights · health ${A.engine.health.score}/${B.engine.health.score}`);

/* ── A tab opened late has to catch up, not start blank ─────────────────── */
console.log('\n— A third tab opens midway —');
const C = createStore({ autoStart: false, sync: asFollower() });
await waitUntil(sameTail(C, A));
const lc = lastLive(C);
ok('C caught up to the live tail via the snapshot',
  C.dataset.tickets.length === A.dataset.tickets.length,
  `C ${C.dataset.tickets.length} · A ${A.dataset.tickets.length}`);
ok('and to the same newest ticket', !!lc && lc.ticket_id === la?.ticket_id, `${lc?.ticket_id}`);
ok('including the resolution patches',
  C.dataset.tickets.filter((t) => t.resolved_live).length === A.dataset.tickets.filter((t) => t.resolved_live).length,
  `${C.dataset.tickets.filter((t) => t.resolved_live).length}`);

/* ── Controls in a follower tab have to reach the writer ────────────────── */
console.log('\n— Controls work from any tab —');
B.start();
await waitUntil(() => A.running === true);
ok('pressing play in a follower starts the leader', A.running === true && B.running === true);
B.stop();
await waitUntil(() => A.running === false && C.running === false);
ok('and pausing from a follower pauses everyone', A.running === false && B.running === false && C.running === false);

const seedBefore = A.seed;
B.reseed(4242);
await waitUntil(() => A.seed === 4242 && B.seed === 4242 && C.seed === 4242);
ok('reseeding from a follower reseeds every tab',
  A.seed === 4242 && B.seed === 4242 && C.seed === 4242, `${seedBefore} → ${A.seed}`);
ok('and every tab rebuilt the same world',
  A.dataset.tickets.length === B.dataset.tickets.length && B.dataset.tickets.length === C.dataset.tickets.length,
  `${A.dataset.tickets.length}`);

/* ── An upload lands in one tab and has to appear in all of them ────────── */
console.log('\n— CSV ingest propagates —');
const sample = A.dataset.tickets.slice(-60).map((t) => ({
  'Ticket ID': 'UPL' + t.ticket_id, 'Customer Name': t.customer_name, 'Customer Email': t.customer_email,
  'Customer Age': t.customer_age, 'Customer Gender': t.customer_gender, 'Product Purchased': t.product_purchased,
  'Date of Purchase': t.date_of_purchase, 'Ticket Type': t.ticket_type, 'Ticket Subject': t.ticket_subject,
  'Ticket Description': t.ticket_description, 'Ticket Status': t.ticket_status, 'Resolution': t.resolution,
  'Ticket Priority': t.ticket_priority, 'Ticket Channel': t.ticket_channel,
  'First Response Time': new Date(t.created_at).toISOString(), 'Time to Resolution': t.time_to_resolution_hrs,
  'Customer Satisfaction Rating': t.customer_satisfaction_rating,
}));
const nBefore = C.dataset.tickets.length;
const res = B.ingestCsv(toCsv(sample, KAGGLE_COLUMNS));
await waitUntil(() => C.dataset.tickets.length === nBefore + res.added);
ok('the upload was accepted in the uploading tab', res.ok && res.added > 0, `${res.added} rows`);
ok('and the other tabs received the same rows',
  A.dataset.tickets.length === B.dataset.tickets.length && C.dataset.tickets.length === nBefore + res.added,
  `A ${A.dataset.tickets.length} · B ${B.dataset.tickets.length} · C ${C.dataset.tickets.length}`);

/* ── The leader's tab closes ────────────────────────────────────────────── */
console.log('\n— Leader failover —');
const seqAtHandover = B.dataset.meta.next_ticket_seq;
const idsBefore = new Set(B.dataset.tickets.map((t) => t.ticket_id));
A.close();                                   // tab A goes away…
promoteB();                                  // …and the lock manager hands B the lock
await waitUntil(() => B.isLeader === true);
ok('B inherits the simulator', B.isLeader === true && C.isLeader === false);

B.start();
await waitUntil(() => B.counters.added > 0, 30000);
await sleep(3500);
B.stop();
await waitUntil(sameTail(B, C));
const newIds = B.dataset.tickets.filter((t) => t.is_live && !idsBefore.has(t.ticket_id));
ok('the new writer keeps generating', newIds.length > 0, `${newIds.length} tickets after handover`);
ok('and reissues no id the old writer already used',
  newIds.every((t) => Number(t.ticket_id.replace(/\D/g, '')) >= seqAtHandover),
  `seq at handover ${seqAtHandover} · lowest new ${Math.min(...newIds.map((t) => Number(t.ticket_id.replace(/\D/g, ''))))}`);
ok('C followed the new writer without being told about the change',
  C.dataset.tickets.length === B.dataset.tickets.length,
  `B ${B.dataset.tickets.length} · C ${C.dataset.tickets.length}`);
/* ── What the user actually sees ────────────────────────────────────────── */
console.log('\n— The rendered numbers, tab to tab —');
const deskEl = document.getElementById('desk');
const pulseEl = document.getElementById('pulse');
mountServiceDesk(deskEl, B);                 // NorthDesk in one tab…
mountOpsPulse(pulseEl, C);                   // …OpsPulse in another
await settle();
const num = (s) => (s == null ? null : Number(String(s).replace(/[^0-9.]/g, '')));
const deskCount = (label) => num([...deskEl.querySelectorAll('.sd-side button')]
  .find((b) => b.querySelector('.t')?.textContent.trim() === label)?.querySelector('.n')?.textContent);
const pulseKpi = (label) => num([...pulseEl.querySelectorAll('.kpi')]
  .find((k) => k.querySelector('.k')?.textContent.trim() === label)?.querySelector('.v')?.textContent);

ok('Open backlog: NorthDesk in tab B == OpsPulse in tab C',
  deskCount('Open queue') === pulseKpi('Open backlog'),
  `desk ${deskCount('Open queue')} vs pulse ${pulseKpi('Open backlog')}`);
ok('Open escalations: NorthDesk in tab B == OpsPulse in tab C',
  deskCount('Escalations') === pulseKpi('Open escalations'),
  `desk ${deskCount('Escalations')} vs pulse ${pulseKpi('Open escalations')}`);

/* And they have to STAY equal while traffic flows — the case the ~9s engine
   pass used to hide, because OpsPulse only repainted its KPIs on that pass. */
B.start();
await sleep(7000);
B.stop();
await settle();
ok('still equal after live traffic, between engine passes',
  deskCount('Open queue') === pulseKpi('Open backlog'),
  `desk ${deskCount('Open queue')} vs pulse ${pulseKpi('Open backlog')}`);

B.close(); C.close();

/* ── Two tabs opened at once, before anyone holds the lock ──────────────── */
console.log('\n— Simultaneous open —');
/* Every tab posts `hello` while constructing. In a real browser that is BEFORE
   navigator.locks has granted anything, so two tabs opened together (session
   restore, two links at once) both ask when there is nobody to answer. The tab
   that then loses the lock must not be left waiting for a snapshot forever —
   the winner publishes one on promotion instead. `grant` is deliberately held
   back here so both stores exist leaderless first, as they do in Chrome. */
let grantP = null;
const P = createStore({ autoStart: false, fresh: true, sync: { channel: new BroadcastChannel(CHANNEL), requestLeadership: (grant) => { grantP = grant; return true; } } });
const Q = createStore({ autoStart: false, sync: { channel: new BroadcastChannel(CHANNEL), requestLeadership: () => true } });
await settle();
ok('neither tab is writing yet', P.isLeader === false && Q.isLeader === false);
grantP();                                    // the lock resolves in P's favour
await waitUntil(() => P.isLeader === true && Q.dataset.tickets.length === P.dataset.tickets.length);
ok('the winner starts writing', P.isLeader === true && Q.isLeader === false);
ok('the loser was handed a snapshot without asking twice',
  Q.seed === P.seed && Q.dataset.tickets.length === P.dataset.tickets.length,
  `seed ${Q.seed} · ${Q.dataset.tickets.length} tickets`);
P.start();
await waitUntil(() => P.counters.added > 0, 30000);
await sleep(3500);
P.stop();
await waitUntil(sameTail(P, Q));
ok('and then tracks it normally', Q.dataset.tickets.length === P.dataset.tickets.length,
  `P ${P.dataset.tickets.length} · Q ${Q.dataset.tickets.length}`);
P.close(); Q.close();

/* ── The writer must not sit in a backgrounded tab ──────────────────────── */
console.log('\n— Hidden-tab handoff —');
/* Browsers throttle timers in hidden tabs to roughly one a minute. If the
   writer is the tab you are NOT looking at, every tab you ARE looking at goes
   quiet. Each peer gets its own visibility predicate because they share one
   jsdom document. */
/* NOTE: `fresh: true` here resets the persisted seed, which the reseed section
   above set to 4242. B and C are closed first so nothing is watching — the
   ordering is load-bearing. */
let bHidden = false, dHidden = false;
const Bv = { channel: new BroadcastChannel(CHANNEL), requestLeadership: (grant) => { grant(); return true; }, isHidden: () => bHidden };
const Dv = { channel: new BroadcastChannel(CHANNEL), requestLeadership: () => true, isHidden: () => dHidden };
B.close(); C.close();
const W = createStore({ autoStart: false, fresh: true, sync: Bv });   // visible writer
await settle();
const V = createStore({ autoStart: false, sync: Dv });                // second tab, visible
await settle();
ok('the first tab is writing', W.isLeader === true && V.isLeader === false);

bHidden = true;                                   // the writer gets backgrounded
document.dispatchEvent(new window.Event('visibilitychange'));
await waitUntil(() => V.isLeader === true && W.isLeader === false);
ok('a backgrounded writer hands off to the visible tab',
  W.isLeader === false && V.isLeader === true);
ok('and the simulation is still considered running, not paused',
  W.running === V.running);

V.start();
await waitUntil(() => V.counters.added > 0, 30000);
await sleep(3500);
V.stop();
await waitUntil(sameTail(V, W));
ok('the new writer drives both tabs', W.dataset.tickets.length === V.dataset.tickets.length,
  `${W.dataset.tickets.length} vs ${V.dataset.tickets.length}`);

dHidden = true; bHidden = false;                  // you switch back
document.dispatchEvent(new window.Event('visibilitychange'));
await waitUntil(() => W.isLeader === true && V.isLeader === false);
ok('and hands back when the other tab is hidden instead',
  W.isLeader === true && V.isLeader === false);
W.close(); V.close();


console.log(`\n${fails ? r(`${fails} CHECK(S) FAILED`) : g('ALL SYNC CHECKS PASSED')}  (${checks - fails}/${checks})\n`);
process.exit(fails ? 1 : 0);
