/* ==========================================================================
   Real-browser code-path check —  node tools/browsercheck.mjs
   --------------------------------------------------------------------------
   tools/synccheck.mjs INJECTS leadership, because Node has no lock manager.
   That makes follower behaviour testable, but it also means the branch your
   browser actually takes — `navigator.locks.request(...)`, which resolves
   ASYNCHRONOUSLY, after `createStore` has already returned and already posted
   its `hello` — is never executed there.

   That asynchrony is not a detail. It is the difference between:
       inject:  grant() runs inline  → tab A is the writer before tab B exists
       browser: grant() runs later   → both tabs can exist, both can have asked
                                       for a snapshot, and NEITHER is the writer

   So this harness gives Node a spec-shaped Web Locks implementation and then
   gets out of the way: no injected leadership, no injected channel, real
   BroadcastChannel, real handshake, real ordering. Releasing a lock stands in
   for closing a tab.

       npm install --no-save jsdom && node tools/browsercheck.mjs
   ========================================================================== */

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/opspulse.html', pretendToBeVisual: true,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
Object.defineProperty(globalThis, 'performance', { value: { now: () => Number(process.hrtime.bigint() / 1000000n) }, configurable: true });
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };

/* ── A Web Locks manager, close enough to the spec to be worth testing against.
   One exclusive holder at a time; later requesters queue; the lock passes to
   the next in line when the holder's promise settles. In a browser that
   settling happens because the tab went away, which is why `release()` here is
   named for what it simulates. ───────────────────────────────────────────── */
const queues = new Map();
const holders = new Map();

function pump(name) {
  const q = queues.get(name);
  if (!q?.length || holders.has(name)) return;
  const entry = q.shift();
  /* The holder's callback returns a promise that NEVER settles — that is how
     data/sync.js holds the lock for the life of the tab. So the manager cannot
     wait on it; it has to race it against a gate only the browser (here, the
     harness) can open. Resolving the request's outer promise is not enough:
     the inner chain would stay pending and the lock would never pass on. */
  let openGate;
  const gate = new Promise((res) => { openGate = res; });
  holders.set(name, { entry, release: openGate });
  // Asynchronous on purpose: this is the whole point of the harness.
  Promise.resolve()
    .then(() => Promise.race([entry.fn({ name, mode: 'exclusive' }), gate]))
    .then(entry.resolve, entry.reject)
    .finally(() => { holders.delete(name); pump(name); });
}

const locks = {
  request(name, opts, fn) {
    if (typeof opts === 'function') { fn = opts; opts = {}; }
    return new Promise((resolve, reject) => {
      const q = queues.get(name) || [];
      q.push({ fn, resolve, reject });
      queues.set(name, q);
      pump(name);
    });
  },
};
/** Stands in for the holding tab being closed. */
const releaseLock = (name) => {
  const h = holders.get(name);
  if (!h) return false;
  h.release();
  return true;
};
Object.defineProperty(window.navigator, 'locks', { value: locks, configurable: true });
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });

const rel = (p) => new URL(p, import.meta.url).href;
const { createStore } = await import(rel('../data/store.js'));
const { LOCK } = await import(rel('../data/sync.js'));

let checks = 0, fails = 0;
const g = (s) => `\x1b[32m${s}\x1b[0m`, r = (s) => `\x1b[31m${s}\x1b[0m`, dim = (s) => `\x1b[2m${s}\x1b[0m`;
const ok = (label, cond, detail = '') => {
  checks++;
  if (cond) console.log(`  ${g('PASS')} ${label}${detail ? dim('  · ' + detail) : ''}`);
  else { fails++; console.log(`  ${r('FAIL')} ${label}  ${detail}`); }
};
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const settle = () => sleep(600);

/* Wait for something observable rather than for a duration. A fixed sleep that
   is long enough on an idle machine is a test that fails now and then on a busy
   one, and an assertion you re-run instead of read is not an assertion. */
