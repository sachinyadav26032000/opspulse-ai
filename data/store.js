/* ==========================================================================
   The live store — one dataset, one simulator, many views.
   --------------------------------------------------------------------------
   ARCHITECTURE NOTE (this is the important bit):
   ServiceDesk and OpsPulse are not two applications that sync. They are two
   VIEWS OVER ONE STORE. `demo.html` mounts both against a single store
   instance, so a ticket created in the service desk is already in the object
   OpsPulse reads — within a page there is nothing to synchronize, and
   therefore nothing that can fall out of sync.

   ACROSS TABS the guarantee used to stop. Every tab rebuilt the same 90-day
   history from the persisted seed, but each ran its own interval timer, so the
   LIVE TAIL diverged: a tab open ten minutes had tickets a tab opened just now
   had never seen. `data/sync.js` closes that — exactly one tab holds a lock and
   runs the simulator, and it broadcasts the records it created. Every other tab
   applies them. The invariant is the same one the split-screen has always had,
   now extended across windows: there is ONE writer, so there is one truth.

   Two clocks, on purpose:
     · TICK (~3.2s)   cheap: append events, update counters and the ticker.
     · ENGINE (~9s)   expensive: re-run all nine detectors + reasoning.
   Running the engine on every tick would stutter and, worse, make the top-3
   flicker. The 90-day base dominates the recent window, so live deltas move
   the numbers without reshuffling what a director is being told to do.

   The engine pass carries the LEADER's `as_of` rather than each tab reading its
   own clock. Two tabs recomputing 40ms apart would agree almost always — but
   "almost" is how you get one tab counting a ticket in yesterday's window and
   another counting it in today's, and the whole point here is that they cannot
   disagree.
   ========================================================================== */

import { generate, makeLiveTicket, resolveLiveTicket, makeLiveEscalation, makeLiveNps, makeLiveQa } from './generator.js';
import { makeRng } from './rng.js';
import { runEngine } from '../engine/web/index.js';
import { parseCsv, resolveColumns, mapTickets, mapNps, mapQa, detectKind } from './csv.js';
import { createSync } from './sync.js';
/* The commercial tier. It rides on the SESSION rather than the dataset: a tier
   is a fact about the contract, not about the operation, and putting it on
   `dataset.meta` would mean the reseed path silently reset the customer's plan
   every time someone pressed "New data". */
import { entitlements, normalizeTier, DEFAULT_TIER } from '../config/entitlements.js';

const LS_KEY = 'opspulse.session.v1';
const TICK_MS = 3200;
const ENGINE_MS = 9000;
const FEED_MAX = 80;

/* Fields resolveLiveTicket writes. A follower gets these as a patch rather than
   a whole record: the ticket already exists in its copy of the history, and
   shipping 30 unchanged fields to update 7 is just noise on the wire. */
const RESOLVE_FIELDS = [
  'resolved_at', 'time_to_resolution_hrs', 'ticket_status', 'resolution',
  'sla_breached', 'reopened', 'customer_satisfaction_rating',
];

function loadSession() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    // Persist the seed AND the as-of instant together: day0 is derived from
    // as_of, so a seed alone would rebuild a differently-aligned history.
    // `tier` is deliberately NOT part of this test. It was added after the key
    // was in the wild, and requiring it would invalidate every session written
    // before this change — dropping people onto a freshly generated operation
    // for no reason they could see. A session without one simply defaults.
    if (typeof s.seed === 'number' && typeof s.as_of === 'number') return s;
    return null;
  } catch { return null; }
}
function saveSession(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* quota or privacy mode — the demo still runs */ }
}

