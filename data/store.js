/* ==========================================================================
   The live store — one dataset, one simulator, many views.
   --------------------------------------------------------------------------
   ARCHITECTURE NOTE (this is the important bit):
   ServiceDesk and OpsPulse are not two applications that sync. They are two
   VIEWS OVER ONE STORE. `demo.html` mounts both against a single store
   instance, so a ticket created in the service desk is already in the object
   OpsPulse reads — there is nothing to synchronize, and therefore nothing that
   can fall out of sync. Cross-tab message passing was deliberately not built:
   it would add leader election, replay and persistence-race handling to buy a
   guarantee this design gets for free.

   Two clocks, on purpose:
     · TICK (~3.2s)   cheap: append events, update counters and the ticker.
     · ENGINE (~9s)   expensive: re-run all nine detectors + reasoning.
   Running the engine on every tick would stutter and, worse, make the top-3
   flicker. The 90-day base dominates the recent window, so live deltas move
   the numbers without reshuffling what a director is being told to do.
   ========================================================================== */

import { generate, makeLiveTicket, resolveLiveTicket, makeLiveEscalation, makeLiveNps, makeLiveQa } from './generator.js';
import { makeRng } from './rng.js';
import { runEngine } from '../engine/web/index.js';
import { parseCsv, resolveColumns, mapTickets, mapNps, mapQa, detectKind } from './csv.js';

const LS_KEY = 'opspulse.session.v1';
const TICK_MS = 3200;
const ENGINE_MS = 9000;
const FEED_MAX = 80;

