# Seed notes — what is staged and what is computed

This file exists so nobody has to guess which parts of a demo are real logic and
which are illustration. If you are about to show this to a prospect, read it
first: the honest answer to "is that real?" is a stronger position than a
confident one, and every claim below is checkable in the code.

**Rule of thumb:** structure, arithmetic and thresholds are computed. Narrative
phrasing is authored. No figure in the product is hardcoded.

---

## 0. Reproducing a run

```
seed    20260724
as_of   2026-07-26T09:00:00Z
```

**Both are required.** `generate(seed, asOf)` derives `day0` from `as_of`, so a
seed alone reproduces nothing — the dataset shifts with the clock and the
exposed accounts turn over completely. Two runs seven hours apart on the same
seed produced entirely different six-account cohorts and a $48K swing in total
exposure.

`data/store.js` already persists `{ seed, as_of }` together for this reason.
`explorations/data.js` is a frozen snapshot at the pin above.

> **Open issue.** The live app still calls `generate(seed, Date.now())`, so a
> demo rehearsed in the morning will show different accounts in the afternoon.
> Rounding `as_of` to the start of the local day would make it stable within a
> day at the cost of one line. Not yet done — it is a product decision.

---

## 1. Product usage — `data/usage.js`

Usage did not exist before this work. Tickets and calls both measure
*complaints*, so every detector required an account to complain before it became
visible. This is the other half.

| Field | Source | Status |
|---|---|---|
| `seats_provisioned` | `accounts[].seats` | **derived** (pre-existing field) |
| `seats_active_30d` | archetype activation rate × seats | **seeded** |
| `logins_30d` | `seats_active_30d` × per-seat rate | **seeded**, derived from seats |
| `logins_prior_30d` | back-computed from the target trend | **seeded** |
| `usage_trend_30d` | `(logins_30d − prior) / prior` | **derived** from the two above |
| `last_login_at` | `as_of −` archetype recency | **seeded** |
| `feature_adoption_pct` | archetype adoption band | **seeded** |
| `_archetype` | assignment (see below) | **seeded**, internal only |

`usage_trend_30d` is computed *back* from the two login counts, so the published
trend is always exactly what the numbers say. Asserted across all 2,400
accounts: `seats_active ≤ seats_provisioned`, and trend matches logins.

### Archetype assignment

Run as a **post-pass**, after tickets and escalations exist, so usage is shaped
against each account's real contact history. That ordering is what makes
"usage down, zero tickets" a genuine cross-reference of two independently
generated series rather than a label applied to both at once.

| Archetype | Share | Why it exists |
|---|---:|---|
| `healthy` | 56.8% | control group |
| `slow_decline` | 23.4% | the common case |
| `engaged_noisy` | 11.1% | **heavy contact, healthy usage** — proves the engine does not treat contact volume as risk |
| `cliff` | 5.3% | sharp recent drop |
| `silent_decline` | 1.3% | **the cohort the product exists to find** |
| `never_adopted` | 2.1% | seats bought, never switched on |

Correlation with escalation history is real but deliberately imperfect —
25.9% → 45.3% → 67.6% declining as escalations rise from 0 → 1 → 2. A perfect
correlation would make usage a restatement of the ticket data rather than an
independent source.

**Guaranteed cohorts** are chosen *deterministically* (highest ARR among
accounts that genuinely qualify), not sampled — a demo that sometimes lacks its
central cohort cannot make its own argument. Silent decliners are drawn only
from accounts with **zero tickets ever**, not merely none recently, because the
headline claim is "no tickets raised" and it must be literally true when
someone clicks in.

---

## 2. Detectors — statistical vs authored

### Statistical (9, pre-existing) — `engine/web/detect.js`

Every one compares a recent window against this operation's own baseline and
fires only above a declared threshold in `THRESHOLDS`.

| Detector | Test | Threshold |
|---|---|---|
| `escalation_spike` | two-proportion z | z ≥ 2.5 |
| `emerging_topic` | volume lift + share-of-mix z | ≥1.35× and z ≥ 2.5 |
| `sla_risk` | two-proportion z | z ≥ 2.5 |
| `backlog_risk` | slope over window | ≥ 3 tickets/day |
| `coaching_gap` | Welch t between cohorts | ≥ 8 pts and t ≥ 2.5 |
| `nps_drop` | NPS delta | ≥ 8 points |
| `csat_drop` | mean stars + Welch t | ≥ 0.25 and t ≥ 2 |
| `churn_risk` | rule over escalations + sentiment | ARR floor $60k, ≥ 5 accounts |
| `compliance_risk` | statutory deadline | deadline-driven |

