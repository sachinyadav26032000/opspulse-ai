/* ==========================================================================
   Commercial entitlements — one table, one helper, no branching in surfaces
   --------------------------------------------------------------------------
   WHY THIS FILE EXISTS AT ALL, AND WHY IT IS NOT IN data/ OR engine/:

   A tier is a property of the SUBSCRIPTION, not of the operation. The dataset
   in `data/` is one customer's book of accounts; the engine in `engine/web/`
   scores it. Neither of them should know or care what the customer pays. So
   the tier lives beside them rather than inside them, and the whole of this
   feature is additive: `data/generator.js`, the detectors and the sync record
   protocol are untouched by pricing.

   The corollary matters more. Putting the tier on `dataset.meta` was the
   obvious shortcut and it is wrong twice over: the reseed path in
   `data/store.js` rebuilds meta from the seed, so "New data" would silently
   reset the customer's plan, and it would encode an entitlement as a fact
   about the operation rather than about the contract.

   THE PRICING AXES ARE ACCOUNTS AND SOURCES. NEVER SEATS. A renewal risk only
   gets acted on if the CSM, the RevOps lead and the CRO can all open it, so
   charging per seat prices the product against its own mechanism of action.
   There is deliberately no `max_seats` field here to be tempted by.
   ========================================================================== */

/* Feature metadata, kept next to the tier table rather than in the surfaces
   that render it. A locked panel has to be able to say WHICH tier opens it and
   WHAT it would tell you, and neither of those is something a view should be
   hardcoding — that is how two screens end up naming different tiers for the
   same lock.

   `blurb` is the honest one-line description of what the feature reports. It
   is written to be true whether the feature is on or off, because it is read
   in both states: as a subtitle when unlocked, and as the promise when not. */
export const FEATURES = {
  decision_brief:       { label: 'Decision brief',        blurb: 'The day’s top operational risks, ranked, with the action and the owner for each.' },
  renewal_cohort:       { label: 'Renewal cohorts',       blurb: 'Which accounts renew in a window, and what is wrong with them before they do.' },
  churn_taxonomy:       { label: 'Churn taxonomy',        blurb: 'The reason each at-risk account is at risk, grouped so the pattern is visible.' },
  drill_down:           { label: 'Drill-down',            blurb: 'Every number on every card opens the working behind it.' },
  confidence_scoring:   { label: 'Confidence scoring',    blurb: 'Root cause is scored and anything under 60% is held for review, not actioned.' },
  data_quality:         { label: 'Data quality',          blurb: 'Ingest mapping, record counts, contract validation and detector coverage.' },
  usage_history:        { label: 'Product usage history', blurb: 'Weekly active seats per account against contracted seats, and the trend.' },
  contact_centre:       { label: 'Contact centre',        blurb: 'Call records and transcripts read as a signal alongside tickets and QA.' },
  external_signals:     { label: 'External signals',      blurb: 'Acquisitions, distress, funding and stakeholder change on your accounts.' },
  delegation:           { label: 'Delegation',            blurb: 'Assign a decision to an owner and hold the ledger row against them.' },
  impact_verification:  { label: 'Impact verification',   blurb: 'What was flagged, what you did, and what actually happened at renewal.' },
  executive_copilot:    { label: 'Executive Copilot',     blurb: 'Ask the book a question and get a composable, grounded answer.' },
  sso_audit:            { label: 'SSO, audit trail & residency', blurb: 'SAML/OIDC sign-in, an immutable access log, and a choice of data region.' },
};

export const TIERS = {
  essential: {
    label: 'Essential',
    /* The ceilings are the price. Both are SOFT — see `usageOf()` below. */
    max_accounts: 500,
    max_sources: 3,
    /* An assumed list price, used only by the cost model in
       `engine/web/cost.js` to express a margin. It is a modelling input, not a
       committed price, and every surface that consumes it prints it as an
       input rather than burying it. */
    list_price_usd_month: 1000,
    features: {
      decision_brief: true,
      renewal_cohort: true,
      churn_taxonomy: true,
      drill_down: true,
      confidence_scoring: true,
      data_quality: true,
      usage_history: false,
      contact_centre: false,
      external_signals: false,
      delegation: false,
      impact_verification: false,
      executive_copilot: false,
      sso_audit: false,
    },
  },
  growth: {
    label: 'Growth',
    max_accounts: 2500,
    max_sources: 6,
    list_price_usd_month: 3000,
    features: {
      decision_brief: true,
      renewal_cohort: true,
      churn_taxonomy: true,
      drill_down: true,
      confidence_scoring: true,
      data_quality: true,
      usage_history: true,
      contact_centre: true,
      external_signals: true,
      delegation: true,
      impact_verification: true,
      executive_copilot: false,
      sso_audit: false,
    },
  },
  enterprise: {
    label: 'Enterprise',
    /* null, not Infinity. This value is serialised into the session blob and
       posted across tabs, and `JSON.stringify(Infinity)` is `null` anyway —
       so storing null makes the round trip lossless instead of accidental.
       Every consumer reads it through `usageOf()`, which treats null as
       uncapped rather than as zero. */
    max_accounts: null,
    max_sources: null,
    list_price_usd_month: 7500,
    features: {
      decision_brief: true,
      renewal_cohort: true,
      churn_taxonomy: true,
      drill_down: true,
      confidence_scoring: true,
      data_quality: true,
      usage_history: true,
      contact_centre: true,
      external_signals: true,
      delegation: true,
      impact_verification: true,
      executive_copilot: true,
      sso_audit: true,
    },
  },
};