async function waitUntil(fn, ms = 12000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { if (fn()) return true; } catch { /* not ready yet */ }
    await sleep(40);
  }
  return false;
}
const sameTail = (a, b) => () => a.dataset.tickets.length === b.dataset.tickets.length;

console.log('\n=== Real navigator.locks code path ===\n');
console.log(dim('  no injected leadership · no injected channel · locks resolve asynchronously\n'));

/* ── The case injection cannot reproduce ────────────────────────────────── */
console.log('— Two tabs constructed back-to-back, before any lock resolves —');
const A = createStore({ autoStart: false, fresh: true });
const B = createStore({ autoStart: false });
ok('neither tab is the writer at construction time',
  A.isLeader === false && B.isLeader === false,
  'the lock has not resolved yet — this is what the browser does');
ok('both report the sync layer as active', A.synced && B.synced);

await waitUntil(() => A.isLeader || B.isLeader);
const leaders = [A, B].filter((s) => s.isLeader);
ok('exactly one tab ends up writing', leaders.length === 1,
  `A ${A.isLeader} · B ${B.isLeader}`);
const L = leaders[0], F = L === A ? B : A;

/* The hello-race: both posted `hello` before either could answer. The writer
   publishes a snapshot on promotion so the loser is not left waiting. */
ok('the follower is fully informed, not just silent',
  F.seed === L.seed && F.dataset.tickets.length === L.dataset.tickets.length,
  `seed ${F.seed} · ${F.dataset.tickets.length} tickets`);

console.log('\n— Live traffic over the real path —');
L.start();
await waitUntil(() => L.counters.resolved > 0 && L.counters.added > 0, 30000);
await sleep(9000);   // ≥1 engine pass
L.stop();
await waitUntil(sameTail(L, F));

const lastLive = (s) => [...s.dataset.tickets].reverse().find((t) => t.is_live);
ok('the follower received every record',
  F.dataset.tickets.length === L.dataset.tickets.length,
  `writer ${L.dataset.tickets.length} · follower ${F.dataset.tickets.length}`);
ok('down to the same newest ticket and timestamp',
  lastLive(F)?.ticket_id === lastLive(L)?.ticket_id && lastLive(F)?.created_at === lastLive(L)?.created_at,
  `${lastLive(L)?.ticket_id}`);
ok('open backlog matches',
  F.dataset.tickets.filter((t) => !t.resolved_at).length === L.dataset.tickets.filter((t) => !t.resolved_at).length,
  `${L.dataset.tickets.filter((t) => !t.resolved_at).length}`);
ok('the engine scored both tabs identically',
  F.engine.health.score === L.engine.health.score && F.engine.insights.length === L.engine.insights.length,
  `health ${L.engine.health.score} · ${L.engine.insights.length} insights`);

/* ── A third tab, opened while one is already writing ───────────────────── */
console.log('\n— A tab opened later, with a writer already established —');
const C = createStore({ autoStart: false });
await waitUntil(sameTail(C, L));
ok('it does not steal the lock', C.isLeader === false);
ok('and it caught up via the snapshot',
  C.dataset.tickets.length === L.dataset.tickets.length,
  `C ${C.dataset.tickets.length} · writer ${L.dataset.tickets.length}`);

/* ── The writer's tab closes: the lock manager hands it on ──────────────── */
console.log('\n— The writing tab closes —');
const seqAtClose = F.dataset.meta.next_ticket_seq;
L.close();
ok('the lock was held and is now released', releaseLock(LOCK) === true);
await waitUntil(() => F.isLeader || C.isLeader);
const after = [F, C].filter((s) => s.isLeader);
ok('exactly one of the survivors takes over', after.length === 1,
  `F ${F.isLeader} · C ${C.isLeader}`);