### Rule-based (4, new) — `engine/web/revenue.js`

Thresholds declared in `REVENUE_THRESHOLDS`. These are **rules, not z-tests**,
and `_meta.z` is set to `0` rather than faked.

| Detector | Rule |
|---|---|
| `silent_decline` | usage ≤ −25%, **zero tickets**, ARR ≥ $20k |
| `adoption_failure` | seat activation < 40%, ≥ 20 seats, within onboarding window |
| `renewal_risk` | renews ≤ 90d **and** any deterioration signal |
| `concentrated_cause` | **two-proportion z ≥ 2.5** — see §5 |

### Meta (1, new) — `engine/web/confidence.js`

`data_quality` fires when any connected source drops below 70% coverage.
Measured, never seeded.

### Authored (narrative only)

- `risk_reason` sentence **structure** in `exposure.js` — stands in for what a
  language model generates in the shipped product. Every figure interpolated
  into it is read off a record.
- `recommended_action` phrasing in `revenue.js`.
- `CATEGORY_OWNER` — which function owns a fix for each contact reason. The
  dataset has no owning-function field; the mapping is named in code where it
  can be argued with rather than invented on the record.

---

## 3. Decision sizing — enforced by code, not by data selection

**This is the important one.** Sizing is applied in `engine/web/sizing.js`
*before* ranking, to whatever the detectors matched. It is not achieved by
choosing friendly demo data.

```
churn risk   matched 62 accounts, $1,283K total ARR
             scoped   6 accounts,   $813K  (63.4%)
             cut     56 accounts,   $470K  — still in the feed
             worth   $294K → $285K after rescaling
```

Every ARR-bearing decision is cut to the top 6 by revenue exposure, its impact
is rescaled by the share of ARR that survived, and `_meta.sizing.note` states
what was scoped out and what it holds. Headlines are rewritten to match
("Churn risk — top 6 of 62 accounts") so the card, the figure and the
drill-down cannot disagree.

**Why before ranking:** ranking on total ARR paid a premium for breadth. Churn
risk outranked silent decline by sweeping 59 accounts instead of 6 — not
because acting on it was worth more, but because it was less specific.

> **Note:** on this seed, sizing did *not* change the final order. Churn risk
> still leads, because its top six genuinely carry $813K against silent
> decline's $578K. The ranking was right for the wrong reason before, and is
> right for the right one now. On a flatter ARR distribution it would flip.

`is_revenue` is derived **semantically** — a decision is revenue-shaped when it
puts named accounts and their ARR at stake. It was previously set in one place
in `revenue.js`, which meant the classifier was really "which file emitted
this", and it tagged `churn_risk` as support-ops despite it being the largest
revenue decision in the feed.

---

## 4. Confidence and provenance — `engine/web/confidence.js`

| Field | Status |
|---|---|
| `confidence.score` | **derived** — engine confidence, capped by weakest source coverage |
| `confidence.basis` | **derived** — signal strength, sources read, weakest coverage |
| `confidence.limiting_factor` | **derived** — names the weakest input in plain English |
| `provenance_detail[]` | **derived** — measured coverage per source |

Coverage **caps** the score rather than averaging into it: a signal computed
from a source covering 33% of accounts is not 80% trustworthy however clean its
arithmetic, but neither is it 33%, because the records it *did* read are sound.
The cap is the midpoint.

Worked example — churn risk drops from 80% to **67%**:

> *Limiting factor: Survey · NPS covers only 33% — 1,599 accounts have never
> responded to a survey.*

`limiting_factor` is surfaced on the brief card, the feed row, the risk card
tooltip and the four-questions panel, plus a `coverage-capped` chip wherever
coverage is the binding constraint.

### Real coverage gaps in this dataset

All measured, none seeded:

| Source | Coverage | Gap |
|---|---:|---|
| Survey · NPS | **33%** | 1,599 of 2,400 accounts never responded |
| Survey · CSAT | **35%** | satisfaction unrecorded on 6,513 of 10,000 tickets |
| Quality Assurance | 81% | 12 of 62 agents never reviewed |
| Ticketing | 98% | 42 accounts have no ticket history |
| CRM · Accounts | 100% | — |
| Product usage | 100% | — |

> **ARR is 100% complete in this dataset.** The example in the original brief
> — *"ARR is missing on 40% of EMEA accounts"* — cannot be shown honestly here.
> The `data_quality` detector reports the real gaps instead (NPS at 33%, CSAT
> at 35%). If an ARR-gap demo is wanted, seed it deliberately in the generator
> and record it in this file — do not imply it from complete data.

The `data_quality` finding is **deliberately not costed**. The cost of a blind
spot is unknowable from inside it, and inventing a figure would be the exact
error the finding exists to warn about.

