/* ==========================================================================
   OpsPulse — Synthetic Operations Dataset Generator
   --------------------------------------------------------------------------
   Produces 90 days of customer-operations history for a fictional SaaS
   company ("Northwind Cloud"):

       10,000  support tickets      (Kaggle customer_support_tickets.csv schema
                                     + operational fields a real desk carries)
          500  escalations
        1,000  NPS responses
          100  QA reviews
        2,400  accounts · 62 agents · release timeline

   FOUR PATTERNS ARE DELIBERATELY INJECTED. The detection engine is not told
   about them — it has to find them statistically. They are:

     P1  Refund escalation spike   days 80-89, triggered by a refund-policy
                                   change on day 79. Refund volume share
                                   0.09 → 0.26 and the escalation rate inside
                                   that category runs ~3x its own baseline.
                                   Blast radius is pinned to EXACTLY 231
                                   distinct accounts (see REFUND_COHORT) so
                                   "231 customers" is a counted fact.
     P2  New-hire QA decline       a 14-agent cohort onboarded on day 44 scores
                                   ~18 pts below tenured agents, worst on
                                   policy adherence + compliance.
     P3  Onboarding confusion      days 76-89, onboarding-category share
                                   0.12 → 0.22 after the self-serve onboarding
                                   v2 release on day 75.
     P4  Ticket backlog increase   open backlog is modelled explicitly and
                                   ramps ~230 → ~415 over the last 14 days
                                   because inflow rises while throughput does
                                   not. FRT degrades as a FUNCTION of backlog,
                                   so the SLA story stays internally consistent.

   A 5th, EMERGENT pattern falls out of the four: NPS drops ~25 points in the
   recent window, and its detractor verbatims are tagged with the drivers above
   — so "Why did NPS drop?" has an answer that is arithmetic, not narration.
   ========================================================================== */

import { makeRng, allocate } from './rng.js';
import { attachUsage } from './usage.js';
import { attachBilling } from './billing.js';

const DAY_MS = 86400000;
export const DAYS = 90;

/* ── Windows (day indices; day 89 = today) ───────────────────────────────── */
const RECENT_DAYS = 14;                 // analysis window used by the engine
const RECENT_FROM = DAYS - RECENT_DAYS; // 76
const REFUND_SPIKE_FROM = 76;
const ONBOARDING_SURGE_FROM = 76;
const COHORT_START_DAY = 44;
const REFUND_COHORT_SIZE = 231;         // ← the "231 customers" in the demo card

/* ── Reference data ──────────────────────────────────────────────────────── */

export const TEAMS = ['Billing Ops', 'Technical Support', 'Onboarding', 'Retention', 'Trust & Safety'];

export const CATEGORIES = {
  'Billing':          { team: 'Billing Ops',       type: 'Billing inquiry',      base: 0.15, sla: 24, escRate: 0.045 },
  'Refund':           { team: 'Billing Ops',       type: 'Refund request',       base: 0.09, sla: 24, escRate: 0.060 },
  'Technical':        { team: 'Technical Support', type: 'Technical issue',      base: 0.26, sla: 8,  escRate: 0.040 },
  'Integrations':     { team: 'Technical Support', type: 'Technical issue',      base: 0.09, sla: 12, escRate: 0.038 },
  'Account Access':   { team: 'Technical Support', type: 'Technical issue',      base: 0.08, sla: 4,  escRate: 0.055 },
  'Onboarding':       { team: 'Onboarding',        type: 'Product inquiry',      base: 0.12, sla: 24, escRate: 0.022 },
  'Product Feedback': { team: 'Onboarding',        type: 'Product inquiry',      base: 0.07, sla: 48, escRate: 0.010 },
  'Cancellation':     { team: 'Retention',         type: 'Cancellation request', base: 0.09, sla: 12, escRate: 0.075 },
  'Data & Privacy':   { team: 'Trust & Safety',    type: 'Product inquiry',      base: 0.05, sla: 72, escRate: 0.030 },
};
export const CATEGORY_LIST = Object.keys(CATEGORIES);

const PRODUCTS = ['Nimbus CRM', 'Nimbus Analytics', 'Nimbus Inbox', 'Nimbus Billing', 'Nimbus Connect', 'Nimbus Mobile'];
const CHANNELS = { Email: 0.38, Chat: 0.29, Phone: 0.14, 'Web portal': 0.13, 'Social media': 0.06 };
const PLANS = {
  Enterprise: { w: 0.08, arr: [42000, 190000], seats: [180, 2400] },
  Growth:     { w: 0.27, arr: [8000, 26000],   seats: [25, 180] },
  Starter:    { w: 0.65, arr: [900, 4200],     seats: [2, 24] },
};

const FIRST = ['Ava','Liam','Noor','Diego','Mei','Priya','Jonas','Sara','Kofi','Elena','Rahul','Yuki','Omar','Chloe','Tomas','Aisha','Ben','Lucia','Hiro','Nadia','Marco','Freya','Ravi','Ines','Kenji','Zara','Felix','Amara','Pedro','Anna','Ivan','Leila','Simon','Grace','Tariq','Mila','Otto','Rosa','Vikram','Elsa'];
const LAST  = ['Okafor','Nakamura','Silva','Kowalski','Haddad','Fernandez','Lindqvist','Mehta','Dubois','Rossi','Novak','Bergman','Costa','Ahmed','Kim','Weber','Moreau','Petrov','Andersson','Bianchi','Sharma','Larsen','Ferreira','Yilmaz','Hassan','Dvorak','Moretti','Sandoval','Virtanen','Bakker'];
const CO_A  = ['Vertex','Lumen','Ardent','Northgate','Cobalt','Bright','Harbor','Quill','Solstice','Ironwood','Meridian','Fable','Kestrel','Onyx','Pinewood','Aster','Granite','Vela','Corvus','Latitude','Beacon','Halcyon','Juniper','Zephyr'];
const CO_B  = ['Labs','Health','Retail','Logistics','Financial','Media','Systems','Foods','Energy','Studios','Group','Partners','Robotics','Analytics','Textiles','Motors','Insurance','Digital'];
/* CO_A x CO_B yields 432 names for 2,400 accounts, so ~420 names were being
   reused — "Lumen Energy" appeared 15 times at ARR from $1.1K to $160.6K. Two
   rows with the same company name and different ARR read as broken data the
   moment a decision names accounts, so the namespace is widened with legal
   qualifiers (none of which collide with CO_B) and uniqueness is enforced. */
const CO_SUFFIX = ['Holdings', 'International', 'Worldwide', 'Ventures', 'Industries', 'Technologies'];

/* Subject / description templates per category. `tag` is the sub-driver the
   root-cause agent decomposes on — this is where P1/P3 leave their fingerprint. */
