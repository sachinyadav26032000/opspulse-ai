/* ==========================================================================
   Decision ledger — what was flagged, and what happened next
   --------------------------------------------------------------------------
   The site has sold a "Renewal Decision Ledger" since launch. Until now it
   existed in marketing copy and nowhere in the product. This is it.

   It exists because a pricing model tied to retained ARR is only credible if
   the system can show what it flagged, when, who touched it and how it ended.
   That record has to survive the engine re-running, which it does every ~9
   seconds, and a page reload.

   THREE THINGS THAT MAKE THIS WORK

   1. insight_id is stable. `ins_` + shortHash(anomaly key), where keys are
      semantic (`esc_spike:Billing`, `coaching:new_hire_cohort`). The same
      anomaly hashes to the same id on every pass, so a lifecycle row can
      attach to it and survive re-runs.

   2. EPISODES. A stable id has one dangerous consequence: an anomaly that
      clears in March and returns in September gets the SAME id. Without a
      boundary, a save recorded in March silently absorbs the September
      recurrence and the retention number is corrupted — which is exactly the
      figure a buyer would probe hardest. So a lifecycle row is keyed by
      `insight_id#episode`, and an id that goes absent for a full pass and
      comes back opens a new episode.

   3. ATTRIBUTION IS NEVER CLAIMED. The product can say "we flagged this
      account and it renewed". It cannot say "it renewed because of us". Every
      field and label here is named accordingly: `arr_on_flagged_retained`,
      never `arr_saved`. See the note on OUTCOMES below.

   Writes are UI-driven only. The seven MCP tools stay read-only, per the
   standing rule that a mutating tool is a decision to escalate rather than
   make.
   ========================================================================== */

const LS_KEY = 'opspulse.ledger.v1';

export const OUTCOME = {
  PENDING: 'pending',
  RETAINED: 'retained',
  CHURNED: 'churned',
  EXPANDED: 'expanded',
};

/* ------------------------------------------------------------------
   Persistence. Small enough for localStorage: one row per decision, not
   per record. Failures are swallowed the same way the session store does,
   because privacy mode should degrade the ledger, not break the app.
   ------------------------------------------------------------------ */
function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && typeof s === 'object' && Array.isArray(s.rows) ? s : null;
  } catch { return null; }
}
function save(state) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* quota or privacy mode */ }
}

export function createLedger(opts = {}) {
  const persisted = opts.fresh ? null : load();
  /* rows: Map key -> lifecycle. `seenLast` tracks which ids were present on
     the previous pass, which is what makes episode boundaries possible. */
  const rows = new Map((persisted?.rows || []).map((r) => [r.key, r]));
  let seenLast = new Set(persisted?.seen || []);

  const keyOf = (insightId, episode) => `${insightId}#${episode}`;

  function currentEpisode(insightId) {
    let ep = 0;
    for (const r of rows.values()) if (r.insight_id === insightId && r.episode > ep) ep = r.episode;
    return ep;
  }

  function persist() {
    save({ rows: [...rows.values()], seen: [...seenLast] });
  }

  const api = {
    /**
     * Called after every engine pass with the insights currently raised.
     * Opens a lifecycle row for anything newly surfaced, and opens a NEW
     * EPISODE for an id that had gone away and come back.
     */
    sync(insights, atMs) {
      const now = atMs ?? Date.now();
      const seenNow = new Set();

      for (const i of insights) {
        const id = i.insight_id;
        seenNow.add(id);
        const ep = currentEpisode(id);
        const open = ep > 0 ? rows.get(keyOf(id, ep)) : null;

        /* An episode that is still open stays open, whether or not the id was
           present on the previous pass. A detector that flickers across the
           threshold for a pass or two is the same episode, not a new one:
           opening a fresh row on every flicker would inflate the decision
           count and, worse, split one save across several rows. A new episode
           opens only when the last one has actually CLOSED with an outcome. */
        if (open && open.outcome === OUTCOME.PENDING) continue;

        const key = keyOf(id, ep + 1);
        if (!rows.has(key)) {
          rows.set(key, {
            key,
            insight_id: id,
            episode: ep + 1,
            title: i._meta?.title || id,
            signal_type: i.signal_type,
            surfaced_at: now,
            /* Exposure as the engine stated it, high end of the published
               range. Recorded at surfacing time and never recomputed, so the
               ledger shows what was known then rather than what is known now. */
            arr_at_risk: i._meta?.impact?.high ?? null,
            confidence: i.why?.confidence ?? null,
            held: i.status === 'held_for_review',
            viewed_at: null,
            actioned_at: null,
            action_taken: null,
            outcome: OUTCOME.PENDING,
            outcome_at: null,
            arr_outcome: null,
            simulated: false,
          });
        }
      }
      seenLast = seenNow;
      persist();
    },

    /** The user opened the drill-down. First view only, so it records latency. */
    markViewed(insightId, atMs) {
      const r = api.open(insightId);
      if (r && !r.viewed_at) { r.viewed_at = atMs ?? Date.now(); persist(); }
      return r;
    },

    /** The user committed to a play. */
    markActioned(insightId, action, atMs) {
      const r = api.open(insightId);
      if (!r) return null;
      r.actioned_at = atMs ?? Date.now();
      r.action_taken = action || 'Assigned';
      if (!r.viewed_at) r.viewed_at = r.actioned_at;
      persist();
      return r;
    },

    /** The currently open (pending) episode for an id, if any. */
    open(insightId) {
      const ep = currentEpisode(insightId);
      const r = ep ? rows.get(keyOf(insightId, ep)) : null;
      return r && r.outcome === OUTCOME.PENDING ? r : null;
    },

    all() { return [...rows.values()]; },
    closed() { return [...rows.values()].filter((r) => r.outcome !== OUTCOME.PENDING); },
    pending() { return [...rows.values()].filter((r) => r.outcome === OUTCOME.PENDING); },

    /** Seed closed history so the Impact surface has something to show. */
    seedHistory(history) {
      let added = 0;
      for (const h of history) {
        if (rows.has(h.key)) continue;
        rows.set(h.key, h);
        added++;
      }
      if (added) persist();
      return added;
    },

    reset() { rows.clear(); seenLast = new Set(); persist(); },
  };

  return api;
}