function loadSession() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    // Persist the seed AND the as-of instant together: day0 is derived from
    // as_of, so a seed alone would rebuild a differently-aligned history.
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

  let dataset = generate(seed, asOf);
  let engine = runEngine(dataset);
  let rng = makeRng(seed ^ 0x5f3759df);

  const feed = [];
  const listeners = new Set();
  let tickTimer = null, engineTimer = null, running = false;
  let counters = { added: 0, resolved: 0, escalated: 0, nps: 0, qa: 0, uploaded: 0 };

  /* The decision ledger. A recommendation the engine makes is not a decision;
     a decision is a human committing to an action, on evidence, at a stated
     confidence. The ledger is the only place that commitment is recorded, and
     it snapshots the evidence AS IT WAS at the moment of the call — so an
     outcome can be judged later without the engine quietly rewriting history. */
  let decisions = [];

  saveSession({ seed, as_of: asOf });

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

  function tick() {
    const now = Date.now();
    const events = [];

    // Arrivals slightly outpace resolutions — the backlog story stays true
    // while you watch it, which is the whole point of a live demo.
    const arrivals = rng.int(1, 3);
    for (let i = 0; i < arrivals; i++) {
      const t = makeLiveTicket(dataset, rng, now - rng.int(0, 40) * 1000);
      dataset.tickets.push(t);
      counters.added++;
      events.push({ kind: 'ticket', id: t.ticket_id, text: `${t.category} · ${t.ticket_subject}`, meta: t.company, priority: t.ticket_priority, ref: t });
    }

    const resolutions = rng.int(0, 2);
    for (let i = 0; i < resolutions; i++) {
      const t = resolveLiveTicket(dataset, rng, now);
      if (!t) break;
      counters.resolved++;
      events.push({ kind: 'resolved', id: t.ticket_id, text: `Resolved — ${t.ticket_subject}`, meta: t.resolution, ref: t });
    }

    if (rng.chance(0.42)) {
      const r = makeLiveEscalation(dataset, rng, now);
      if (r) {
        dataset.escalations.push(r.escalation);
        counters.escalated++;
        events.push({ kind: 'escalation', id: r.escalation.escalation_id, text: `${r.escalation.severity} escalation — ${r.escalation.reason}`, meta: r.escalation.company, ref: r.escalation });
      }
    }

    if (rng.chance(0.55)) {
      const n = makeLiveNps(dataset, rng, now);
      dataset.nps.push(n);
      counters.nps++;
      events.push({ kind: 'nps', id: n.response_id, text: `NPS ${n.score} · ${n.segment}`, meta: n.company, ref: n });
    }

    if (rng.chance(0.14)) {
      const q = makeLiveQa(dataset, rng, now);
      dataset.qa.push(q);
      counters.qa++;
      events.push({ kind: 'qa', id: q.qa_id, text: `QA review ${q.overall_score} — ${q.agent_name}`, meta: q.cohort === 'new_hire' ? 'new hire' : 'tenured', ref: q });
    }

    for (const e of events) pushFeed(e);
    refreshTodaySeries();
    emit({ type: 'tick', events });
  }

  function recompute(reason = 'scheduled') {
    const t0 = performance.now();
    engine = runEngine(dataset, { asOf: Date.now() });
    emit({ type: 'engine', reason, ms: Math.round(performance.now() - t0) });
  }

  const api = {
    /* ── reads ── */
    get dataset() { return dataset; },
    get engine() { return engine; },
    get feed() { return feed; },
    get seed() { return seed; },
    get counters() { return counters; },
    get running() { return running; },
    get decisions() { return decisions; },

    /* ── subscription ── */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /* ── decision ledger ── */

    /**
     * Commit a decision. `entry` carries the evidence snapshot; the store adds
     * identity and timestamps. Returns the stored record.
     */
    recordDecision(entry) {
      const rec = {
        decision_id: `DEC-${String(decisions.length + 1).padStart(3, '0')}`,
        decided_at: Date.now(),
        status: 'open',
        history: [{ status: 'open', at: Date.now() }],
        ...entry,
      };
      decisions.unshift(rec);
      pushFeed({ kind: 'decision', id: rec.decision_id, text: `Decision recorded — ${rec.title}`, meta: rec.owner_role });
      emit({ type: 'decision', decision: rec });
      return rec;
    },

    /** Move a decision along its lifecycle, keeping the transition history. */
    updateDecision(id, patch) {
      const rec = decisions.find((x) => x.decision_id === id);
      if (!rec) return null;
      if (patch.status && patch.status !== rec.status) rec.history.push({ status: patch.status, at: Date.now() });
      Object.assign(rec, patch);
      emit({ type: 'decision', decision: rec });
      return rec;
    },

    /* ── simulation control ── */
    start() {
      if (running) return;
      running = true;
      tickTimer = setInterval(tick, TICK_MS);
      engineTimer = setInterval(() => recompute('scheduled'), ENGINE_MS);
      emit({ type: 'running', running: true });
    },
    stop() {
      running = false;
      clearInterval(tickTimer); clearInterval(engineTimer);
      tickTimer = engineTimer = null;
      emit({ type: 'running', running: false });
    },
    toggle() { running ? api.stop() : api.start(); },
    recompute,

    /** New random world — the same four patterns, different everything else. */
    reseed(newSeed) {
      seed = newSeed ?? Math.floor(Math.random() * 2147483647);
      asOf = Date.now();
      dataset = generate(seed, asOf);
      rng = makeRng(seed ^ 0x5f3759df);
      counters = { added: 0, resolved: 0, escalated: 0, nps: 0, qa: 0, uploaded: 0 };
      feed.length = 0;
      // A new world makes old decisions unjudgeable — the signals they were
      // taken against no longer exist. Clearing is more honest than orphaning.
      decisions = [];
      saveSession({ seed, as_of: asOf });
      recompute('reseed');
      emit({ type: 'reset', seed });
      return seed;
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
      const target = kind === 'nps' ? dataset.nps : kind === 'qa' ? dataset.qa : dataset.tickets;
      target.push(...mapped);
      counters.uploaded += mapped.length;
      refreshTodaySeries();
      pushFeed({ kind: 'upload', id: kind, text: `Ingested ${mapped.length} ${kind} records`, meta: `${matched} columns mapped` });
      recompute('upload');
      return {
        ok: true, kind, headers, mapped_columns: map, unmatched_fields: missing,
        added: mapped.length, skipped: rows.length - mapped.length, errors: errors.slice(0, 8),
        total_rows: rows.length,
      };
    },
  };

  if (opts.autoStart !== false) api.start();
  return api;
}