const TEMPLATES = {
  'Refund': [
    { tag: 'refund-policy-window', s: 'Refund refused — I am inside the 30-day window', d: 'I requested a refund {n} days after purchase and was told the window is only 14 days. The page I bought from said 30 days.' },
    { tag: 'refund-policy-window', s: 'Policy says 30 days, agent says 14', d: 'Your help centre article still says 30-day refunds. Support quoted 14 days. Which is correct?' },
    { tag: 'refund-status-delay',  s: 'Refund approved but not received', d: 'Refund was approved on {date} and I still have not seen the credit on my statement.' },
    { tag: 'refund-partial',       s: 'Only received a partial refund', d: 'I was charged for {n} seats and refunded for {m}. Please explain the difference.' },
    { tag: 'refund-duplicate',     s: 'Refund for duplicate charge', d: 'I was billed twice this cycle for {product}. Requesting a refund of the duplicate.' },
  ],
  'Billing': [
    { tag: 'invoice-mismatch', s: 'Invoice does not match my plan', d: 'My invoice shows {n} seats but our workspace has {m}. Please correct the invoice.' },
    { tag: 'card-declined',    s: 'Payment failed — card declined', d: 'The renewal payment failed even though the card is valid. Account now shows past due.' },
    { tag: 'proration',        s: 'Proration on mid-cycle upgrade unclear', d: 'We upgraded mid-cycle and the proration line item is not explained anywhere.' },
    { tag: 'tax-vat',          s: 'VAT number not applied to invoice', d: 'Our VAT number is on file but the last {n} invoices were issued with tax applied.' },
  ],
  'Technical': [
    { tag: 'sync-failure',   s: 'Records stopped syncing this morning', d: '{product} stopped syncing at around 04:00. No error shown, records just stop updating.' },
    { tag: 'performance',    s: 'Dashboard extremely slow to load', d: 'Reports take over {n} seconds to render since this week. Was instant before.' },
    { tag: 'export-error',   s: 'CSV export fails with an error', d: 'Exporting more than {n} rows throws an error and produces an empty file.' },
    { tag: 'mobile-crash',   s: 'App crashes on open (Android)', d: 'Nimbus Mobile closes immediately on launch after the latest update.' },
    { tag: 'notifications',  s: 'Not receiving alert notifications', d: 'Alert rules fire in the audit log but no email or push notification is delivered.' },
  ],
  'Integrations': [
    { tag: 'api-401',        s: 'API returning 401 after key rotation', d: 'We rotated the API key and every request now returns 401 despite using the new key.' },
    { tag: 'webhook-drops',  s: 'Webhooks silently dropping events', d: 'Roughly {n}% of webhook deliveries never arrive. No failures reported in the log.' },
    { tag: 'salesforce',     s: 'Salesforce connector disconnects nightly', d: 'The Salesforce connector drops its session overnight and needs manual reauth.' },
    { tag: 'rate-limit',     s: 'Hitting rate limits at low volume', d: 'We are being rate limited at well under the documented {n} req/min ceiling.' },
  ],
  'Account Access': [
    { tag: 'sso-config',   s: 'SSO login loop after IdP change', d: 'Users are stuck in a redirect loop signing in with SAML since our IdP metadata changed.' },
    { tag: 'mfa-lockout',  s: 'Locked out — MFA device replaced', d: 'I replaced my phone and cannot pass MFA. Backup codes are not accepted.' },
    { tag: 'permissions',  s: 'Admin lost access to workspace settings', d: 'Our admin no longer sees workspace settings although the role is unchanged.' },
  ],
  'Onboarding': [
    { tag: 'setup-wizard',   s: 'Setup wizard stalls at step {n}', d: 'The new guided setup will not advance past step {n}. No error, the button just does nothing.' },
    { tag: 'data-import',    s: 'Cannot map fields during import', d: 'The import mapper does not show our custom fields, so onboarding cannot be completed.' },
    { tag: 'getting-started',s: 'Which onboarding path should we use?', d: 'The new self-serve flow and the old checklist give different steps. Which is current?' },
    { tag: 'user-invites',   s: 'Invited users never receive the email', d: 'We invited {n} teammates during onboarding and none received an invitation email.' },
    { tag: 'training',       s: 'Where did the onboarding checklist go?', d: 'The onboarding checklist we were using has disappeared from the workspace.' },
  ],
  'Product Feedback': [
    { tag: 'feature-request', s: 'Request: bulk edit in {product}', d: 'Please consider adding bulk edit. We touch {n} records a week manually.' },
    { tag: 'usability',       s: 'New navigation is hard to learn', d: 'The redesigned navigation hides the reports section. Team keeps getting lost.' },
  ],
  'Cancellation': [
    { tag: 'downgrade',      s: 'Request to downgrade at renewal', d: 'We are reducing from {n} to {m} seats at renewal. Please advise on the process.' },
    { tag: 'churn-competitor', s: 'Cancelling — moving to another vendor', d: 'We have decided not to renew. Please confirm the offboarding steps and data export.' },
    { tag: 'churn-value',    s: 'Not seeing enough value to renew', d: 'Adoption stalled after onboarding and we cannot justify the renewal cost.' },
  ],
  'Data & Privacy': [
    { tag: 'dsar',          s: 'Data subject access request', d: 'Formal DSAR under GDPR Art.15 for all personal data held for {name}.' },
    { tag: 'deletion',      s: 'Right-to-erasure request', d: 'Please erase all personal data for the listed contacts and confirm in writing.' },
    { tag: 'dpa',           s: 'Updated DPA required for procurement', d: 'Our legal team requires a countersigned DPA before the renewal can proceed.' },
    { tag: 'subprocessor',  s: 'Question about subprocessor list', d: 'A new subprocessor appeared in your list. We need details for our records.' },
  ],
};

const RESOLUTIONS = {
  'Refund': ['Refund issued in full', 'Partial refund issued per policy', 'Refund declined — outside policy window', 'Escalated to billing lead, goodwill credit applied'],
  'Billing': ['Invoice corrected and reissued', 'Payment method updated', 'Proration explained, credit applied', 'Tax exemption applied to account'],
  'Technical': ['Fixed by engineering hotfix', 'Workaround provided, bug logged', 'Configuration corrected on account', 'Resolved after service restored'],
  'Integrations': ['Credentials re-issued and verified', 'Connector reauthorised', 'Rate limit raised for account', 'Webhook endpoint reconfigured'],
  'Account Access': ['Access restored', 'MFA reset and verified', 'Role permissions corrected', 'SSO metadata re-uploaded'],
  'Onboarding': ['Guided through setup by CSM', 'Import completed by support', 'Onboarding checklist re-shared', 'Invites resent successfully'],
  'Product Feedback': ['Logged to product backlog', 'Shared with product team'],
  'Cancellation': ['Retention offer accepted', 'Downgrade processed', 'Cancellation processed, data exported'],
  'Data & Privacy': ['DSAR fulfilled within statutory period', 'Data erased and confirmed', 'DPA countersigned and returned'],
};

/* `affects` is what makes event correlation more than "the nearest thing that
   happened" — a release is only a candidate cause for signals in its own
   domain. Two events land a day apart in this timeline precisely so the engine
   has to choose the relevant one, not the recent one. */
export const RELEASES = [
  { day: COHORT_START_DAY, kind: 'org',     label: 'New agent cohort onboarded (14 agents)', affects: ['new_hire', 'quality'] },
  { day: 74,               kind: 'release', label: 'Self-serve onboarding v2 rollout',        affects: ['Onboarding'] },
  { day: 75,               kind: 'policy',  label: 'Refund policy updated — window cut 30d → 14d', affects: ['Refund', 'Billing'] },
  { day: 83,               kind: 'release', label: 'Billing service maintenance window',      affects: ['Billing'] },
];

const NPS_DRIVERS_BASE   = { 'product-bug': 0.28, 'pricing': 0.24, 'wait-time': 0.20, 'feature-gap': 0.18, 'onboarding': 0.10 };
const NPS_DRIVERS_RECENT = { 'refund-policy': 0.34, 'onboarding': 0.24, 'wait-time': 0.22, 'pricing': 0.11, 'product-bug': 0.09 };
const NPS_VERBATIM = {
  'refund-policy': ['The refund window was changed without telling us — that felt dishonest.', 'Got refused a refund that your own help page said I qualified for.', 'Two agents gave me two different refund policies.'],
  'onboarding':    ['Onboarding was confusing — the new wizard contradicts the checklist.', 'We never finished setup; the import step blocked us for a week.', 'Getting started took far longer than promised.'],
  'wait-time':     ['Replies now take days. It used to be hours.', 'Ticket sat unanswered over a weekend.', 'Long waits on every follow-up.'],
  'pricing':       ['Price is high for what we actually use.', 'Renewal quote went up with no added value.'],
  'product-bug':   ['Sync breaks every few weeks.', 'Reports are slow and sometimes wrong.'],
  'feature-gap':   ['Missing bulk editing makes daily work slow.', 'Reporting is not flexible enough for us.'],
};
const NPS_PROMOTER_VERBATIM = ['Support resolves things fast and clearly.', 'The product does exactly what we need.', 'Our CSM is genuinely excellent.', 'Reliable and easy to roll out to the team.', 'Best tool we adopted this year.'];
const NPS_PASSIVE_VERBATIM  = ['Works fine, nothing remarkable.', 'Good product, support is hit and miss.', 'Solid but we are still evaluating alternatives.'];