/* ==========================================================================
   Impact rollup
   --------------------------------------------------------------------------
   The three outcomes a buyer asks about: financial, adoption, operational.

   ON THE FINANCIAL METRIC, ONE NAMING RULE THAT IS NOT NEGOTIABLE.

   The product knows two facts: it flagged an account, and that account
   renewed. It does NOT know the second happened because of the first. There is
   no counterfactual here — nobody ran the account without the intervention.

   So the metric is `arr_on_flagged_retained`, rendered as "ARR retained on
   flagged accounts". Never "ARR saved", never "ARR we saved", never
   "influenced". A sceptical buyer probes this exact claim, and a product whose
   whole argument is that it does not overstate cannot lose that argument at
   the point where money is discussed.
   ========================================================================== */

export function impactRollup(ledger, rows) {
  const closed = ledger.closed();
  const all = ledger.all();

  const sum = (list, f) => list.reduce((s, r) => s + (f(r) || 0), 0);

  const retained = closed.filter((r) => r.outcome === OUTCOME.RETAINED);
  const churned = closed.filter((r) => r.outcome === OUTCOME.CHURNED);
  const expanded = closed.filter((r) => r.outcome === OUTCOME.EXPANDED);

  const flaggedArr = sum(all, (r) => r.arr_at_risk);
  const retainedArr = sum(retained, (r) => r.arr_outcome ?? r.arr_at_risk);
  const churnedArr = sum(churned, (r) => r.arr_outcome ?? r.arr_at_risk);
  const expandedArr = sum(expanded, (r) => r.arr_outcome ?? 0);

  /* Adoption: how many accounts sit below the threshold now, and how many that
     were below it have climbed back above. Read from the same rollup rows the
     Copilot queries, so the two cannot disagree. */
  const withAdoption = rows.filter((r) => r.adoption_pct != null);
  const below = withAdoption.filter((r) => r.adoption_pct < 60);
  const recovered = withAdoption.filter((r) =>
    r.adoption_baseline_pct != null && r.adoption_baseline_pct < 60 && r.adoption_pct >= 60);

  /* Operational: decisions the system raised without anyone asking, and how
     long a raised decision waited before a human looked at it. */
  const viewed = all.filter((r) => r.viewed_at);
  const latencies = viewed.map((r) => r.viewed_at - r.surfaced_at).filter((n) => n >= 0);
  const medianLatency = latencies.length
    ? latencies.slice().sort((a, b) => a - b)[Math.floor(latencies.length / 2)]
    : null;

  return {
    financial: {
      arr_flagged: flaggedArr,
      arr_on_flagged_retained: retainedArr,     // NEVER "arr_saved"
      arr_on_flagged_churned: churnedArr,
      arr_expansion_surfaced: expandedArr,
      decisions_closed: closed.length,
      /* Share of CLOSED decisions that renewed. An observation about what
         happened to flagged accounts, not a claim of causation. */
      retained_share: closed.length ? Math.round((retained.length / closed.length) * 100) : null,
    },
    adoption: {
      accounts_with_usage: withAdoption.length,
      below_threshold: below.length,
      recovered_above: recovered.length,
      threshold_pct: 60,
    },
    operational: {
      surfaced_unprompted: all.length,
      viewed: viewed.length,
      actioned: all.filter((r) => r.actioned_at).length,
      median_time_to_view_ms: medianLatency,
      pending: ledger.pending().length,
    },
    simulated_rows: all.filter((r) => r.simulated).length,
    total_rows: all.length,
  };
}