/* Ascending by price. Used to resolve "which is the cheapest tier that opens
   this feature", so a locked panel can name the upgrade without a surface
   holding its own opinion about the ladder. */
export const TIER_ORDER = ['essential', 'growth', 'enterprise'];

/* THE DEMO DEFAULT IS ENTERPRISE, and that is a considered choice rather than
   a lazy one.

   The alternative — defaulting to Essential so a visitor lands on the locked
   states — makes an unattended visitor's first impression a wall of padlocks,
   which reads as a thin product rather than as a priced one. The upgrade-
   pressure argument in favour of showing locks is real, but it is an argument
   about a MOMENT IN A PITCH, and the tier switcher puts that moment under the
   presenter's control: flip down to Essential, watch four panels lock, flip
   back. Defaulting to the full product also means the entitlement layer cannot
   regress anything that already works.

   `SEED_NOTES.md` states this default so nobody has to read this comment. */
export const DEFAULT_TIER = 'enterprise';

/** Normalise anything (a stored string, a URL param, undefined) to a real tier
    name. Never throws: an unknown tier falls back to the default rather than
    leaving a surface holding `undefined` and rendering a blank lock. */
export function normalizeTier(name) {
  return Object.prototype.hasOwnProperty.call(TIERS, name) ? name : DEFAULT_TIER;
}

/** The cheapest tier that grants `feature`, or null if no tier does. */
export function requiredTier(feature) {
  return TIER_ORDER.find((t) => TIERS[t].features[feature] === true) || null;
}

/* ── Usage against a ceiling ──────────────────────────────────────────────
   SOFT LIMITS, NOT HARD CUTOFFS. Exceeding the account ceiling flags for a
   conversation at renewal; it never blocks the product.

   This is not softness for its own sake. The ceiling is measured in accounts
   under management, so a customer who hits it has grown their book — which is
   the exact outcome this product exists to produce. Blocking them mid-quarter
   would be charging for a result and then punishing it. `state` therefore
   tops out at 'over', and there is deliberately no `blocked` state for a
   surface to key off. */
export const WARN_AT = 0.8;

export function usageOf(used, ceiling) {
  if (ceiling == null) return { used, ceiling: null, pct: null, state: 'unlimited', headroom: null };
  /* Rounded once, here, so the tile and any warning copy read the same integer
     percentage. Two callers each rounding their own float is how a bar at 80%
     ends up next to text that says 79%. */
  const pct = Math.round((used / ceiling) * 100);
  const state = used > ceiling ? 'over' : pct >= WARN_AT * 100 ? 'warn' : 'ok';
  return { used, ceiling, pct, state, headroom: ceiling - used };
}

/* ── The one helper ───────────────────────────────────────────────────────
   Surfaces never read `TIERS[...].features[...]` directly. They hold an
   entitlements object and ask it. That is what keeps the tier table the single
   source of truth rather than the first of several. */
export function entitlements(tierName) {
  const name = normalizeTier(tierName);
  const t = TIERS[name];
  return {
    tier: name,
    label: t.label,
    max_accounts: t.max_accounts,
    max_sources: t.max_sources,
    list_price_usd_month: t.list_price_usd_month,

    /** The gate. `can('external_signals')` and nothing else. */
    can(feature) { return t.features[feature] === true; },

    /** For a locked panel: the label of the cheapest tier that opens it. */
    upgradeLabel(feature) {
      const req = requiredTier(feature);
      return req ? TIERS[req].label : null;
    },

    accountUsage(used) { return usageOf(used, t.max_accounts); },
    sourceUsage(used) { return usageOf(used, t.max_sources); },
  };
}
