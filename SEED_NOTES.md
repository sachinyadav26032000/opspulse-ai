# SEED_NOTES.md — what is simulated, and how honestly

This file exists so nobody has to read the generator to find out which numbers
in OpsPulse are real measurements and which are illustrative. **Everything in
this prototype runs on simulated data.** That is stated on the site, but the
distinction below is finer than "it's all fake": some streams are *generated
and then genuinely discovered by the engine*, and some are *seeded so a surface
has something to render*. Those are very different claims and a demo should
never blur them.

Three categories are used throughout:

| Category | Meaning |
|---|---|
| **Generated → discovered** | The generator injects a pattern; nothing downstream is told where it is. The engine recovers it statistically. A finding here is a real detection over synthetic data. |
| **Generated → derived** | Values are simulated, but every figure shown is computed from them at read time and reconciles with its printed inputs. |
| **Seeded → illustrative** | Fixtures written so a surface can be built and reviewed. **Not detected, not derived.** Must be replaced by a real feed before any claim is made from it. |

---

## Product usage / adoption — *Generated → discovered*

Adoption was the one renewal signal the product described but could not
compute. It now exists.

- **Shape.** `account.usage_weeks`: a packed array of 12 integers, one per week,
  each the count of **weekly active seats** for that account. Packed onto the
  account rather than emitted as a flat collection: 2,400 accounts × 12 weeks
  would be 28,800 rows added to a ~11,600-record dataset, to carry one integer
  per bucket.
- **Derivation.** Only `active_seats` and the contracted `seats` are stored,
  both exact integers. Adoption percentages are computed at read time by
  `adoptionOf()` in `engine/web/aggregate.js`. Seat means are rounded to whole
  seats *before* dividing, so a printed "58%" genuinely re-divides from the
  printed seat counts, and `adoption_delta_pct` is the difference of the two
  rounded percentages rather than a rounding of the true difference.
- **The injected pattern.** ~21% of accounts, weighted toward paying plans,
  lose 30–46% of their adoption across the recent window on a ramp. Each
  account has its own baseline level and its own noise, so no cross-account
  threshold can find them: the decline has to be recovered per account against
  that account's own history. Nothing downstream reads the cohort list.
- **What this does NOT yet include.** There is no `adoption_decline` detector
  signal type. Adoption is queryable and surfaced, but it does not yet raise
  its own card in the Decision Feed with severity, decomposition and costing.
  That is a change to the detection layer and deserves its own review.

---

## Supported query types

See `engine/web/query.js`. Natural language maps to a **fixed, parameterised
set** of query types; there is no open-ended query generation, because that
route hallucinates joins and produces numbers that do not reconcile. An
unmapped question is answered with "I cannot answer that", the missing data
named, and the nearest supported query offered.

| Query type | Parameters | Reads | Filter? |
|---|---|---|---|
| `renewal_window` | quarter+year, or a day count | `renewal_in_days` (contract field, exact) | yes |
| `adoption_threshold` | `lt`/`gte`, percentage | `adoption_pct` (derived) | yes |
| `arr_threshold` | `lt`/`gte`, dollars | `arr_usd` (billing field, exact) | yes |
| `risk_filter` | none | escalations, NPS, adoption delta | yes |
| `account_lookup` | account id | the account's own row | no |
| `exposure_rollup` | none | `arr_usd` over the current set | no |
| `cause_grouping` | none | strongest reason per account | no |

**Composition.** Filter types push onto an ordered stack ANDed together and
render as removable pills; the other types read whatever the stack currently
holds without changing it. A follow-up therefore narrows the previous result
set rather than running fresh.

**Confidence is data coverage, not a probability.** A filter either applied or
it did not, so a statistical confidence would be invented. What is reported is
the share of rows in scope for which every field the query touched is present,
with the weakest field always named as the limiting factor.

**Company names are not unique.** ~2,400 accounts share ~430 company names,
some up to 13 times. A name in a question resolves against the *current
filtered set* first (that is what "in there" means), then the whole book, and
the answer states how many accounts share the name and which one it picked.

**Nothing is guessed.** An unmapped question renders a refusal that carries no
number at all and lists the full supported surface, both account queries and
insight topics.

---

## External signals — *Seeded → illustrative*

**These are fixtures. Nothing here is detected, retrieved or verified.** They
exist so the schema, the precedence rule and the surfacing can be built and
reviewed now; real feeds (Crunchbase, Tracxn, ZoomInfo) are licensed data and a
procurement decision rather than an engineering one.

- **Volume.** ~2.5% of accounts carry exactly one signal, roughly 60 on this
  dataset. Deliberately sparse: a book where a fifth of customers were being
  acquired would read as obviously fake.