const QA_DIMENSIONS = ['greeting', 'accuracy', 'empathy', 'policy_adherence', 'resolution', 'compliance'];
const QA_MEANS = {
  tenured:  { greeting: 94, accuracy: 90, empathy: 90, policy_adherence: 89, resolution: 88, compliance: 92 },
  new_hire: { greeting: 88, accuracy: 71, empathy: 82, policy_adherence: 58, resolution: 72, compliance: 63 },
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */

const pad = (n, w) => String(n).padStart(w, '0');
const iso = (ms) => new Date(ms).toISOString();
const round1 = (n) => Math.round(n * 10) / 10;

/** Volume seasonality — Monday peak, weekend trough. */
function weekdayFactor(dowIdx) {
  return [0.50, 1.18, 1.04, 1.00, 1.00, 0.96, 0.55][dowIdx]; // Sun..Sat
}

/** Business-hours-weighted time of day, returned as ms offset into the day. */
function hourOffset(rnd) {
  const h = rnd.weighted([[0,0.6],[1,0.4],[2,0.3],[3,0.3],[4,0.5],[5,1],[6,2],[7,4],[8,7],[9,10],
                          [10,11],[11,10],[12,7],[13,9],[14,10],[15,9],[16,8],[17,6],[18,4],
                          [19,3],[20,2.4],[21,2],[22,1.4],[23,1]]);
  return (Number(h) + rnd()) * 3600000;
}

function fill(tpl, rnd, ctx) {
  return tpl
    .replace(/\{n\}/g, () => String(rnd.int(3, 45)))
    .replace(/\{m\}/g, () => String(rnd.int(1, 12)))
    .replace(/\{product\}/g, () => ctx.product)
    .replace(/\{name\}/g, () => ctx.customer)
    .replace(/\{date\}/g, () => new Date(ctx.created - rnd.int(3, 12) * DAY_MS).toISOString().slice(0, 10));
}

/** Ramp from a→b across [from,to], evaluated at d. Outside the window → a. */
function ramp(d, from, to, a, b) {
  if (d < from) return a;
  const t = Math.min(1, (d - from) / Math.max(1, to - from));
  return a + (b - a) * t;
}

/**
 * Category mix for a given day — where P1 and P3 are injected.
 * Module-scope because the LIVE simulator draws from the same distribution:
 * tickets arriving now must belong to the same world as tickets from an hour
 * ago, or the anomalies would decay as soon as the demo starts running.
 */
function categoryMix(d) {
  const refund = ramp(d, REFUND_SPIKE_FROM, DAYS - 1, CATEGORIES.Refund.base, 0.28);
  const onboarding = ramp(d, ONBOARDING_SURGE_FROM, DAYS - 1, CATEGORIES.Onboarding.base, 0.21);
  const restBase = 1 - CATEGORIES.Refund.base - CATEGORIES.Onboarding.base;
  const restNow = 1 - refund - onboarding;
  const scale = restNow / restBase;
  const mix = [];
  for (const c of CATEGORY_LIST) {
    if (c === 'Refund') mix.push([c, refund]);
    else if (c === 'Onboarding') mix.push([c, onboarding]);
    else mix.push([c, CATEGORIES[c].base * scale]);
  }
  return mix;
}

/* ── The generator ───────────────────────────────────────────────────────── */

/**
 * @param {number} seed
 * @param {number} nowMs  "as of" instant — day 89 is the day containing it
 * @returns {object} dataset
 */
/* ── Contract dates ───────────────────────────────────────────────────────
   renewal_in_days used to be rnd.int(5, 360) — a flat random integer with no
   relationship to anything. That made "my Q3 renewals" meaningless, because
   renewals were uniform noise rather than a calendar.

   Real B2B contracts have a term and close disproportionately at quarter ends,
   so a renewal book is lumpy. Here the purchase date is snapped to a quarter
   end ~70% of the time and the renewal is the next anniversary at the contract
   term, which makes the quarterly distribution uneven the way a real book is.

   DRAW BUDGET: exactly two, the same as before (days-ago, term). The quarter
   snap is derived from the days-ago draw rather than taking a third, because
   adding a draw here shifts every downstream value and silently regenerates
   the world — that regression has already happened once on this branch. */
const QUARTER_END_MONTH = [2, 5, 8, 11];   // Mar, Jun, Sep, Dec (0-indexed)

function purchaseDate(nowMs, daysAgo) {
  const raw = new Date(nowMs - daysAgo * DAY_MS);
  // ~70% of contracts land on a quarter end; derived from the existing draw.
  if (daysAgo % 10 >= 7) return raw;
  const m = raw.getMonth();
  const q = QUARTER_END_MONTH.reduce((best, qm) => (Math.abs(qm - m) < Math.abs(best - m) ? qm : best), QUARTER_END_MONTH[0]);
  const snapped = new Date(raw.getFullYear(), q + 1, 0);   // last day of that month
  return snapped;
}

/** Days from as-of to the next contract anniversary. Always in the future. */
function daysToRenewal(purchasedMs, termMonths, nowMs) {
  const r = new Date(purchasedMs);
  let guard = 0;
  while (r.getTime() <= nowMs && guard++ < 60) r.setMonth(r.getMonth() + termMonths);
  return Math.max(1, Math.round((r.getTime() - nowMs) / DAY_MS));
}

export function generate(seed = 20260724, nowMs = Date.now()) {
  const rnd = makeRng(seed);

  const todayStart = new Date(nowMs);
  todayStart.setHours(0, 0, 0, 0);
  const day0 = todayStart.getTime() - (DAYS - 1) * DAY_MS;
  const dayMs = (d) => day0 + d * DAY_MS;
  const dayDow = (d) => new Date(dayMs(d)).getDay();
  const elapsedToday = Math.max(0.22, (nowMs - todayStart.getTime()) / DAY_MS);

  /* ---- 1. Agents ------------------------------------------------------- */
  const agents = [];
  const AGENT_N = 62, NEW_HIRE_N = 14;
  for (let i = 0; i < AGENT_N; i++) {
    const isNew = i >= AGENT_N - NEW_HIRE_N;
    const team = TEAMS[i % TEAMS.length];
    const tenureDays = isNew
      ? DAYS - COHORT_START_DAY + rnd.int(-4, 4)          // ~46 days on the job
      : rnd.int(210, 2100);
    agents.push({
      agent_id: 'AG' + pad(i + 1, 3),
      name: `${rnd.pick(FIRST)} ${rnd.pick(LAST)}`,
      team,
      role: isNew ? 'Support Agent (new hire)' : rnd.chance(0.15) ? 'Senior Agent' : 'Support Agent',
      cohort: isNew ? 'new_hire' : 'tenured',
      hired_at: iso(nowMs - tenureDays * DAY_MS),
      tenure_days: tenureDays,
      // capacity weight — new hires take fewer tickets
      weight: isNew ? 0.62 : 1,
    });
  }
  const agentsByTeam = {};
  for (const t of TEAMS) agentsByTeam[t] = agents.filter((a) => a.team === t);

  /* ---- 2. Accounts ----------------------------------------------------- */

  /* Unique company names, drawn deterministically. Base combinations first,
     then qualified variants — so the common names stay clean and only the tail
     carries a suffix. */
  const namePool = (() => {
    /* Its OWN rng stream, derived from the seed. Shuffling on the main `rnd`
       consumed 432 draws before accounts were generated and shifted every
       downstream draw — same seed, different world. That silently changed which
       accounts, tickets and NPS responses the generator produced and broke the
       pattern-detection harness on two of five seeds. Deduping names must not
       be able to move the data. */
    const nameRnd = makeRng((seed ^ 0x1d3a7f) >>> 0);
    const base = [];
    for (const a of CO_A) for (const b of CO_B) base.push(`${a} ${b}`);
    nameRnd.shuffle(base);
    const out = base.slice();
    for (const suffix of CO_SUFFIX) for (const n of base) out.push(`${n} ${suffix}`);
    return out;
  })();
  let nameCursor = 0;
  const usedNames = new Set();
  const companyName = () => {
    /* Consume the two draws the original `${rnd.pick(CO_A)} ${rnd.pick(CO_B)}`
       made. Uniqueness must not move the RNG sequence: removing these two draws
       per account shifted every subsequent value and produced a different world
       from the same seed, which broke pattern detection on two of five seeds. */
    rnd.pick(CO_A); rnd.pick(CO_B);
    while (nameCursor < namePool.length) {
      const n = namePool[nameCursor++];
      if (!usedNames.has(n)) { usedNames.add(n); return n; }
    }
    // Pool exhausted — should not happen at 2,400 accounts, but never collide.
    let n, i = 2;
    do { n = `${namePool[0]} ${i++}`; } while (usedNames.has(n));
    usedNames.add(n); return n;
  };
  const accounts = [];
  const ACCOUNT_N = 2400;
  for (let i = 0; i < ACCOUNT_N; i++) {
    const plan = rnd.weighted(Object.entries(PLANS).map(([k, v]) => [k, v.w]));
    const cfg = PLANS[plan];
    const contact = `${rnd.pick(FIRST)} ${rnd.pick(LAST)}`;
    const company = companyName();
    accounts.push({
      account_id: 'AC' + pad(i + 1, 4),
      company,
      plan,
      arr_usd: Math.round(rnd.range(cfg.arr[0], cfg.arr[1]) / 100) * 100,
      seats: rnd.int(cfg.seats[0], cfg.seats[1]),
      region: rnd.weighted({ 'North America': 0.44, EMEA: 0.31, APAC: 0.17, LATAM: 0.08 }),
      contact_name: contact,
      contact_email: `${contact.split(' ')[0].toLowerCase()}.${contact.split(' ')[1].toLowerCase()}@${company.split(' ')[0].toLowerCase()}.com`,
      customer_age: rnd.int(22, 64),
      customer_gender: rnd.weighted({ Female: 0.47, Male: 0.47, 'Non-binary': 0.03, 'Prefer not to say': 0.03 }),
      product: rnd.pick(PRODUCTS),
      ...(() => {
        const daysAgo = rnd.int(35, 1400);                                    // draw 1 (was: purchased_at)
        const termMonths = rnd.weighted({ 12: 0.62, 24: 0.26, 36: 0.12 });    // draw 2 (was: renewal_in_days)
        const purchased = purchaseDate(nowMs, daysAgo);
        return {
          purchased_at: iso(purchased.getTime()),
          term_months: Number(termMonths),
          renewal_in_days: daysToRenewal(purchased.getTime(), Number(termMonths), nowMs),
        };
      })(),
      csm: rnd.pick(agents).name,
    });
  }
  const accountById = new Map(accounts.map((a) => [a.account_id, a]));

  /* P1 blast radius: exactly 231 accounts carry the refund-policy fallout.
     Weighted toward paying plans, because that is who reads a refund policy. */
  const refundPool = rnd
    .shuffle(accounts.filter((a) => a.plan !== 'Starter' || rnd.chance(0.45)).slice())
    .slice(0, REFUND_COHORT_SIZE);
  const refundCohortIds = refundPool.map((a) => a.account_id);

  /* ---- 3. Daily inflow plan ------------------------------------------- */
  // Volume rises in the recent window because refund + onboarding demand rises;
  // every other category holds roughly flat in absolute terms.
  const dayWeights = [];
  for (let d = 0; d < DAYS; d++) {
    // 1.46x at peak is exactly the multiplier that keeps every OTHER category
    // flat in absolute terms while refund+onboarding grow 0.21 → 0.49 of mix.
    const trend = ramp(d, RECENT_FROM, DAYS - 1, 1.0, 1.46);
    let w = weekdayFactor(dayDow(d)) * trend * rnd.range(0.94, 1.06);
    if (d === DAYS - 1) w *= elapsedToday;                 // today is partial
    dayWeights.push(w);
  }
  const TOTAL_TICKETS = 10000;
  const inflow = allocate(TOTAL_TICKETS, dayWeights);

  /* ---- 4. Tickets ------------------------------------------------------ */
  const tickets = [];
  let tid = 0;

  for (let d = 0; d < DAYS; d++) {
    const mix = categoryMix(d);
    const inSpike = d >= REFUND_SPIKE_FROM;
    for (let k = 0; k < inflow[d]; k++) {
      const category = rnd.weighted(mix);
      const cfg = CATEGORIES[category];

      // P1: every refund ticket inside the spike window belongs to the cohort,
      // so "distinct customers affected" is exactly REFUND_COHORT_SIZE.
      const acct = (inSpike && category === 'Refund')
        ? accountById.get(rnd.pick(refundCohortIds))
        : rnd.pick(accounts);

      const pool = agentsByTeam[cfg.team];
      const agent = rnd.weighted(pool.map((a) => [a.agent_id, a.weight]));

      const created = dayMs(d) + hourOffset(rnd) * (d === DAYS - 1 ? elapsedToday : 1);
      // Causal honesty: nobody complains about a policy change or a new setup
      // wizard BEFORE it ships. Pre-release those tags are a rare trickle, so
      // the root-cause decomposition finds a real fingerprint rather than one
      // that was always there.
      let tplPool = TEMPLATES[category];
      if (category === 'Refund' && d < REFUND_SPIKE_FROM && !rnd.chance(0.06)) {
        tplPool = tplPool.filter((x) => x.tag !== 'refund-policy-window');
      }
      if (category === 'Onboarding' && d < ONBOARDING_SURGE_FROM && !rnd.chance(0.10)) {
        tplPool = tplPool.filter((x) => x.tag !== 'getting-started' && x.tag !== 'setup-wizard');
      }
      const tpl = rnd.pick(tplPool);
      const ctx = { product: acct.product, customer: acct.contact_name, created };

      const priority = rnd.weighted(
        category === 'Account Access' ? { Critical: 0.12, High: 0.38, Medium: 0.38, Low: 0.12 }
        : category === 'Cancellation' ? { Critical: 0.08, High: 0.42, Medium: 0.38, Low: 0.12 }
        : category === 'Refund'       ? { Critical: 0.04, High: 0.30, Medium: 0.50, Low: 0.16 }
        : category === 'Technical'    ? { Critical: 0.07, High: 0.31, Medium: 0.44, Low: 0.18 }
        :                               { Critical: 0.02, High: 0.20, Medium: 0.52, Low: 0.26 }
      );

      tickets.push({
        // ── Kaggle customer_support_tickets.csv fields ──
        ticket_id: 'TK' + pad(++tid, 5),
        customer_name: acct.contact_name,
        customer_email: acct.contact_email,
        customer_age: acct.customer_age,
        customer_gender: acct.customer_gender,
        product_purchased: acct.product,
        date_of_purchase: acct.purchased_at.slice(0, 10),
        ticket_type: cfg.type,
        ticket_subject: fill(tpl.s, rnd, ctx),
        ticket_description: fill(tpl.d, rnd, ctx),
        ticket_status: 'Open',                 // resolved in the backlog pass
        resolution: '',
        ticket_priority: priority,
        ticket_channel: rnd.weighted(CHANNELS),
        first_response_time_min: null,         // derived from backlog pressure
        time_to_resolution_hrs: null,
        customer_satisfaction_rating: null,
        // ── Operational fields a real desk carries ──
        account_id: acct.account_id,
        company: acct.company,
        plan: acct.plan,
        arr_usd: acct.arr_usd,
        region: acct.region,
        agent_id: agent,
        team: cfg.team,
        category,
        tag: tpl.tag,
        created_at: created,
        day_index: d,
        resolved_at: null,
        sla_target_hrs: cfg.sla * (priority === 'Critical' ? 0.35 : priority === 'High' ? 0.6 : priority === 'Low' ? 1.6 : 1),
        sla_breached: false,
        escalated: false,
        escalation_id: null,
        reopened: false,
      });
    }
  }

  /* P1 blast radius, made exact.
     The mix above produces the refund surge; this pass pins WHO it lands on.
     The first REFUND_COHORT_SIZE surge tickets each get a distinct cohort
     account, the remainder repeat within the cohort — so "distinct customers
     affected" counted off the data is exactly 231, never 229 or 236. */
  function applyAccount(t, acct) {
    t.account_id = acct.account_id;
    t.company = acct.company;
    t.plan = acct.plan;
    t.arr_usd = acct.arr_usd;
    t.region = acct.region;
    t.customer_name = acct.contact_name;
    t.customer_email = acct.contact_email;
    t.customer_age = acct.customer_age;
    t.customer_gender = acct.customer_gender;
    t.product_purchased = acct.product;
    t.date_of_purchase = acct.purchased_at.slice(0, 10);
  }
  {
    const surge = rnd.shuffle(tickets.filter((t) => t.category === 'Refund' && t.day_index >= REFUND_SPIKE_FROM));
    if (surge.length < REFUND_COHORT_SIZE) {
      // Safety net: promote the newest non-refund billing tickets so the blast
      // radius is always reachable, whatever the seed did to the day mix.
      const spare = tickets
        .filter((t) => t.day_index >= REFUND_SPIKE_FROM && t.category === 'Billing')
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, REFUND_COHORT_SIZE - surge.length);
      for (const t of spare) {
        t.category = 'Refund';
        t.ticket_type = CATEGORIES.Refund.type;
        t.team = CATEGORIES.Refund.team;
        t.sla_target_hrs = CATEGORIES.Refund.sla;
        const tpl = rnd.pick(TEMPLATES.Refund);
        t.tag = tpl.tag;
        t.ticket_subject = fill(tpl.s, rnd, { product: t.product_purchased, customer: t.customer_name, created: t.created_at });
        t.ticket_description = fill(tpl.d, rnd, { product: t.product_purchased, customer: t.customer_name, created: t.created_at });
        surge.push(t);
      }
    }
    surge.forEach((t, i) => {
      applyAccount(t, i < REFUND_COHORT_SIZE ? refundPool[i] : refundPool[rnd.int(0, REFUND_COHORT_SIZE - 1)]);
      // The policy change is the story: bias the surge toward policy-window tags.
      if (rnd.chance(0.58)) {
        const tpl = TEMPLATES.Refund.find((x) => x.tag === 'refund-policy-window');
        t.tag = tpl.tag;
        t.ticket_subject = fill(tpl.s, rnd, { product: t.product_purchased, customer: t.customer_name, created: t.created_at });
        t.ticket_description = fill(tpl.d, rnd, { product: t.product_purchased, customer: t.customer_name, created: t.created_at });
      }
    });
  }

  /* ---- 5. Backlog model (P4) ------------------------------------------
     Backlog is the modelled quantity and throughput is derived from it, so the
     open-queue curve is exact and every downstream number (FRT, SLA, age) is a
     consequence of it rather than an independent invention.                */
  const backlogTarget = [];
  for (let d = 0; d < DAYS; d++) {
    const base = ramp(d, RECENT_FROM, DAYS - 1, 230, 415);
    backlogTarget.push(Math.max(60, Math.round(base + rnd.normal(0, 16))));
  }

  const byDay = Array.from({ length: DAYS }, () => []);
  for (const t of tickets) byDay[t.day_index].push(t);

  const agentById = new Map(agents.map((a) => [a.agent_id, a]));
  const PRIO_RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  let queue = [];
  const backlog = [];
  const throughput = [];

  for (let d = 0; d < DAYS; d++) {
    queue = queue.concat(byDay[d]);
    const prev = d === 0 ? 0 : backlog[d - 1];
    let toResolve = Math.round(prev + inflow[d] - backlogTarget[d]);
    toResolve = Math.max(0, Math.min(queue.length, toResolve));

    // Work order: priority first, then oldest — how a real queue actually drains.
    queue.sort((a, b) => (PRIO_RANK[a.ticket_priority] - PRIO_RANK[b.ticket_priority]) || (a.created_at - b.created_at));
    const resolvedToday = queue.splice(0, toResolve);
    throughput.push(resolvedToday.length);

    for (const t of resolvedToday) {
      const dayEnd = Math.min(nowMs, dayMs(d) + DAY_MS - 1);
      let res = Math.max(t.created_at + rnd.range(0.4, 3) * 3600000, dayMs(d) + hourOffset(rnd));
      res = Math.min(res, dayEnd);
      if (res <= t.created_at) res = Math.min(t.created_at + 1800000, dayEnd);
      t.resolved_at = res;
      t.time_to_resolution_hrs = round1((res - t.created_at) / 3600000);
      t.ticket_status = rnd.chance(0.72) ? 'Closed' : 'Resolved';
      t.resolution = rnd.pick(RESOLUTIONS[t.category]);
      // Reopens are the mechanism by which a QA gap becomes a cost: work that
      // was not right the first time comes back and is paid for twice.
      const newHire = agentById.get(t.agent_id)?.cohort === 'new_hire';
      t.reopened = rnd.chance((t.category === 'Refund' && d >= REFUND_SPIKE_FROM ? 0.17 : 0.055) + (newHire ? 0.075 : 0));
    }
    backlog.push(queue.length);
  }
  // Whatever is still queued at the end is the live open backlog.
  for (const t of queue) {
    t.ticket_status = rnd.chance(0.34) ? 'Pending Customer Response' : 'Open';
  }

  /* First response time is a FUNCTION of that day's backlog pressure — that is
     why SLA degrades in the surge without being separately fabricated. */
  const FRT_TARGET = { Critical: 15, High: 60, Medium: 240, Low: 480 };
  for (const t of tickets) {
    const pressure = backlog[t.day_index] / 230;
    const median = 34 * (t.ticket_priority === 'Critical' ? 0.35 : t.ticket_priority === 'High' ? 0.6 : 1);
    t.first_response_time_min = Math.max(2, Math.round(rnd.logNormal(median, 0.62) * (0.55 + 0.75 * pressure)));

    const ageHrs = ((t.resolved_at ?? nowMs) - t.created_at) / 3600000;
    t.sla_breached = ageHrs > t.sla_target_hrs;
    // First-response SLA — the metric a support lead is actually measured on,
    // and the one that degrades cleanly with queue pressure. Resolution SLA is
    // reported per-category by the engine because it is mix-sensitive.
    t.frt_sla_target_min = FRT_TARGET[t.ticket_priority];
    t.frt_sla_breached = t.first_response_time_min > t.frt_sla_target_min;
  }

  /* ---- 6. Escalations (exactly 500) ------------------------------------ */
  const escalations = [];
  const ESC_TOTAL = 500;

  const spikeRefund = tickets.filter((t) => t.category === 'Refund' && t.day_index >= REFUND_SPIKE_FROM);
  // ~3.2x the category's own 6% baseline → detector sees a real rate anomaly.
  const spikeEscN = Math.round(spikeRefund.length * CATEGORIES.Refund.escRate * 3.2);
  const spikePicks = rnd.sample(spikeRefund, Math.min(spikeEscN, spikeRefund.length));

  const others = tickets.filter((t) => !(t.category === 'Refund' && t.day_index >= REFUND_SPIKE_FROM));
  const otherWeights = others.map((t) => {
    const p = CATEGORIES[t.category].escRate;
    const prio = t.ticket_priority === 'Critical' ? 3.4 : t.ticket_priority === 'High' ? 1.9 : t.ticket_priority === 'Low' ? 0.35 : 1;
    const breach = t.sla_breached ? 1.7 : 1;
    return p * prio * breach;
  });
  // Weighted sampling without replacement, to an exact count.
  const otherPicks = [];
  {
    const idx = others.map((_, i) => i);
    const keys = idx.map((i) => Math.pow(rnd(), 1 / Math.max(1e-9, otherWeights[i]))); // Efraimidis–Spirakis
    idx.sort((a, b) => keys[b] - keys[a]);
    const want = ESC_TOTAL - spikePicks.length;
    for (let i = 0; i < want && i < idx.length; i++) otherPicks.push(others[idx[i]]);
  }

  const ESC_REASONS = {
    'Refund': ['Policy dispute — customer quoting superseded 30-day terms', 'Repeat contact on unresolved refund', 'Customer threatened public complaint over refund refusal'],
    'Billing': ['Billing error above approval threshold', 'Account past due — service suspension risk'],
    'Technical': ['Business-critical outage for customer', 'Repeat regression after fix'],
    'Integrations': ['Production integration down', 'Data loss risk during sync failure'],
    'Account Access': ['Full workspace lockout', 'Admin access loss blocking operations'],
    'Onboarding': ['Onboarding blocked past contracted go-live', 'Implementation at risk of stalling'],
    'Product Feedback': ['Executive-sponsored feature commitment'],
    'Cancellation': ['At-risk renewal — retention required', 'Cancellation with contractual dispute'],
    'Data & Privacy': ['Regulatory deadline approaching', 'Erasure request unconfirmed past SLA'],
  };
  let eid = 0;
  for (const t of rnd.shuffle(spikePicks.concat(otherPicks))) {
    const openedAt = t.created_at + rnd.range(1, 26) * 3600000;
    const sev = t.ticket_priority === 'Critical' ? 'P1' : t.ticket_priority === 'High' ? rnd.pick(['P1', 'P2']) : rnd.pick(['P2', 'P3']);
    const closed = t.resolved_at != null && rnd.chance(0.82);
    const e = {
      escalation_id: 'ESC' + pad(++eid, 4),
      ticket_id: t.ticket_id,
      account_id: t.account_id,
      company: t.company,
      plan: t.plan,
      arr_usd: t.arr_usd,
      category: t.category,
      team: t.team,
      tag: t.tag,
      severity: sev,
      reason: rnd.pick(ESC_REASONS[t.category]),
      opened_at: Math.min(openedAt, nowMs),
      day_index: t.day_index,
      owner: rnd.pick(agents.filter((a) => a.cohort === 'tenured')).name,
      status: closed ? 'Closed' : rnd.chance(0.45) ? 'Mitigating' : 'Open',
      resolved_at: closed ? t.resolved_at : null,
      response_sla_hrs: sev === 'P1' ? 1 : sev === 'P2' ? 4 : 12,
    };
    e.age_hrs = round1(((e.resolved_at ?? nowMs) - e.opened_at) / 3600000);
    e.sla_breached = e.status !== 'Closed' && e.age_hrs > e.response_sla_hrs * 6;
    escalations.push(e);
    t.escalated = true;
    t.escalation_id = e.escalation_id;
  }
  escalations.sort((a, b) => a.opened_at - b.opened_at);

  /* ---- 7. CSAT on resolved tickets ------------------------------------- */
  for (const t of tickets) {
    if (!t.resolved_at || !rnd.chance(0.36)) continue;
    let base = 4.35;
    if (t.sla_breached) base -= 1.15;
    if (t.escalated) base -= 0.95;
    if (t.reopened) base -= 0.7;
    if (agentById.get(t.agent_id)?.cohort === 'new_hire') base -= 0.45;
    if (t.category === 'Refund' && t.day_index >= REFUND_SPIKE_FROM) base -= 0.6;
    if (t.category === 'Onboarding' && t.day_index >= ONBOARDING_SURGE_FROM) base -= 0.4;
    t.customer_satisfaction_rating = Math.max(1, Math.min(5, Math.round(rnd.normal(base, 0.85))));
  }

  /* ---- 8. QA reviews (P2) ---------------------------------------------- */
  const qa = [];
  const QA_TOTAL = 100, QA_NEW_HIRE = 38;
  const newHires = agents.filter((a) => a.cohort === 'new_hire');
  const tenured = agents.filter((a) => a.cohort === 'tenured');
  const reviewers = rnd.sample(tenured.filter((a) => a.role === 'Senior Agent').concat(tenured.slice(0, 6)), 6);

  for (let i = 0; i < QA_TOTAL; i++) {
    const isNew = i < QA_NEW_HIRE;
    const agent = isNew ? rnd.pick(newHires) : rnd.pick(tenured);
    // New-hire reviews can only exist after the cohort started.
    const d = isNew ? rnd.int(COHORT_START_DAY + 4, DAYS - 1) : rnd.int(2, DAYS - 1);
    const pool = tickets.filter((t) => t.agent_id === agent.agent_id && Math.abs(t.day_index - d) <= 3);
    const t = pool.length ? rnd.pick(pool) : rnd.pick(tickets.filter((x) => x.agent_id === agent.agent_id)) || rnd.pick(tickets);
    const means = QA_MEANS[agent.cohort];
    const dims = {};
    for (const k of QA_DIMENSIONS) dims[k] = Math.round(rnd.normalClamped(means[k], 7, 25, 100));
    const overall = Math.round(QA_DIMENSIONS.reduce((s, k) => s + dims[k], 0) / QA_DIMENSIONS.length);
    const flags = [];
    if (dims.compliance < 70) flags.push('compliance-risk');
    if (dims.policy_adherence < 70) flags.push('policy-deviation');
    if (dims.accuracy < 70) flags.push('incorrect-information');
    qa.push({
      qa_id: 'QA' + pad(i + 1, 3),
      reviewed_at: dayMs(d) + hourOffset(rnd),
      day_index: d,
      agent_id: agent.agent_id,
      agent_name: agent.name,
      team: agent.team,
      cohort: agent.cohort,
      tenure_days: agent.tenure_days,
      reviewer: rnd.pick(reviewers).name,
      ticket_id: t ? t.ticket_id : null,
      category: t ? t.category : 'Technical',
      overall_score: overall,
      dimensions: dims,
      flags,
      note: dims.policy_adherence < 70
        ? 'Quoted the superseded refund window; did not check the current policy article.'
        : dims.accuracy < 75
        ? 'Gave a partially incorrect configuration step; customer had to re-contact.'
        : 'Solid handling — clear, accurate, well closed.',
    });
  }
  qa.sort((a, b) => a.reviewed_at - b.reviewed_at);

  /* ---- 9. NPS responses (1,000) ---------------------------------------- */
  const nps = [];
  const NPS_TOTAL = 1000;
  const npsWeights = dayWeights.map((w, d) => w * (d >= RECENT_FROM ? 1.05 : 1));
  const npsPerDay = allocate(NPS_TOTAL, npsWeights);
  const ticketsByAccount = new Map();
  for (const t of tickets) {
    if (!ticketsByAccount.has(t.account_id)) ticketsByAccount.set(t.account_id, []);
    ticketsByAccount.get(t.account_id).push(t);
  }

  let nid = 0;
  for (let d = 0; d < DAYS; d++) {
    const recent = d >= RECENT_FROM;
    // Recent window: promoters 55%→40%, detractors 20%→34%.
    // The end of the ramp is deliberately not steeper: with ~190 responses in
    // the window the sampling error on NPS is around ±10 points, so a harsher
    // ramp produces occasional negative-NPS draws that read as a broken demo
    // rather than a bad quarter. This lands the drop at roughly 18 points on
    // every seed and every calendar position.
    const mix = recent
      ? { promoter: ramp(d, RECENT_FROM, DAYS - 1, 0.53, 0.40), passive: 0.26, detractor: 0 }
      : { promoter: 0.55, passive: 0.25, detractor: 0.20 };
    mix.detractor = 1 - mix.promoter - mix.passive;

    for (let k = 0; k < npsPerDay[d]; k++) {
      const seg = rnd.weighted(mix);
      const acct = rnd.pick(accounts);
      const hist = ticketsByAccount.get(acct.account_id) || [];
      const last = hist.length ? hist[hist.length - 1] : null;
      const score = seg === 'promoter' ? rnd.int(9, 10) : seg === 'passive' ? rnd.int(7, 8) : rnd.weighted({ 0: 0.06, 1: 0.05, 2: 0.07, 3: 0.11, 4: 0.14, 5: 0.2, 6: 0.37 });
      const driver = seg === 'detractor' ? rnd.weighted(recent ? NPS_DRIVERS_RECENT : NPS_DRIVERS_BASE) : null;
      nps.push({
        response_id: 'NPS' + pad(++nid, 4),
        submitted_at: dayMs(d) + hourOffset(rnd) * (d === DAYS - 1 ? elapsedToday : 1),
        day_index: d,
        account_id: acct.account_id,
        company: acct.company,
        plan: acct.plan,
        arr_usd: acct.arr_usd,
        region: acct.region,
        contact_name: acct.contact_name,
        score: Number(score),
        segment: seg,
        driver_tag: driver,
        verbatim: seg === 'promoter' ? rnd.pick(NPS_PROMOTER_VERBATIM)
                : seg === 'passive'  ? rnd.pick(NPS_PASSIVE_VERBATIM)
                : rnd.pick(NPS_VERBATIM[driver]),
        last_ticket_id: last ? last.ticket_id : null,
      });
    }
  }

  /* ---- 10. Compliance clock on privacy tickets ------------------------- */
  for (const t of tickets) {
    if (t.category !== 'Data & Privacy') continue;
    if (t.tag === 'dsar' || t.tag === 'deletion') {
      t.regulatory_due_at = t.created_at + 30 * DAY_MS;
      t.regulatory_breached = !t.resolved_at && nowMs > t.regulatory_due_at;
      t.regulatory_days_left = Math.round((t.regulatory_due_at - nowMs) / DAY_MS);
    }
  }

  tickets.sort((a, b) => a.created_at - b.created_at);

  const ds = {
    meta: {
      seed,
      as_of: nowMs,
      generated_at: iso(nowMs),
      days: DAYS,
      day0,
      recent_from: RECENT_FROM,
      recent_days: RECENT_DAYS,
      org: 'Northwind Cloud',
      source: 'synthetic · Kaggle customer_support_tickets.csv schema',
      releases: RELEASES.map((r) => ({ ...r, at: dayMs(r.day) })),
      // The live simulator draws refund tickets from the same cohort, so the
      // blast radius stays a stable, counted 231 while the demo is running.
      refund_cohort_ids: refundCohortIds,
      next_ticket_seq: tid,
      next_escalation_seq: eid,
      next_nps_seq: nid,
      next_qa_seq: QA_TOTAL,
      series: { inflow, backlog, throughput, backlog_target: backlogTarget },
      counts: {
        tickets: tickets.length,
        escalations: escalations.length,
        nps: nps.length,
        qa: qa.length,
        accounts: accounts.length,
        agents: agents.length,
      },
    },
    agents,
    accounts,
    tickets,
    escalations,
    nps,
    qa,
  };

  /* Product usage, attached last: it is shaped against each account's real
     ticket and escalation history, which only exists by this point. */
  attachUsage(ds);

  /* Billing terms, which turn a renewal date into an effective churn date. */
  attachBilling(ds);

  return ds;
}

