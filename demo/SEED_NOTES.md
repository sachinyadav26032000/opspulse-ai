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

**Both are required.** `generate(seed, asOf)` is sensitive to its input *below
day granularity*, so a seed alone reproduces nothing. The same seed at 09:00,
14:30 and 22:30 on one day produced three different at-risk cohorts — $664K,
$813K and $444K — even though the derived `day0` was identical in all three.

✅ **Resolved.** `data/store.js` now rounds `as_of` down to the start of the
local day, so a run is stable within a business day and refreshes when the day
turns. That is the correct cadence for a morning brief, not a demo hack: a
brief that reshuffles under someone who acted on it at 9am is worse than
useless. Session staleness compares local days, and `reseed()` rounds too, so a
new world cannot land mid-day and start drifting.

`explorations/data.js` is a frozen snapshot at the pin above and is unaffected.

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
| `usage_history[6]` | shape multipliers over 6 months | **seeded** — see below |
| `_archetype` | assignment (see below) | **seeded**, internal only |

`usage_trend_30d` is computed *back* from the two login counts, so the published
trend is always exactly what the numbers say. Asserted across all 2,400
accounts: `seats_active ≤ seats_provisioned`, and trend matches logins.

### Six months of history — the "why is the usage less?" question

From the validation call: *"Why is the usage less? What was the usage last week,
and how have they been consuming the product over the last few months?"* A single
30-day trend cannot answer that, so each account carries six monthly points.

**The history is the source of truth, not a decoration drawn beside the card.**
`seats_active_30d`, `logins_30d` and `usage_trend_30d` are all derived *from* the
last two history points. Building them alongside the history instead produced 608
accounts out of 2,400 whose sparkline contradicted their own trend figure.

Two modelling traps worth recording, both hit during this work:

- Shape multipliers are defined **relative to month 5**, not relative to today.
  Defined against today they fight the trend and produce spikes — one account
  read `25 24 23 22 63 11`.
- Login counts are derived from the trend rather than rounded independently. On
  small accounts independent rounding breaks the ratio: `1 → 2` publishes as
  −50% while `12 → 23` publishes as −47.8%.

A `recovering` shape is assigned at shape level to 18% of `healthy` and
`engaged_noisy` accounts, so a rising sparkline is not automatically suspicious.

Verified across 12,000 accounts over 5 seeds: zero contradictions between a
sparkline and its published trend, at the precision each is displayed to.

## 1b. Billing terms — `data/billing.js`

From the same call: *"Payment frequency — is it an offline or online customer?
Many companies on offline get 30 days extra credit, so the churn is not exactly
on the same date."*

| Field | Source | Status |
|---|---|---|
| `billing.channel` | 30% offline, leaning by plan (Enterprise +0.22, Growth +0.04, Starter −0.08) | **seeded** |
| `billing.credit_days` | `{online: 0, offline: 30}` | **derived** from channel |
| `billing.renewal_date` | `as_of + renewal_in_days` | **derived** |
| `billing.effective_churn_date` | renewal date **+ credit days** | **derived** |
| `billing.runway_differs` | `credit_days > 0` | **derived** |

Both dates are surfaced, never one "corrected" date — the *gap* is the insight.
An offline account renewing in 20 days has 50 days of runway; an online account
renewing in 35 has 35. Sorted by renewal date a CSM works the offline one first
and is wrong.

Run as a **post-pass on its own RNG stream**. Adding draws to the account loop
shifts every downstream value and silently regenerates the world; that happened
once on this branch and broke pattern detection until it was traced.

## 1c. Renewals derived from contracts, not drawn

`renewal_in_days` was previously `rnd.int(5, 360)` — a uniform smear with no
contract behind it, which made "what renews this quarter" meaningless.

| Field | Source | Status |
|---|---|---|
| `purchased_at` | `rnd.int(35, 1400)` days ago, ~70% snapped to a quarter end | **seeded** |
| `term_months` | weighted `{12: 0.62, 24: 0.26, 36: 0.12}` | **seeded** |
| `renewal_in_days` | `purchased_at + term_months`, rolled forward | **derived** |

Exactly two RNG draws, the same count the old line consumed, so the rest of the
dataset is byte-identical. Renewals now cluster at quarter ends as real books do
— Mar 690, Jun 478, Sep 425, Dec 384, against 26–68 in off-quarter months.

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

### Rule-based (5) — `engine/web/revenue.js`

Thresholds now live in `config/thresholds.js` (see §2b) and are re-exported as
`REVENUE_THRESHOLDS`. These are **rules, not z-tests**, and `_meta.z` is set to
`0` rather than faked.

| Detector | Rule |
|---|---|
| `silent_decline` | usage ≤ −25%, **no ticket in 30 days**, ARR ≥ $20k |
| `adoption_failure` | seat activation < `adoption_decision_threshold` (40%), ≥ 20 seats, within onboarding window |
| `renewal_risk` | renews ≤ 90d **and** any deterioration signal |
| `renewal_cohort` | renews ≤ 90d **and** adoption < `adoption_worklist_threshold` (60%), ≥ 10 accounts, **excluding whatever `renewal_risk` already named** |
| `concentrated_cause` | **two-proportion z ≥ 2.5** — see §5 |