- **Types.** `acquisition` and `distress` (`risk_up`, high confidence),
  `stakeholder_change` (`risk_up`, lower confidence), `funding`
  (`opportunity`, runs the other way).
- **Every record is marked `seeded: true`.**

### The one deliberate departure from the brief

The brief asks each signal to carry a `source_url` that links out. That is
right for a live feed and wrong for a fixture: **a fabricated link to a real
news domain is a citation that does not exist**, and it is the first thing
someone clicks in a demo. So seeded records carry a `source` naming the sample
feed, a real `detected_at`, and a **null `source_url`**. The UI renders
provenance either way and shows a `sample` badge in place of a dead link. When
a real feed is connected it supplies real URLs, and the badge disappears on its
own with no UI change.

### Precedence

`external_event` sits at the top of the reason taxonomy in `reasonFor()`, above
adoption decline, escalations and detractor NPS. An external risk event also
qualifies an account as at-risk **on its own**, without any internal signal.
That is the entire point: an acquisition is most dangerous exactly when the
internal metrics look healthy, so requiring corroboration would filter out the
accounts this data exists to catch. Verified: an account with zero escalations,
healthy NPS and flat adoption still surfaces, and the reason shown is the
external event.

---

## Outcome / decision lifecycle — *mixed, and labelled per row*

`data/ledger.js`. Two kinds of row live in the same ledger and every row says
which it is via a `simulated` flag. The Impact surface states the split on
screen rather than in this file only.

### Real rows — *Generated → derived*

Opened by the engine actually raising an insight in this session. `surfaced_at`,
`viewed_at`, `actioned_at` and `action_taken` are genuine records of what the
engine raised and what the user did. `arr_at_risk` is captured **at surfacing
time and never recomputed**, so the ledger shows what was known then rather
than what is known now.

These persist to `localStorage` under `opspulse.ledger.v1`, surviving the ~9s
engine pass and a page reload.

### Seeded rows — *Seeded → illustrative*

24 **closed** decisions dated 120–400 days before the as-of instant, so a
prototype has finished outcomes to show. Marked `simulated: true`, deterministic
from the dataset seed so two tabs agree, and dated outside the analysis window
so they can never collide with a live episode.

The outcome distribution is deliberately **not flattering**: ~62% retained, ~20%
churned anyway, ~10% expanded. A ledger that only remembers its wins is one you
cannot forecast with, and that is the first thing a sceptical buyer checks.

### Episodes — the correctness rule that matters

`insight_id` is a deterministic hash of the anomaly key, so the same anomaly
returns the same id on every pass. That is what lets a lifecycle row attach at
all, and it carries one hazard: an anomaly that clears and returns months later
gets the **same id**. Without a boundary a save recorded in Q2 would silently
absorb a Q4 recurrence and corrupt the retention figure.

So rows are keyed `insight_id#episode`. A new episode opens **only when the
previous one has closed with an outcome**. A detector flickering across its
threshold for a pass or two stays one episode, which keeps one save from being
split across several rows.

### The naming rule

The financial metric is **`arr_on_flagged_retained`**, rendered as **"ARR
retained on flagged accounts"**. Never *ARR saved*, never *influenced*.

The product knows it flagged an account and knows the account renewed. It does
not know the second happened because of the first, because nobody ran the
account without the intervention, so no counterfactual exists. The caveat is
rendered **on the Impact surface itself**, not in a footnote: if the number is
going under a pricing conversation, the limit of what it claims belongs on the
same screen.

### MCP stays read-only

Recording a decision is a mutation, and the standing rule is that adding a
mutating MCP tool is a decision to escalate rather than make. Ledger writes are
therefore **UI-only**; all seven MCP tools remain read-only and unchanged.

---

## Commercial tiers and entitlements — *config, not data*

`config/entitlements.js`. Three tiers priced on **two axes only: accounts under
management, and sources connected. Never per seat.** There is deliberately no
`max_seats` field in the table to be tempted by — a renewal risk only gets
acted on if the CSM, the RevOps lead and the CRO can all open it, so charging
per seat would price the product against its own mechanism of action.

**The demo defaults to `enterprise`.** An unattended visitor landing on a wall
of padlocks reads a thin product rather than a priced one, so the default shows
everything and the header's **demo tier** switcher puts the downgrade under the
presenter's control. Flipping to Essential locks contact centre, external
signals, delegation and Impact while the top-3 and every KPI stay exactly where
they were — which is the point worth demonstrating: *the engine is the same
engine on every plan.* Essential customers are sold fewer surfaces, not worse
detection.