/* ==========================================================================
   LIVE EVENT FACTORIES
   --------------------------------------------------------------------------
   The simulator that keeps the demo moving draws from the SAME distributions
   as day 89 of the history above. That matters: if live traffic were uniform,
   every injected pattern would decay the moment you opened the app, and the
   dashboard would quietly stop being true while you watched it.
   ========================================================================== */

const FRT_TARGET_MIN = { Critical: 15, High: 60, Medium: 240, Low: 480 };

/** A newly arriving ticket, consistent with today's mix. Mutates `ds`. */
export function makeLiveTicket(ds, rnd, atMs) {
  const d = DAYS - 1;
  const category = rnd.weighted(categoryMix(d));
  const cfg = CATEGORIES[category];
  // Draw the id ONCE — calling rnd.pick inside the predicate would redraw on
  // every comparison and almost never match.
  const cohortId = rnd.pick(ds.meta.refund_cohort_ids);
  const acct = category === 'Refund'
    ? (ds.accounts.find((a) => a.account_id === cohortId) || rnd.pick(ds.accounts))
    : rnd.pick(ds.accounts);

  const pool = ds.agents.filter((a) => a.team === cfg.team);
  const agent = rnd.weighted(pool.map((a) => [a.agent_id, a.weight]));
  const tpl = category === 'Refund' && rnd.chance(0.58)
    ? TEMPLATES.Refund.find((x) => x.tag === 'refund-policy-window')
    : rnd.pick(TEMPLATES[category]);
  const ctx = { product: acct.product, customer: acct.contact_name, created: atMs };

  const priority = rnd.weighted(
    category === 'Account Access' ? { Critical: 0.12, High: 0.38, Medium: 0.38, Low: 0.12 }
    : category === 'Cancellation' ? { Critical: 0.08, High: 0.42, Medium: 0.38, Low: 0.12 }
    : category === 'Refund'       ? { Critical: 0.04, High: 0.30, Medium: 0.50, Low: 0.16 }
    : category === 'Technical'    ? { Critical: 0.07, High: 0.31, Medium: 0.44, Low: 0.18 }
    :                               { Critical: 0.02, High: 0.20, Medium: 0.52, Low: 0.26 });

  const pressure = (ds.meta.series.backlog[d] || 230) / 230;
  const frtMedian = 34 * (priority === 'Critical' ? 0.35 : priority === 'High' ? 0.6 : 1);
  const frt = Math.max(2, Math.round(rnd.logNormal(frtMedian, 0.62) * (0.55 + 0.75 * pressure)));

  const t = {
    ticket_id: 'TK' + pad(++ds.meta.next_ticket_seq, 5),
    customer_name: acct.contact_name, customer_email: acct.contact_email,
    customer_age: acct.customer_age, customer_gender: acct.customer_gender,
    product_purchased: acct.product, date_of_purchase: acct.purchased_at.slice(0, 10),
    ticket_type: cfg.type,
    ticket_subject: fill(tpl.s, rnd, ctx),
    ticket_description: fill(tpl.d, rnd, ctx),
    ticket_status: 'Open', resolution: '',
    ticket_priority: priority,
    ticket_channel: rnd.weighted(CHANNELS),
    first_response_time_min: frt,
    time_to_resolution_hrs: null,
    customer_satisfaction_rating: null,
    account_id: acct.account_id, company: acct.company, plan: acct.plan,
    arr_usd: acct.arr_usd, region: acct.region,
    agent_id: agent, team: cfg.team, category, tag: tpl.tag,
    created_at: atMs, day_index: d, resolved_at: null,
    sla_target_hrs: cfg.sla * (priority === 'Critical' ? 0.35 : priority === 'High' ? 0.6 : priority === 'Low' ? 1.6 : 1),
    sla_breached: false, escalated: false, escalation_id: null, reopened: false,
    frt_sla_target_min: FRT_TARGET_MIN[priority],
    frt_sla_breached: frt > FRT_TARGET_MIN[priority],
    is_live: true,
  };
  if (category === 'Data & Privacy' && (tpl.tag === 'dsar' || tpl.tag === 'deletion')) {
    t.regulatory_due_at = atMs + 30 * DAY_MS;
    t.regulatory_breached = false;
    t.regulatory_days_left = 30;
  }
  return t;
}