if (!after.length) {
  console.log(`\n${r('1 CHECK(S) FAILED')}  — nobody took over, so the rest cannot run\n`);
  process.exit(1);
}
const N = after[0], O = N === F ? C : F;
N.start();
await waitUntil(() => N.counters.added > 0, 30000);
await sleep(3500);
N.stop();
await waitUntil(sameTail(N, O));
const fresh = N.dataset.tickets.filter((t) => t.is_live && Number(t.ticket_id.replace(/\D/g, '')) > seqAtClose);
ok('the new writer keeps the operation running', fresh.length > 0, `${fresh.length} new tickets`);
ok('reissuing no id the old writer already used',
  fresh.every((t) => Number(t.ticket_id.replace(/\D/g, '')) > seqAtClose),
  `seq at close ${seqAtClose}`);
ok('and the remaining tab followed it', O.dataset.tickets.length === N.dataset.tickets.length,
  `${N.dataset.tickets.length} vs ${O.dataset.tickets.length}`);

/* ══════════════════════════════════════════════════════════════════════════
   The requirement, stated plainly: OpsPulse and NorthDesk are separate tabs,
   and each has to reflect the other. Not "the stores agree" — the NUMBERS ON
   THE TWO SCREENS agree, and an action taken on either screen reaches the
   other. Both directions, on rendered DOM.
   ══════════════════════════════════════════════════════════════════════════ */
const { mountServiceDesk } = await import(rel('../assets/servicedesk.js'));
const { mountOpsPulse } = await import(rel('../assets/opspulse.js'));
const { toCsv } = await import(rel('../data/csv.js'));
const { KAGGLE_COLUMNS } = await import(rel('../data/generator.js'));

const deskEl = document.createElement('div');
const pulseEl = document.createElement('div');
document.body.append(deskEl, pulseEl);

/* N is the writer. NorthDesk sits in that tab; OpsPulse sits in the other one,
   reading it — the arrangement that used to produce two separate operations. */
mountServiceDesk(deskEl, N);
mountOpsPulse(pulseEl, O);
await waitUntil(() => pulseEl.querySelector('.kpi') && deskEl.querySelector('.sd-side button'));

const num = (s) => (s == null ? null : Number(String(s).replace(/[^0-9.]/g, '')));
const deskCount = (label) => num([...deskEl.querySelectorAll('.sd-side button')]
  .find((b) => b.querySelector('.t')?.textContent.trim() === label)?.querySelector('.n')?.textContent);
const deskRecords = () => num(deskEl.querySelector('#sdCount')?.textContent);
const pulseKpi = (label) => num([...pulseEl.querySelectorAll('.kpi')]
  .find((k) => k.querySelector('.k')?.textContent.trim() === label)?.querySelector('.v')?.textContent);

console.log('\n— NorthDesk tab → OpsPulse tab —');
ok('open backlog agrees on screen', deskCount('Open queue') === pulseKpi('Open backlog'),
  `NorthDesk ${deskCount('Open queue')} · OpsPulse ${pulseKpi('Open backlog')}`);
ok('open escalations agree on screen', deskCount('Escalations') === pulseKpi('Open escalations'),
  `NorthDesk ${deskCount('Escalations')} · OpsPulse ${pulseKpi('Open escalations')}`);

const deskBefore = deskCount('All tickets');
N.start();
await waitUntil(() => N.counters.added > 0, 30000);
await sleep(9000);   // ≥1 engine pass, so OpsPulse has re-rendered too
N.stop();
await waitUntil(() => deskCount('Open queue') === pulseKpi('Open backlog'));
ok('tickets arriving in NorthDesk show up in its queue',
  deskCount('All tickets') > deskBefore, `${deskBefore} → ${deskCount('All tickets')}`);
ok('and the OpsPulse tab counted the same backlog',
  deskCount('Open queue') === pulseKpi('Open backlog'),
  `NorthDesk ${deskCount('Open queue')} · OpsPulse ${pulseKpi('Open backlog')}`);