`silent_decline` previously keyed on `tickets === 0` — *never* contacted. An
account that raised a ticket four months ago and has since gone quiet while its
usage falls is the textbook silent decline, and it was excluded. Keying on days
since last contact took the matched set from 6 accounts to 23.

`renewal_cohort` runs **after** `renewal_risk` and reads its account list, so
the two never claim the same ARR. Reordering them in `DETECTORS` silently
double-counts; the dependency is commented at the call site.

## 2b. Thresholds — `config/thresholds.js`

Every bar the product clears is written down once. The file draws a line the
codebase previously did not:

**`TUNABLE` — four business definitions a customer owns.** All four came out of
the validation call. Editable at runtime from the Assurance panel, which re-runs
the engine on change.

| Dial | Default | Means |
|---|---|---|
| `adoption_worklist_threshold` | 60% | below this, an account joins the renewals working list |
| `adoption_decision_threshold` | 40% | below this, low adoption is a decision in its own right |
| `renewal_window_days` | 90 | how far ahead a renewal is this quarter's problem |
| `usage_decline_pct` | 25 | fall over 30 days that counts as a decline |
| `silent_account_days` | 30 | no contact for this long is "silent" |

**Everything else — statistical bars.** z-scores and minimum samples. These hold
the false-positive rate down and are deliberately *not* exposed: two customers
do not share a definition of "low adoption", but they do share a definition of
significance.

**Two adoption thresholds, and the names say which is which.** Formerly
`adoption_risk_pct` (60) and `adoption_floor` (0.40) — a percentage and a ratio,
under names that gave no clue they were the same metric at different bars. Both
are now percentages, because that is the unit a customer states them in at
onboarding.

- `adoption_worklist_threshold` (60%) — where a CSM's working list starts. Wide
  by design; a list to work through is allowed to be long.
- `adoption_decision_threshold` (40%) — where adoption **alone** is bad enough
  to be a CRO-level decision. Necessarily stricter, or every card is this card.

They are deliberately not collapsed into one: doing so would quadruple
`adoption_failure`'s output while reading as a tidy-up.

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

### The cohort exception — `_meta.scope_is_full`

Cutting to six is right when the decision is "work these six accounts". It is
wrong when the recommended action covers the *whole* matched set. `renewal_cohort`
says "run one adoption play across 128 accounts"; shrinking its economics to
the six it names as examples would understate the decision by the size of its
own cohort, and labelling the formula *"scoped to 6 of 128"* beside a
full-cohort figure puts a label and a number that contradict each other on the
same line.

Such decisions set `_meta.scope_is_full`. Sizing then records `matched`/`shown`/
`cut` for the drill-down but leaves the arithmetic and the headline alone, and
`note` says so: *"the 6 largest by ARR are named here as examples."*

### A reporting bug this surfaced

`sizing.js` derived the cut ARR as `evidence.arr_at_risk − shown_arr`. But the
revenue detectors set `arr_at_risk` to the **shown** ARR — their economics are
already scoped, which is why `ratio` is 1 for them — so the subtraction yielded
zero and the note printed *"the remaining 17 hold $0 and stay in the feed."*

It read as correct for exactly as long as every revenue detector matched the six
accounts it showed. The moment `silent_decline`'s fix took it from 6 matched to
23, the note started stating a falsehood. `prioritise()` already sums the true
totals; sizing now prefers them. All four decisions verified: `shown + cut =
total`.

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

## 5bb. Churn reason taxonomy — `engine/web/churn-reason.js`

`exposure.js` writes a `risk_reason` SENTENCE per account, and it is good
prose. But prose does not group. You cannot count it, rank it, or answer *"what
are the top three reasons my book is at risk this quarter"* — which is the
question that follows *"why is the usage less?"* once there is a list. Forty
sentences is forty things to read; four reasons with counts is a decision.

One PRIMARY reason per account from a closed vocabulary, in precedence order.
The order is an argument about **evidence quality**, not severity — a customer
telling you they intend to leave outranks anything inferred from telemetry:

| Reason | Fires when |
|---|---|
| `explicit_intent` | a cancellation case is on record — the only one the customer *stated* |
| `never_adopted` | adoption below `adoption_decision_threshold`, peak also below it, **and not declining now** |
| `usage_cliff` | 30-day fall ≥ `usage_cliff_pct` (45%) |
| `usage_erosion` | 30-day fall ≥ `usage_decline_pct` (25%) |
| `service_failure` | repeat escalations **and** the relationship souring elsewhere |
| `sentiment` | detractor NPS or falling CSAT, **unless** usage is actively healthy |
| `none` | nothing qualifies — not the nearest-looking label |

### Three decisions that took iterations

**Silence is a flag, not a reason.** It was tempting as a seventh category, but
it answers a different question: usage erosion is why the account is leaving,
silence is why nobody noticed. Competing with the causes would hide a cause
every time both were true.

