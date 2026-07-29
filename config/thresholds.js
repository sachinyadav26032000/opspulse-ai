/* ==========================================================================
   Thresholds — the bars this product has to clear, in one file.
   --------------------------------------------------------------------------
   Every number a detector compares against lives here. Not in the detector,
   not at the call site, not in a template string in the UI. Three reasons:

     1. A reviewer can disagree with the whole product in one screen.
     2. Two customers do not share a definition of "low adoption". The
        Freshworks director said "less than 70 or 60%" in a single breath —
        the number is a dial, and which way it is turned is their call, not
        ours. A threshold that ships as a constant ships as our opinion.
     3. When a number appears in prose on a marketing page AND in a detector,
        they drift. Here there is one of each.

   TUNABLE names the set a customer can reasonably be handed at onboarding.
   The rest are statistical bars (z-scores, minimum samples) that hold the
   false-positive rate down — those are ours to defend, not theirs to turn,
   and moving them changes what "significant" means rather than what
   "at risk" means.
   ========================================================================== */

/* ── The dials a customer owns ───────────────────────────────────────────
   These four came directly out of the validation call. Each is a business
   definition, not a statistical one. */
export const TUNABLE = {
  /** Below this % of provisioned seats active, adoption is "low". */
  adoption_risk_pct: 60,
  /** How far ahead a renewal has to be before it stops being this quarter's problem. */
  renewal_window_days: 90,
  /** A usage fall of at least this many % over 30 days is a decline. */
  usage_decline_pct: 25,
  /** No contact in this many days makes an account "silent". */
  silent_account_days: 30,
};

/* ── Detection: statistical bars ─────────────────────────────────────────
   Consumed by engine/web/detect.js as THRESHOLDS. */
export const DETECTION = {
  min_sample: 40,          // no anomaly is raised below this many recent records
  rate_z: 2.5,             // two-proportion z
  cohort_t: 2.5,           // Welch t between cohorts
  qa_gap_pts: 8,           // minimum QA point gap worth coaching on
  volume_lift: 1.35,       // emerging topic must be ≥35% above its own baseline
  backlog_slope: 3,        // tickets/day of sustained queue growth
  nps_drop_pts: 8,
  csat_drop: 0.25,         // mean stars
  churn_arr_floor: 60000,  // ARR below which churn risk isn't worth a card
};

/* ── Revenue detectors ───────────────────────────────────────────────────
   Consumed by engine/web/revenue.js as REVENUE_THRESHOLDS. The four TUNABLE
   dials are spliced in below rather than restated, so there is exactly one
   place each number is written down. */
export const REVENUE = {
  arr_floor: 20000,            // below this it is not a CRO-level decision
  decision_size: 6,            // 4-6 named accounts per decision
  min_accounts: 3,             // fewer than this is not a pattern
  adoption_min_seats: 20,      // small seat counts are noise
  onboarding_window_days: 400, // "since onboarding" horizon
  renewal_deterioration: -12,  // % usage change that counts as deterioration
  concentrated_min: 3,         // accounts sharing one cause before it is one
  concentrated_z: 2.5,         // two-proportion z: the category must be genuinely
                               // OVER-REPRESENTED among at-risk accounts, not
                               // merely the largest of several equal buckets
  concentrated_base_min: 30,   // baseline accounts needed before the z means anything
  cohort_min: 10,              // below this it is a list of accounts, not a cohort —
                               // renewal_risk already names those individually

  /* NOT TUNABLE.adoption_risk_pct, deliberately. That dial (60%) is where a
     CSM's working list starts; this floor (40%) is where adoption is bad
     enough to be a CRO-level decision on its own. Same metric, two different
     bars, and collapsing them would quadruple this detector's output while
     looking like a tidy-up. */
  adoption_floor: 0.40,        // active seats / provisioned

  /* Spliced from TUNABLE. Stored negative because the detector compares a
     signed trend; the dial a human turns stays positive. */
  get silent_usage_drop() { return -TUNABLE.usage_decline_pct; },
  get silent_account_days() { return TUNABLE.silent_account_days; },
  get renewal_window_days() { return TUNABLE.renewal_window_days; },
};

/* ── The renewals × adoption cohort ──────────────────────────────────────
   Consumed by engine/web/cohort.js. */
export const COHORT = {
  get adoption_risk_pct() { return TUNABLE.adoption_risk_pct; },
  scope: 'region',   // csm | region | all — the altitude the question is asked at
  window: 'quarter',
};

/**
 * Turn a dial at runtime. The settings panel calls this; nothing else should.
 *
 * Mutates TUNABLE in place rather than returning a copy, because the getters
 * above close over it — the whole point is that one write reaches every
 * detector without a rebuild or a re-import.
 */
export function setTunable(key, value) {
  if (!(key in TUNABLE)) throw new Error(`unknown threshold: ${key}`);
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${key} must be a positive number`);
  TUNABLE[key] = n;
  return TUNABLE[key];
}