/** Resolve an open ticket the way the queue actually drains: priority, then age. */
export function resolveLiveTicket(ds, rnd, atMs) {
  const rank = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  const open = ds.tickets.filter((t) => !t.resolved_at);
  if (!open.length) return null;
  const head = open
    .sort((a, b) => (rank[a.ticket_priority] - rank[b.ticket_priority]) || (a.created_at - b.created_at))
    .slice(0, 25);
  const t = rnd.pick(head);
  t.resolved_at = atMs;
  t.time_to_resolution_hrs = Math.round(((atMs - t.created_at) / 3600000) * 10) / 10;
  t.ticket_status = rnd.chance(0.72) ? 'Closed' : 'Resolved';
  t.resolution = rnd.pick(RESOLUTIONS[t.category] || ['Resolved by support']);
  t.sla_breached = t.time_to_resolution_hrs > t.sla_target_hrs;
  const newHire = ds.agents.find((a) => a.agent_id === t.agent_id)?.cohort === 'new_hire';
  t.reopened = rnd.chance(0.055 + (newHire ? 0.075 : 0));
  if (rnd.chance(0.36)) {
    let base = 4.35;
    if (t.sla_breached) base -= 1.15;
    if (t.escalated) base -= 0.95;
    if (newHire) base -= 0.45;
    if (t.category === 'Refund') base -= 0.6;
    t.customer_satisfaction_rating = Math.max(1, Math.min(5, Math.round(rnd.normal(base, 0.85))));
  }
  return t;
}