/* ==========================================================================
   Seeded history
   --------------------------------------------------------------------------
   A ledger is only interesting once decisions have closed, and this prototype
   cannot wait a renewal cycle to show one. So a set of CLOSED decisions is
   seeded from prior quarters.

   Every seeded row carries `simulated: true`, is dated before the current
   analysis window so it can never collide with a live episode, and is counted
   separately in the rollup so the Impact surface can state plainly how much of
   what it is showing is illustrative. The live rows above it are real: they
   record genuine surfacings, views and actions from this session.

   Deterministic from the dataset seed, so two tabs on the same operation show
   the same history rather than inventing their own.
   ========================================================================== */

const SEED_ACTIONS = [
  'Executive Business Review',
  'Integration Recovery',
  'Adoption Rescue Plan',
  'Escalation Task Force',
  'Renewal Save Play',
];

export function buildSeededHistory(ds, rows) {
  /* Deterministic PRNG from the dataset seed. Not imported from rng.js: this
     needs to be stable regardless of how many draws the generator made. */
  let s = (ds.meta.seed ^ 0x9e3779b9) >>> 0;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const DAY = 86400000;
  const candidates = rows
    .filter((r) => r.arr_usd)
    .slice()
    .sort((a, b) => b.arr_usd - a.arr_usd)
    .slice(0, 140);

  const out = [];
  const N = 24;
  for (let i = 0; i < N && i < candidates.length; i++) {
    const acct = candidates[Math.floor(rand() * candidates.length)];
    /* Surfaced 120-400 days ago, closed 30-90 days after that. Always before
       the current window, so a seeded row can never be mistaken for, or
       collide with, an episode opened in this session. */
    const surfaced = ds.meta.as_of - Math.round(120 + rand() * 280) * DAY;
    const closedAfter = Math.round(30 + rand() * 60) * DAY;
    const roll = rand();
    /* Deliberately NOT a flattering distribution. Roughly a fifth of flagged
       accounts left anyway. A ledger that only remembers its wins is one you
       cannot forecast with, and a buyer checks for exactly that. */
    const outcome = roll < 0.62 ? OUTCOME.RETAINED : roll < 0.82 ? OUTCOME.CHURNED : roll < 0.92 ? OUTCOME.EXPANDED : OUTCOME.RETAINED;
    const arr = acct.arr_usd;

    out.push({
      key: `seed_${i}#1`,
      insight_id: `seed_${i}`,
      episode: 1,
      title: `${acct.company} · renewal risk`,
      signal_type: 'churn_risk',
      surfaced_at: surfaced,
      arr_at_risk: arr,
      confidence: Math.round((0.62 + rand() * 0.3) * 100) / 100,
      held: false,
      viewed_at: surfaced + Math.round(rand() * 3 * DAY),
      actioned_at: surfaced + Math.round((1 + rand() * 5) * DAY),
      action_taken: pick(SEED_ACTIONS),
      outcome,
      outcome_at: surfaced + closedAfter,
      /* Expansion records the uplift, not the whole contract. */
      arr_outcome: outcome === OUTCOME.EXPANDED ? Math.round(arr * (0.1 + rand() * 0.25)) : arr,
      simulated: true,
    });
  }
  return out;
}