**`service_failure` needs corroboration.** A first pass labelled 149 `healthy`
and 42 `engaged_noisy` accounts as service failures — and `engaged_noisy`
exists in this dataset *specifically* so a model can be caught treating contact
volume as risk. It now requires escalations **and** deterioration elsewhere.
0.4% / 0.5% false-positive rate after the fix.

**`never_adopted` is separated from a cliff by USAGE, not adoption.** Testing
the adoption history alone stole 47 of 127 genuine cliffs: those accounts read
35%→27% adoption, an 8-point drift, while their usage fell 71% over the same
window. Adoption is how MUCH of the product they touch; usage is how OFTEN. A
customer can keep using the same three features far less, and only the second
number shows the collapse.

### It never reads the answer key

The classifier does not touch `_archetype` — same discipline as every detector.
That is what makes scoring it a measurement rather than a tautology. Across 3
seeds: cliffs **88%**, never-adopted **98%**, false positives on healthy and
engaged-but-noisy **0.4%** and **0.5%**.

**Slow declines are scored against the RULE, not the archetype label**, and
this is the subtle one. The generator's `slow_decline` band runs 0% to −50%
with a median of −20%, so *any* threshold inside that band recovers exactly the
share above it — at the configured 25% that is ~55%. Asserting "recovers ≥55%
of slow declines" therefore measures where a customer-tunable dial sits, not
whether the classifier works. What is a genuine correctness property, and what
is asserted instead:

- every account clearing the bar with no higher-precedence reason **is**
  labelled erosion — 100%;
- nothing below the bar is called erosion — 0 false;
- the ones under the bar fall to `none` or a higher-precedence reason, **never
  to a wrong usage label** — 0.

65 of the apparent "misses" were never misses at all: they are accounts where
`explicit_intent` or `service_failure` correctly outranked erosion.

---

## 5c. The renewals × adoption cohort — `engine/web/cohort.js`

The screen the validation call described: *"What are my upcoming Q3 renewals?
And add me another column which says MAU... less than 70 or 60%, and that's the
cohort I go after."*

Three controls, one table. Deliberately **not** a report builder — this is one
query run repeatedly, not twenty run once.

**Three scope levels**, because "my renewals" means a different book to
different people in the same org:

| Level | Book | Renewals this quarter |
|---|---|---|
| `csm` | an individual queue | median **7** |
| `region` | a director's book | ~**156** ← default |
| `all` | the VP rollup | ~**398** |

Region is the default because that is the altitude the question was asked at.

Measured across 5 seeds: **48 distinct CSMs**, book size **32–68** (median ~50),
median **7 renewals a quarter** — the call implied ~6 per CSM, and book sizes
sit inside the 30–80 benchmark.

Two fixes were needed to get there:

- **CSMs are drawn from tenured agents only.** A new hire ~46 days into the job
  does not own a book of forty accounts and their renewals. `csmPool` filters
  on `cohort === 'tenured'`; `rnd.pick` consumes one draw whatever the pool
  length, so the RNG stream is untouched.
- **Agent names are now unique.** `${rnd.pick(FIRST)} ${rnd.pick(LAST)}`
  collided 2–3 times in 62 on most seeds. Harmless while a name was only a
  label; not harmless once renewal books are grouped **by CSM name** — two
  people called Vikram Sandoval merged into one 91-account book, which is not a
  book size that exists in a real CS org. Deduped on its own RNG stream, with
  the two original draws still consumed, exactly as the company names are.

**The table is a working list, not a decision.** Forty rows sorted by ARR is
correct here. Decision sizing applies to the brief item that *points* at this
surface, not to the surface itself. Below-threshold rows carry a thin left rail
and nothing else — filled cells would turn a working list into an alarm board,
and a CSM scans forty of these at a time.

`at risk` is the ARR of accounts **below the threshold**, not the whole renewal
book. That distinction is the point of the screen: plenty of accounts renew, and
only some of them are in trouble.

The brief item forces scope to `all` and the window to 90 days when it opens
this surface, so the card and the screen it opens cannot disagree. Landing on
the region-scoped quarter default would show 48 accounts under a card that just
said 128, and the first thing a reader concludes is that one of the numbers is
wrong.

### Visible arithmetic, not differing numbers

The cohort surface lists **every** below-threshold account, including the ones
`renewal_risk` already owns. Those rows carry a `renewal defence` tag and stay
in place; nothing is hidden. Card and surface both show the subtraction:

```
104 below 60%  −  4 named under renewal defence  =  100 in this play
```

Filtering the four out instead would make the surface read 100 where an earlier
reading said 104, and a reader's first conclusion is that one of the numbers is
wrong. Showing all of them with four marked *demonstrates* that the two
decisions don't double-count, rather than asking anyone to take it on trust.

**Subtract the overlap, not the whole named set.** `renewal_risk` names six
accounts, but most are named for usage decline or an escalation rather than
adoption — only the ones that are *also* below the threshold are double-counting
candidates. Subtracting all six gives `130 − 6 = 124` against a cohort of 128,
and the arithmetic visibly fails to close. Two marks, two facts: the left rail
means below threshold, the tag means already owned elsewhere.

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