/** Escalate an open ticket, at that category's CURRENT (elevated) rate. */
export function makeLiveEscalation(ds, rnd, atMs) {
  const candidates = ds.tickets.filter((t) => !t.resolved_at && !t.escalated && t.day_index >= DAYS - 3);
  if (!candidates.length) return null;
  // Uploaded rows can carry categories this generator never defined, so every
  // lookup against CATEGORIES / RESOLUTIONS here has to tolerate a miss. A live
  // simulator that throws on a user's CSV would take the whole demo down.
  const weights = candidates.map((t) => {
    const spike = t.category === 'Refund' ? 3.2 : 1;
    const prio = t.ticket_priority === 'Critical' ? 3.4 : t.ticket_priority === 'High' ? 1.9 : t.ticket_priority === 'Low' ? 0.35 : 1;
    return (CATEGORIES[t.category]?.escRate ?? 0.03) * spike * prio;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rnd() * total, pick = candidates[0];
  for (let i = 0; i < candidates.length; i++) { r -= weights[i]; if (r <= 0) { pick = candidates[i]; break; } }

  const sev = pick.ticket_priority === 'Critical' ? 'P1' : pick.ticket_priority === 'High' ? rnd.pick(['P1', 'P2']) : rnd.pick(['P2', 'P3']);
  const e = {
    escalation_id: 'ESC' + pad(++ds.meta.next_escalation_seq, 4),
    ticket_id: pick.ticket_id, account_id: pick.account_id, company: pick.company,
    plan: pick.plan, arr_usd: pick.arr_usd, category: pick.category, team: pick.team, tag: pick.tag,
    severity: sev,
    reason: pick.category === 'Refund'
      ? 'Policy dispute — customer quoting superseded 30-day terms'
      : `Escalated from ${pick.category.toLowerCase()} — ${pick.ticket_priority.toLowerCase()} priority`,
    opened_at: atMs, day_index: DAYS - 1,
    owner: rnd.pick(ds.agents.filter((a) => a.cohort === 'tenured')).name,
    status: 'Open', resolved_at: null,
    response_sla_hrs: sev === 'P1' ? 1 : sev === 'P2' ? 4 : 12,
    age_hrs: 0, sla_breached: false, is_live: true,
  };
  pick.escalated = true;
  pick.escalation_id = e.escalation_id;
  return { escalation: e, ticket: pick };
}

/** A survey response, drawn from the CURRENT (depressed) sentiment mix. */
export function makeLiveNps(ds, rnd, atMs) {
  const seg = rnd.weighted({ promoter: 0.40, passive: 0.26, detractor: 0.34 });
  const acct = rnd.pick(ds.accounts);
  const score = seg === 'promoter' ? rnd.int(9, 10) : seg === 'passive' ? rnd.int(7, 8)
    : Number(rnd.weighted({ 0: 0.06, 1: 0.05, 2: 0.07, 3: 0.11, 4: 0.14, 5: 0.2, 6: 0.37 }));
  const driver = seg === 'detractor' ? rnd.weighted(NPS_DRIVERS_RECENT) : null;
  return {
    response_id: 'NPS' + pad(++ds.meta.next_nps_seq, 4),
    submitted_at: atMs, day_index: DAYS - 1,
    account_id: acct.account_id, company: acct.company, plan: acct.plan,
    arr_usd: acct.arr_usd, region: acct.region, contact_name: acct.contact_name,
    score, segment: seg, driver_tag: driver,
    verbatim: seg === 'promoter' ? rnd.pick(NPS_PROMOTER_VERBATIM)
            : seg === 'passive' ? rnd.pick(NPS_PASSIVE_VERBATIM)
            : rnd.pick(NPS_VERBATIM[driver]),
    last_ticket_id: null, is_live: true,
  };
}

/** A QA review — cohort-weighted so the coaching gap keeps being observable. */
export function makeLiveQa(ds, rnd, atMs) {
  const cohort = rnd.chance(0.38) ? 'new_hire' : 'tenured';
  const pool = ds.agents.filter((a) => a.cohort === cohort);
  const agent = rnd.pick(pool);
  const t = ds.tickets.filter((x) => x.agent_id === agent.agent_id).slice(-40);
  const means = QA_MEANS[cohort];
  const dims = {};
  for (const k of QA_DIMENSIONS) dims[k] = Math.round(rnd.normalClamped(means[k], 7, 25, 100));
  const overall = Math.round(QA_DIMENSIONS.reduce((s, k) => s + dims[k], 0) / QA_DIMENSIONS.length);
  const flags = [];
  if (dims.compliance < 70) flags.push('compliance-risk');
  if (dims.policy_adherence < 70) flags.push('policy-deviation');
  if (dims.accuracy < 70) flags.push('incorrect-information');
  return {
    qa_id: 'QA' + pad(++ds.meta.next_qa_seq, 3),
    reviewed_at: atMs, day_index: DAYS - 1,
    agent_id: agent.agent_id, agent_name: agent.name, team: agent.team,
    cohort, tenure_days: agent.tenure_days,
    reviewer: rnd.pick(ds.agents.filter((a) => a.role === 'Senior Agent')).name,
    ticket_id: t.length ? rnd.pick(t).ticket_id : null,
    category: t.length ? rnd.pick(t).category : 'Technical',
    overall_score: overall, dimensions: dims, flags,
    note: dims.policy_adherence < 70
      ? 'Quoted the superseded refund window; did not check the current policy article.'
      : 'Reviewed against the current scorecard.',
    is_live: true,
  };
}

/** The exact CSV header of the Kaggle dataset, for export/round-tripping. */
export const KAGGLE_COLUMNS = [
  'Ticket ID', 'Customer Name', 'Customer Email', 'Customer Age', 'Customer Gender',
  'Product Purchased', 'Date of Purchase', 'Ticket Type', 'Ticket Subject',
  'Ticket Description', 'Ticket Status', 'Resolution', 'Ticket Priority',
  'Ticket Channel', 'First Response Time', 'Time to Resolution',
  'Customer Satisfaction Rating',
];