The tier rides on the **session** (`opspulse.session.v1`), not on
`dataset.meta`. A tier is a fact about the contract, not about the operation,
and putting it on meta would mean the reseed path silently reset the customer's
plan every time someone pressed "New data".

### Locked states are rendered, never removed

A gated feature shows its own shape, names the tier that opens it, and states
what it cannot tell you. Nothing disappears from the nav.

**The honesty rule, which is the whole of the design:** on a tier that does not
ingest the data, the locked copy says accounts **"may have"** external events —
never a count. The seeded signals are sitting in the same dataset and counting
them would be a one-line change; it would also be a lie about what that tier
can see. `tools/uicheck.mjs` asserts both halves: that the panel renders, and
that no count appears in it.

Two features are locked on **every** tier including Enterprise, because they do
not exist: **contact centre** (no telephony source in this build) and **SSO /
audit / residency** (this prototype has no authentication of any kind and
writes no audit log). Both panels say so rather than showing ticks.

### Usage counters — *Generated → derived*

Surfaced on the **Assurance** screen, which is new: `trust.html` had been
directing readers to "the Assurance screen" for some time and it had never been
built.

`accountsUnderManagement()` in `engine/web/aggregate.js` is the single
definition, read by both the counter tile and the cost model so the two cannot
disagree. It is the **union** of accounts with a contract record and accounts
seen in the ticket stream — not `ds.accounts.length`, which undercounts by the
entire size of an uploaded book: `data/csv.js` gives an uploaded row a
synthetic `UP:<identity>` account id and never creates a master record for it.

**Soft limits.** Exceeding a ceiling flags for a conversation at renewal and
never blocks anything. There is no `blocked` state in `usageOf()` for a surface
to key off. A customer who hits the account ceiling has grown their book, which
is the outcome this product exists to produce; charging for that result and
then punishing it would be indefensible.

### Cost metrics — *counters measured, dollars modelled*

`engine/web/cost.js`. The split is load-bearing and is labelled on screen.

**Measured**: `decisions_surfaced`, `accounts_processed`, `records_scanned`.
Decisions are counted as ledger **episodes** over the span the ledger covers,
not as `insights.length` — the engine re-raises the same open risks every ~9
seconds, so counting passes would report thousands of decisions a day for an
operation that produced three.

**Structurally zero, and reported as such**: `inference_calls`,
`inference_tokens_in`, `inference_tokens_out` — `engine/llm.js` is a deliberate
stub that throws and the Copilot is templated NLG over insight objects, so this
build has never made an inference call. `calls_transcribed` is zero until
contact centre ships, which means **no figure anywhere in this product derives
from call data.**

**Modelled**: every dollar. Each rate is named `ASSUMED_*` so it cannot be
quoted as a measurement by accident, including the per-tier
`list_price_usd_month`, which is a modelling input and **not a committed
price**. Gross margin is returned as a **range with its inputs printed**, under
the same rule dollar impact obeys — inputs rounded to display precision
*before* the range is computed, so the printed working re-multiplies by hand.
Never a single-point margin.

An earlier cut of this model counted only inference, compute and lookups and
reported a **99% gross margin**. That was arithmetically correct and
commercially worthless: the dominant cost of serving a customer here is a human
reading their book with them, not a GPU. Customer success is now a line item,
allocated per thousand accounts rather than as a share of revenue — CS effort
tracks book size, and pricing it as a percentage of list price would make
margin mathematically insensitive to volume and bury the architecture story.

### What the seed data implies

At the demo book of 2,400 accounts and ~3 decisions surfaced per month:

| Tier | At the demo book (2,400) | At the tier's own ceiling |
|---|---|---|
| Essential ($1,000) | 22–51% | **84–90%** at 500 accounts |
| Growth ($3,000) | **72–82%** | **71–81%** at 2,500 accounts |
| Enterprise ($7,500) | 89–93% | **54–70%** at 10,000 accounts |

**Growth clears the >70% target at both its demo book and its ceiling.**

Two findings the model surfaces rather than hides. Essential looks poor at the
demo book only because that book is 4.8× its 500-account ceiling — the usage
counter flags exactly this, and at its own ceiling the tier is the healthiest of
the three. And **Enterprise's flat price stops clearing 70% somewhere around
7,000 accounts**: "unlimited accounts" at a single price is a real exposure on
a large book, and it is a pricing decision rather than an engineering one.

Inference is **under 1%** of modelled cost of goods at every tier. That is the
architecture claim as a number: detection is statistical, so cost tracks
decisions surfaced rather than data ingested, and a customer who triples their
ticket volume barely moves the line.