export function createStore(opts = {}) {
  const persisted = opts.fresh ? null : loadSession();
  let seed = opts.seed ?? persisted?.seed ?? 20260724;
  // A session older than 12 hours gets a new as-of so "today" stays today.
  const stale = persisted && Date.now() - persisted.as_of > 12 * 3600000;
  let asOf = opts.asOf ?? (stale ? Date.now() : persisted?.as_of ?? Date.now());
  /* Survives a reload and a reseed, because neither of those is a change of
     plan. `normalizeTier` means a hand-edited or stale localStorage value
     degrades to the default rather than leaving surfaces holding `undefined`. */
  let tier = normalizeTier(opts.tier ?? persisted?.tier ?? DEFAULT_TIER);
  let ent = entitlements(tier);

  let dataset = generate(seed, asOf);
  let engine = runEngine(dataset);
  let rng = makeRng(seed ^ 0x5f3759df);

  const feed = [];
  const listeners = new Set();
  let tickTimer = null, engineTimer = null, running = false;
  let counters = { added: 0, resolved: 0, escalated: 0, nps: 0, qa: 0, uploaded: 0 };

  saveSession({ seed, as_of: asOf, tier });

  const emit = (evt) => { for (const fn of listeners) { try { fn(evt); } catch (e) { console.error('[store] listener failed', e); } } };

  function pushFeed(entry) {
    feed.unshift({ ...entry, at: Date.now() });
    if (feed.length > FEED_MAX) feed.length = FEED_MAX;
  }

  /** Recompute the day-89 slots of the derived series after live mutation. */
  function refreshTodaySeries() {
    const d = dataset.meta.days - 1;
    const s = dataset.meta.series;
    s.inflow[d] = dataset.tickets.filter((t) => t.day_index === d).length;
    s.throughput[d] = dataset.tickets.filter((t) => t.resolved_at != null && t.resolved_at >= dataset.meta.day0 + d * 86400000).length;
    s.backlog[d] = dataset.tickets.filter((t) => !t.resolved_at).length;
  }

  /* ── Cross-tab plumbing ─────────────────────────────────────────────────── */

  /** The id counters live on meta; a tab inheriting leadership must not reissue ids. */
  const seqOf = () => ({
    ticket: dataset.meta.next_ticket_seq, escalation: dataset.meta.next_escalation_seq,
    nps: dataset.meta.next_nps_seq, qa: dataset.meta.next_qa_seq,
  });
  const applySeq = (s) => {
    if (!s) return;
    dataset.meta.next_ticket_seq = Math.max(dataset.meta.next_ticket_seq, s.ticket);
    dataset.meta.next_escalation_seq = Math.max(dataset.meta.next_escalation_seq, s.escalation);
    dataset.meta.next_nps_seq = Math.max(dataset.meta.next_nps_seq, s.nps);
    dataset.meta.next_qa_seq = Math.max(dataset.meta.next_qa_seq, s.qa);
  };
  const pick = (o, fields) => { const r = {}; for (const f of fields) r[f] = o[f]; return r; };

  /* rngState rides along on every ops message rather than being negotiated at
     failover. It is one integer next to records that are orders of magnitude
     larger, and it means an inheriting leader simply continues the sequence —
     no handshake, no window where nobody knows where the PRNG was. */
  let lastRngState = rng.state();

  /** Everything a tab that just opened needs in order to match this one. */
  function snapshot() {
    const born = (r) => r.is_live || r.is_uploaded;
    return {
      type: 'state', seed, asOf, running, tier,
      /* Distinct from `asOf`, which is when the DATASET was generated. This is
         the instant the receiver should score the engine against, so a joining
         tab's first frame lands on the same window boundary as its peers'
         rather than on its own clock. */
      engineAsOf: Date.now(),
      rngState: rng.state(), seq: seqOf(), counters: { ...counters },
      tickets: dataset.tickets.filter(born),
      escalations: dataset.escalations.filter(born),
      nps: dataset.nps.filter(born),
      qa: dataset.qa.filter(born),
      // Historical records the live simulator reached back and mutated. Live
      // records already carry their own current state in the arrays above.
      resolved: dataset.tickets.filter((t) => t.resolved_live && !t.is_live)
        .map((t) => ({ ticket_id: t.ticket_id, ...pick(t, RESOLVE_FIELDS) })),
      escalated: dataset.tickets.filter((t) => t.escalated_live && !t.is_live)
        .map((t) => ({ ticket_id: t.ticket_id, escalation_id: t.escalation_id })),
      // `ref` points at a record already travelling in the arrays above.
      // Cloning it here would hand the receiver a second, detached copy of the
      // same ticket — the ticker only reads kind/text/at, so drop it.
      feed: feed.slice(0, FEED_MAX).map(({ ref, ...f }) => f),
    };
  }

  /** Adopt a peer's world wholesale. Rebuilds from the seed first so applying a
      snapshot twice cannot double-count anything. */
  function applySnapshot(s) {
    /* Adopt the peer's tier before the seed check, not inside it: a tab can
       join a session running on the same seed but a different plan, and
       nesting this would leave the two windows showing different padlocks
       over identical data. */
    if (s.tier != null) setTierLocal(normalizeTier(s.tier));
    if (s.seed !== seed || s.asOf !== asOf) {
      seed = s.seed; asOf = s.asOf;
      saveSession({ seed, as_of: asOf, tier });
    }
    dataset = generate(seed, asOf);
    rng = makeRng(seed ^ 0x5f3759df);

    const byId = new Map(dataset.tickets.map((t) => [t.ticket_id, t]));
    for (const t of s.tickets) { dataset.tickets.push(t); byId.set(t.ticket_id, t); }
    dataset.escalations.push(...s.escalations);
    dataset.nps.push(...s.nps);
    dataset.qa.push(...s.qa);
    for (const p of s.resolved) Object.assign(byId.get(p.ticket_id) || {}, p, { resolved_live: true });
    for (const p of s.escalated) Object.assign(byId.get(p.ticket_id) || {}, { escalated: true, escalation_id: p.escalation_id, escalated_live: true });

    applySeq(s.seq);
    rng.setState(s.rngState); lastRngState = s.rngState;
    counters = { ...s.counters };
    feed.length = 0; feed.push(...(s.feed || []));
    running = s.running;
    refreshTodaySeries();
    engine = runEngine(dataset, { asOf: s.engineAsOf ?? Date.now() });
    emit({ type: 'reset', seed, remote: true });
  }

  /** Change the plan in THIS tab only. Split out from `api.setTier` so that
      applying a peer's tier cannot echo the message back and start a loop. */
  function setTierLocal(next) {
    if (next === tier) return false;
    tier = next;
    ent = entitlements(tier);
    saveSession({ seed, as_of: asOf, tier });
    return true;
  }

  /** Apply one tick's worth of the leader's work. */
  function applyOps(m) {
    const events = [];
    const byId = new Map();
    for (const t of dataset.tickets) byId.set(t.ticket_id, t);

    for (const t of m.tickets || []) {
      dataset.tickets.push(t); byId.set(t.ticket_id, t);
      events.push({ kind: 'ticket', id: t.ticket_id, text: `${t.category} · ${t.ticket_subject}`, meta: t.company, priority: t.ticket_priority, ref: t });
    }
    for (const p of m.resolved || []) {
      const t = byId.get(p.ticket_id);
      if (!t) continue;
      Object.assign(t, p, { resolved_live: true });
      events.push({ kind: 'resolved', id: t.ticket_id, text: `Resolved — ${t.ticket_subject}`, meta: t.resolution, ref: t });
    }
    for (const e of m.escalations || []) {
      dataset.escalations.push(e);
      const t = byId.get(e.ticket_id);
      if (t) Object.assign(t, { escalated: true, escalation_id: e.escalation_id, escalated_live: true });
      events.push({ kind: 'escalation', id: e.escalation_id, text: `${e.severity} escalation — ${e.reason}`, meta: e.company, ref: e });
    }
    for (const n of m.nps || []) {
      dataset.nps.push(n);
      events.push({ kind: 'nps', id: n.response_id, text: `NPS ${n.score} · ${n.segment}`, meta: n.company, ref: n });
    }
    for (const q of m.qa || []) {
      dataset.qa.push(q);
      events.push({ kind: 'qa', id: q.qa_id, text: `QA review ${q.overall_score} — ${q.agent_name}`, meta: q.cohort === 'new_hire' ? 'new hire' : 'tenured', ref: q });
    }

    applySeq(m.seq);
    if (typeof m.rngState === 'number') { lastRngState = m.rngState; rng.setState(m.rngState); }
    if (m.counters) counters = { ...m.counters };
    for (const e of events) pushFeed(e);
    refreshTodaySeries();
    emit({ type: 'tick', events, remote: true });
  }

  const sync = createSync({
    enabled: opts.sync,
    isRunning: () => running,
    onLeader: (reason) => {
      // Inherited the writer role. Continue the PRNG from wherever the previous
      // leader left it, then resume ticking if the sim was running.
      rng.setState(lastRngState);
      if (running) installTimers();
      /* Announce the world unasked. Tabs send `hello` while constructing, which
         in a real browser is BEFORE any lock has been granted — so two tabs
         opened together (session restore, two links at once) both ask when
         there is nobody to answer, and the one that loses the lock would wait
         forever for a snapshot that never comes. Publishing on promotion
         answers the question they already asked. Skipped for 'delegated',
         where every tab is in sync by construction and this would just be a
         large message on every visibility change. */
      if (reason !== 'delegated') sync.post(snapshot());
      emit({ type: 'leader', leader: true, reason });
    },
    // Handed the simulator to a visible tab. `running` stays true — the
    // operation has not paused, this tab simply stopped being the one writing.
    onDemote: () => { suspendTimers(); emit({ type: 'leader', leader: false }); },
    onMessage: (m) => {
      switch (m.type) {
        case 'hello':   if (sync.isLeader) sync.post(snapshot()); break;
        case 'state':   if (!sync.isLeader) applySnapshot(m); break;
        case 'ops':     if (!sync.isLeader) applyOps(m); break;
        case 'engine':  if (!sync.isLeader) { engine = runEngine(dataset, { asOf: m.asOf }); emit({ type: 'engine', reason: m.reason, ms: 0, remote: true }); } break;
        case 'running': running = m.running; if (!sync.isLeader) emit({ type: 'running', running }); break;
        case 'reseed':  if (!sync.isLeader) doReseed(m.seed, m.asOf, true); break;
        /* Unguarded, unlike the rest: ops/state/engine/reseed only ever travel
           leader→follower, but a CSV is dropped on whichever tab the user has
           in front of them. The file exists nowhere else, so a follower is the
           sender and the LEADER is one of the receivers. */
        case 'upload':  applyUpload(m); break;
        /* Unguarded for the same reason as `upload`, and it is the same trap:
           the tier switcher sits in the header of whichever tab the user has
           in front of them, which is very often a FOLLOWER. Guarding this on
           `isLeader` would make the control work in one window and silently do
           nothing in every other one. */
        case 'tier':    if (setTierLocal(normalizeTier(m.tier))) emit({ type: 'tenant', tier, remote: true }); break;
        // Followers cannot write, so their toolbar buttons ask the leader to.
        case 'control': if (sync.isLeader) (m.running ? api.start() : api.stop()); break;
        case 'control-reseed': if (sync.isLeader) api.reseed(m.seed); break;
        default: break;
      }
    },
  });

  function suspendTimers() {
    clearInterval(tickTimer); clearInterval(engineTimer);
    tickTimer = engineTimer = null;
  }
  function installTimers() {
    suspendTimers();
    tickTimer = setInterval(tick, TICK_MS);
    engineTimer = setInterval(() => recompute('scheduled'), ENGINE_MS);
  }

  function tick() {
    const now = Date.now();
    const events = [];
    const ops = { type: 'ops', now, tickets: [], resolved: [], escalations: [], nps: [], qa: [] };

    // Arrivals slightly outpace resolutions — the backlog story stays true
    // while you watch it, which is the whole point of a live demo.
    const arrivals = rng.int(1, 3);
    for (let i = 0; i < arrivals; i++) {
      const t = makeLiveTicket(dataset, rng, now - rng.int(0, 40) * 1000);
      dataset.tickets.push(t);
      counters.added++;
      ops.tickets.push(t);
      events.push({ kind: 'ticket', id: t.ticket_id, text: `${t.category} · ${t.ticket_subject}`, meta: t.company, priority: t.ticket_priority, ref: t });
    }

    const resolutions = rng.int(0, 2);
    for (let i = 0; i < resolutions; i++) {
      const t = resolveLiveTicket(dataset, rng, now);
      if (!t) break;
      t.resolved_live = true;
      counters.resolved++;
      /* Always patch, including for tickets born live. It is tempting to skip
         those — they were shipped whole a moment ago — but "a moment ago" is
         only true when the SAME tick both creates and resolves one. Resolve it
         two ticks later and the receiver still holds the open version forever.
         Re-applying a patch to a record that arrived in this batch is a no-op;
         omitting one is silent, permanent drift. */
      ops.resolved.push({ ticket_id: t.ticket_id, ...pick(t, RESOLVE_FIELDS) });
      events.push({ kind: 'resolved', id: t.ticket_id, text: `Resolved — ${t.ticket_subject}`, meta: t.resolution, ref: t });
    }

    if (rng.chance(0.42)) {
      const r = makeLiveEscalation(dataset, rng, now);
      if (r) {
        dataset.escalations.push(r.escalation);
        r.ticket.escalated_live = true;
        counters.escalated++;
        ops.escalations.push(r.escalation);
        events.push({ kind: 'escalation', id: r.escalation.escalation_id, text: `${r.escalation.severity} escalation — ${r.escalation.reason}`, meta: r.escalation.company, ref: r.escalation });
      }
    }

    if (rng.chance(0.55)) {
      const n = makeLiveNps(dataset, rng, now);
      dataset.nps.push(n);
      counters.nps++;
      ops.nps.push(n);
      events.push({ kind: 'nps', id: n.response_id, text: `NPS ${n.score} · ${n.segment}`, meta: n.company, ref: n });
    }

    if (rng.chance(0.14)) {
      const q = makeLiveQa(dataset, rng, now);
      dataset.qa.push(q);
      counters.qa++;
      ops.qa.push(q);
      events.push({ kind: 'qa', id: q.qa_id, text: `QA review ${q.overall_score} — ${q.agent_name}`, meta: q.cohort === 'new_hire' ? 'new hire' : 'tenured', ref: q });
    }

    for (const e of events) pushFeed(e);
    refreshTodaySeries();
    lastRngState = rng.state();
    ops.rngState = lastRngState;
    ops.seq = seqOf();
    ops.counters = { ...counters };
    sync.post(ops);
    emit({ type: 'tick', events });
  }

  function recompute(reason = 'scheduled', at = Date.now()) {
    const t0 = performance.now();
    engine = runEngine(dataset, { asOf: at });
    sync.post({ type: 'engine', asOf: at, reason });
    emit({ type: 'engine', reason, ms: Math.round(performance.now() - t0) });
  }

  function doReseed(newSeed, newAsOf, remote) {
    seed = newSeed; asOf = newAsOf;
    dataset = generate(seed, asOf);
    rng = makeRng(seed ^ 0x5f3759df);
    lastRngState = rng.state();
    counters = { added: 0, resolved: 0, escalated: 0, nps: 0, qa: 0, uploaded: 0 };
    feed.length = 0;
    saveSession({ seed, as_of: asOf, tier });
    // asOf IS the reseeding tab's clock, so every tab scores the new world
    // against the same instant.
    engine = runEngine(dataset, { asOf });
    emit({ type: 'engine', reason: 'reseed', ms: 0 });
    emit({ type: 'reset', seed, remote: !!remote });
    return seed;
  }

  function applyUpload({ kind, rows, counters: c, seq, engineAsOf }) {
    const target = kind === 'nps' ? dataset.nps : kind === 'qa' ? dataset.qa : dataset.tickets;
    target.push(...rows);
    applySeq(seq);
    if (c) counters = { ...c };
    pushFeed({ kind: 'upload', id: kind, text: `Ingested ${rows.length} ${kind} records`, meta: 'from another tab' });
    refreshTodaySeries();
    engine = runEngine(dataset, { asOf: engineAsOf ?? Date.now() });
    emit({ type: 'engine', reason: 'upload', ms: 0, remote: true });
  }

  const api = {
    /* ── reads ── */
    get dataset() { return dataset; },
    get engine() { return engine; },
    get feed() { return feed; },
    get seed() { return seed; },
    get counters() { return counters; },
    get running() { return running; },
    /** The current plan name, and the entitlements object every surface gates
        on. Surfaces call `store.entitlements.can(feature)` — they never read
        the tier name and branch on it themselves. */
    get tier() { return tier; },
    get entitlements() { return ent; },
    /** True when this tab owns the simulator. Followers mirror it. */
    get isLeader() { return sync.isLeader; },
    get synced() { return sync.active && !sync.solo; },

    /* ── subscription ── */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /* ── simulation control ── */
    start() {
      // A follower never holds a timer, so "already running" is the right
      // no-op for it — otherwise every call would re-ask the leader.
      if (running && (tickTimer || !sync.isLeader)) return;
      running = true;
      if (sync.isLeader) { installTimers(); sync.post({ type: 'running', running: true }); }
      else sync.post({ type: 'control', running: true });
      emit({ type: 'running', running: true });
    },
    stop() {
      running = false;
      suspendTimers();
      if (sync.isLeader) sync.post({ type: 'running', running: false });
      else sync.post({ type: 'control', running: false });
      emit({ type: 'running', running: false });
    },
    toggle() { running ? api.stop() : api.start(); },
    recompute,

    /**
     * Switch commercial tier. A demo control, not a billing operation — there
     * is no upgrade flow behind it and nothing is charged.
     *
     * Note what this does NOT do: it does not touch the dataset, re-run the
     * engine, or invalidate anything. The tier changes which surfaces the UI
     * is allowed to open, and nothing else. Detection, ranking and costing are
     * identical on every plan, because a customer on Essential is being sold
     * fewer surfaces, not a worse engine.
     */
    setTier(name) {
      const next = normalizeTier(name);
      if (!setTierLocal(next)) return tier;
      // Every tab, leader or not. See the 'tier' case in onMessage.
      sync.post({ type: 'tier', tier: next });
      emit({ type: 'tenant', tier: next });
      return tier;
    },

    /** New random world — the same four patterns, different everything else. */
    reseed(newSeed) {
      const s = newSeed ?? Math.floor(Math.random() * 2147483647);
      if (!sync.isLeader) { sync.post({ type: 'control-reseed', seed: s }); return s; }
      const at = Date.now();
      sync.post({ type: 'reseed', seed: s, asOf: at });
      return doReseed(s, at, false);
    },

    /**
     * Ingest a CSV. Not a simulated upload: rows are parsed, mapped, appended
     * and the engine re-runs, so what the Decision Feed says afterwards is a
     * function of the file you actually dropped.
     */
    ingestCsv(text, kindHint) {
      const { headers, rows } = parseCsv(text);
      if (!headers.length) return { ok: false, error: 'File is empty or not valid CSV.' };
      const kind = kindHint && kindHint !== 'auto' ? kindHint : detectKind(headers);
      const { map, missing, matched } = resolveColumns(headers, kind);
      if (matched < 2) {
        return { ok: false, kind, headers, error: `Could not recognise this as ${kind} data — only ${matched} column(s) matched a known field.` };
      }
      const mapper = kind === 'nps' ? mapNps : kind === 'qa' ? mapQa : mapTickets;
      const { rows: mapped, errors } = mapper(rows, map, dataset);
      // Tagged so a tab joining later can tell an uploaded row from the
      // generated history and ship it in the snapshot.
      for (const r of mapped) r.is_uploaded = true;
      const target = kind === 'nps' ? dataset.nps : kind === 'qa' ? dataset.qa : dataset.tickets;
      target.push(...mapped);
      counters.uploaded += mapped.length;
      refreshTodaySeries();
      pushFeed({ kind: 'upload', id: kind, text: `Ingested ${mapped.length} ${kind} records`, meta: `${matched} columns mapped` });
      // The file only exists in this tab, so the mapped ROWS are what travels —
      // re-parsing elsewhere is impossible and re-deriving them would be worse.
      const at = Date.now();
      sync.post({ type: 'upload', kind, rows: mapped, counters: { ...counters }, seq: seqOf(), engineAsOf: at });
      recompute('upload', at);
      return {
        ok: true, kind, headers, mapped_columns: map, unmatched_fields: missing,
        added: mapped.length, skipped: rows.length - mapped.length, errors: errors.slice(0, 8),
        total_rows: rows.length,
      };
    },

    close() { sync.close(); suspendTimers(); },
  };

  // Ask whoever is already running for their world. If nobody answers, this tab
  // wins the lock and becomes the answer for the next one.
  sync.post({ type: 'hello' });
  if (opts.autoStart !== false) api.start();
  return api;
}