ok('and the same escalations',
  deskCount('Escalations') === pulseKpi('Open escalations'),
  `NorthDesk ${deskCount('Escalations')} · OpsPulse ${pulseKpi('Open escalations')}`);

console.log('\n— OpsPulse tab → NorthDesk tab (the "vice versa") —');
/* OpsPulse is the FOLLOWER here, so everything below has to travel upstream to
   the writer and back out again. This is the direction a one-way "leader
   broadcasts, followers listen" design would silently fail. */
const pauseBtn = pulseEl.querySelector('#opToggle');
N.start();                                   // establish a known state: running
await waitUntil(() => N.running === true && O.running === true);
ok('both tabs agree the simulation is running', N.running === true && O.running === true);

pauseBtn.click();                            // the toggle in the FOLLOWER's toolbar
await waitUntil(() => N.running === false && O.running === false);
ok('pausing from the OpsPulse tab stops the NorthDesk tab',
  N.running === false && O.running === false);
ok('and the NorthDesk toolbar reflects it, not just the store',
  /resume/i.test(deskEl.querySelector('#sdToggle')?.textContent || ''),
  deskEl.querySelector('#sdToggle')?.textContent.trim());

pauseBtn.click();
await waitUntil(() => N.running === true && O.running === true);
ok('resuming from OpsPulse restarts it', N.running === true && O.running === true);
N.stop();
await settle();

const upload = N.dataset.tickets.slice(-40).map((t) => ({
  'Ticket ID': 'FROMPULSE' + t.ticket_id, 'Customer Name': t.customer_name, 'Customer Email': t.customer_email,
  'Customer Age': t.customer_age, 'Customer Gender': t.customer_gender, 'Product Purchased': t.product_purchased,
  'Date of Purchase': t.date_of_purchase, 'Ticket Type': t.ticket_type, 'Ticket Subject': t.ticket_subject,
  'Ticket Description': t.ticket_description, 'Ticket Status': 'Open', 'Resolution': '',
  'Ticket Priority': t.ticket_priority, 'Ticket Channel': t.ticket_channel,
  'First Response Time': new Date(t.created_at).toISOString(), 'Time to Resolution': '',
  'Customer Satisfaction Rating': '',
}));
const deskAllBefore = deskCount('All tickets');
const up = O.ingestCsv(toCsv(upload, KAGGLE_COLUMNS));      // dropped on the OpsPulse tab
await waitUntil(() => deskCount('All tickets') === deskAllBefore + up.added);
ok('a CSV dropped on OpsPulse is accepted', up.ok && up.added === 40, `${up.added} rows`);
ok('and those rows appear in the NorthDesk queue in the other tab',
  deskCount('All tickets') === deskAllBefore + up.added,
  `${deskAllBefore} → ${deskCount('All tickets')}`);
ok('NorthDesk re-rendered rather than just holding the data',
  deskRecords() != null && deskEl.querySelectorAll('.sd-table tbody tr').length > 0,
  `${deskRecords()} records listed`);

const seedBefore = N.seed;
pulseEl.querySelector('#opReseed').click();                 // "New data" on the OpsPulse tab
await waitUntil(() => N.seed !== seedBefore && N.seed === O.seed && deskCount('Open queue') === pulseKpi('Open backlog'));
ok('reseeding from OpsPulse rebuilds the NorthDesk tab too',
  N.seed !== seedBefore && N.seed === O.seed,
  `${seedBefore} → ${N.seed}`);
ok('and both screens agree on the new world',
  deskCount('Open queue') === pulseKpi('Open backlog'),
  `NorthDesk ${deskCount('Open queue')} · OpsPulse ${pulseKpi('Open backlog')}`);

F.close(); C.close();
console.log(`\n${fails ? r(`${fails} CHECK(S) FAILED`) : g('ALL BROWSER-PATH CHECKS PASSED')}  (${checks - fails}/${checks})\n`);
process.exit(fails ? 1 : 0);