---

## 5. Concentrated cause — currently suppressed, and why

`concentrated_cause` groups at-risk accounts by dominant ticket category and
fires only when a category is genuinely **over-represented** among them versus
its base rate across comparable accounts — two-proportion z ≥ 2.5.

**On this seed it suppresses itself.** No category clears the bar:

| At-risk definition | Strongest category | z |
|---|---|---:|
| usage decline only | Billing | 0.88 |
| escalation history only | Refund | **1.55** |
| usage decline OR escalation | Refund | 0.68 |

An earlier version grouped by `product` and fired on Nimbus Mobile at $2.2M —
but with six products and at-risk accounts spread almost evenly, that was
simply the largest of six roughly equal buckets described as a pattern. It was
removed.

### Why it does not fire

**The seed data contains no planted causal chain linking a shared root cause to
account-level churn.** The refund-policy change *is* a genuine concentrated
cause — `escalation_spike` attributes 100% of the escalation-rate increase to
it — but that concentration lives in *escalation rate*, and does not carry
through to *which accounts are declining*. Those are different populations, and
nothing in the generator connects them.

### The fix, when it is wanted

Seed a real causal chain with ground truth: pick a cohort, give them a shared
attribute (a product version, a region, a migration date), drive both their
usage decline and their ticket category from it, and record the intended answer
so the detector can be scored against it.

**Do not lower the threshold.** A detector that fires on z = 1.55 will fire on
noise in front of a customer, and the first question any technical viewer asks
is "how does it know."

---

## 5b. The drill-down spine — decision → accounts → account

One path, three levels deep, rather than making everything shallowly clickable.

| Level | Surface | Source of every field |
|---|---|---|
| 1 | Decision card | detectors — see §2 |
| 2 | Exposed accounts | `engine/web/exposure.js` |
| 3 | One account | same, plus `supporting_signals` |

**The money figure is the affordance.** No extra button was added — the thing a
reader wants to interrogate is the number, so the number is what they click.
It is keyboard-reachable (`role="button"`, `tabIndex=0`, Enter/Space).

- The parent decision stays pinned at Level 2, so the thread is never lost.
- Accounts sort by ARR descending, and the footer **states whether the rows
  reconcile to the decision headline**. A drill-down whose rows do not add up
  is the fastest way to lose a room.
- Level 2 also states what sizing scoped out and where it went.
- Evidence at Level 3 names its source system per row. Typical spread is three
  systems — that spread is the argument, since no single tool holds all of them.

**No router**, by decision. Levels live in `state`; the breadcrumb and an
in-app back are the only ways up. Browser back and deep links would need
history integration touching how every existing surface is entered.

Transitions are a 180ms fade-and-lift, wrapped in
`prefers-reduced-motion: no-preference`. Motion encodes descent; it is not
decoration.

---

## 6. Known data-quality issues in the generator itself

Flagged, not fixed unless noted.

- ✅ **Fixed.** Duplicate company names. `CO_A × CO_B` gave 432 names for 2,400
  accounts — "Lumen Energy" appeared 15 times at ARR from $1.1K to $160.6K, and
  surfaced as the same company twice inside one decision. Namespace widened
  with legal qualifiers; all 2,400 now unique.
- ⚠️ **Open.** `customer_age` and `customer_gender` sit on the *account* record,
  inherited from the Kaggle ticket schema. Demographics on a B2B account are
  meaningless and a liability in front of a CRO.
- ⚠️ **Open.** Enterprise seat counts reach 2,396 at ~$84/seat/yr. Internally
  consistent but low for B2B SaaS, and it makes adoption failure read as
  "998 of 1,324 seats dormant" rather than the tidier "18 of 25".
- ⚠️ **Open.** Bare `toLocaleString()` on **numbers** in `assets/app.js:497,560`,
  `engine/run.js:38`, `engine/impact.js:34` renders `$1,79,000` on an en-IN
  machine. Legacy surfaces only; the live engine pins `en-US` throughout.

---

## 7. What a demo can and cannot claim

**Can claim, and show:**
- Nine statistical detectors with declared, arguable thresholds
- Product usage finding accounts no ticket-based tool can see
- Decision sizing enforced in code, with the cut declared
- Confidence capped by measured source coverage, weakest link named
- The engine reporting its own blind spots
- A detector suppressing itself rather than firing on a weak signal

**Cannot claim honestly today:**
- A concentrated causal chain (no ground truth in the seed — see §5)
- Missing-ARR data quality (ARR is complete — see §4)
- Stable numbers across a day (see §0)
- Any real customer outcome. Every figure is synthetic.
