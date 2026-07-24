# OpsPulse AI — the Operating Intelligence Layer

**The goal is not another dashboard. It is an AI decision engine for operations leaders.**

A CX director opens this at 9am and the first thing on the screen is *"here are your top 3
operational risks and what to do about them."* Everything else — the health gauge, the KPI
strip, ninety days of charts — exists so they can challenge those three, not so they can be
read first.

This repo contains two applications sharing one live dataset:

| | | |
|---|---|---|
| **NorthDesk** | `servicedesk.html` | The CSM / service-desk tool — ticket queue, escalation board, QA reviews, NPS inbox, agent roster. **The source system.** |
| **OpsPulse** | `opspulse.html` | The decision engine — Dashboard, Decision Feed, Risk Radar, Executive Copilot, Data Upload. |
| **Live Ops Floor** | `demo.html` | Both, side by side, off **one shared store.** Start here. |

---

## Run it

ES modules are blocked on `file://`, so the apps must be served over http. There is **no build
step and nothing to install.**

```bash
./serve.sh          # macOS / Linux
serve.cmd           # Windows
```

…or by hand:

```bash
python -m http.server 5500
# then open http://localhost:5500/demo.html
```

---

## Why the split screen is the point

ServiceDesk and OpsPulse are not two apps that synchronise. They are **two views over one
store**: `demo.html` mounts both against a single `createStore()` instance, so a ticket
arriving in NorthDesk is *already* the object OpsPulse is counting. There is nothing to keep
in sync, and therefore nothing that can drift.

Watch it for thirty seconds: tickets stream into the queue on the left, the ingest ticker on
the right moves with them, and every ~9 seconds the nine detectors re-run over the combined
dataset. Ticks are cheap; the full engine pass is throttled, so the top-3 never flickers
while someone is reading it.

---

## The data

Kaggle's dataset API needs credentials, so the data here is **generated to the real Kaggle
`customer_support_tickets.csv` schema** — a genuine Kaggle export drops straight into the
Data Upload screen. Synthetic is also the *correct* choice: the brief requires the AI to find
four specific patterns, and no arbitrary real dataset is guaranteed to contain them.

90 days of history for a fictional SaaS company (Northwind Cloud):

```
 10,000  support tickets       2,400  accounts        62  agents
    500  escalations           1,000  NPS responses  100  QA reviews
```

**Four patterns are injected. The engine is never told about them — it finds them
statistically.**

| | Pattern | What the engine has to notice |
|---|---|---|
| **P1** | Refund escalation spike | Escalation rate inside the refund category runs **~3.2× its own baseline** after a policy change (30-day refund window cut to 14). Blast radius is pinned to **exactly 231 distinct accounts**, so "231 customers" is a counted fact, not a caption. |
| **P2** | New-hire QA decline | A 14-agent cohort scores **~18 points below** tenured agents, worst on policy adherence and compliance. |
| **P3** | Onboarding confusion | Onboarding contacts run **~1.7× baseline** after the self-serve onboarding v2 release. |
| **P4** | Ticket backlog increase | Open backlog grows **~230 → ~430** because inflow rises while throughput does not. First-response time is modelled *as a function of* backlog, so the SLA story stays internally consistent. |

A fifth pattern falls out of the first four rather than being injected: **NPS drops ~18
points**, and its detractor verbatims carry the drivers above — so *"Why did NPS drop?"* has
an answer that is arithmetic, not narration.

Two events land a day apart in the release timeline (onboarding v2 on day 74, the refund
policy change on day 75) specifically so the root-cause agent has to pick the *relevant* one
rather than the *recent* one.

---

## How the engine works

```
Ingestion → Anomaly Detection (statistical, 9 detectors)
     └─ per anomaly → Root Cause → Recommendation → Impact
                           └→ Executive Summary → ExecutiveBrief
```

**Detection is arithmetic. The language layer only explains what arithmetic already found.**
Two-proportion z-tests, Welch's t, OLS slope — thresholds are declared in one visible block
(`engine/web/detect.js`), not buried.

**Root cause means attribution by decomposition**, not narration: the observed delta is split
across a dimension so the parts sum to the whole, the largest slice is named, and the onset
day is correlated against operational events *in the same domain*. It is labelled a
**hypothesis**, with a confidence built from three visible components — statistical strength
(45%), share of the change the top driver explains (30%), corroborating signals (25%).
Anything under 60% is **held for review** and never auto-actioned.

Three rules the codebase is built to keep:

1. **Dollar impact is always a defensible range with the arithmetic shown.** Every input is
   rounded to its *display* precision first and the range computed from the rounded values —
   so the inputs printed on the card genuinely multiply out to the range printed on the card.
   `tools/verify.mjs` re-multiplies them and fails the build if they don't.
2. **Some things are deliberately uncosted.** Compliance exposure carries no dollar figure. A
   statutory deadline is a legal question, and a fabricated fine probability would be the
   least defensible number on the page.
3. **The card face never disagrees with the chart behind it**, because both read through the
   same aggregation functions (`engine/web/aggregate.js`).

The exec top-3 is also **diversity-aware**: ranked purely by priority, the refund story would
take two of the three slots. A director needs three different problems, not one told twice.

---

## Verification

Both harnesses are the acceptance test, not decoration.

```bash
node tools/verify.mjs                                    # 67 checks — the engine
npm install --no-save jsdom && node tools/uicheck.mjs    # 73 checks — the UI
```

`verify.mjs` asserts that all four injected patterns are found, root-caused to the *correct*
release, ranked, and costed with arithmetic that reconciles — across **5 seeds × 4 calendar
positions** (including a weekend), because production uses `Date.now()` and a pattern must not
depend on which day someone opens the app.

`uicheck.mjs` renders both apps in jsdom and drives every screen, every drill-down, all 13
copilot intents, the CSV ingest path and the live simulator — failing on any thrown error,
empty render, or `undefined`/`NaN` leaking into user-facing text. It is what caught the two
real bugs in CSV ingestion: day-index rounding silently dropping half of any same-day import,
and uploaded categories crashing the live simulator.

---

## Data Upload is real

Dropping a CSV parses it, maps the columns, appends the rows to the live dataset and re-runs
the engine — the Decision Feed changes *because of your file*. Column matching accepts the
exact Kaggle headers, the internal names, and common Zendesk/Freshdesk variants, and the
screen shows you exactly which of your columns mapped to which field.

**`.xlsx` is not supported** and the UI says so plainly rather than failing quietly: a real
Excel file is a zipped XML package and parsing it needs a library this dependency-free
prototype does not ship. Export as CSV and it ingests fully.

---

## Executive Copilot

Offline build, so answers are **templated NLG over the engine's computed insight objects** —
not a language model. Every number in every answer is traceable to a record, it links
straight into the relevant drill-down, and when it does not have a grounded answer it says so
instead of guessing. (Swapping in a real model means feeding it the same insight objects; the
grounding layer is the part that matters.)

---

## Project structure

```
demo.html               Live Ops Floor — both apps, one store  ← start here
opspulse.html           OpsPulse standalone
servicedesk.html        NorthDesk standalone
index.html              Marketing site
roadmap.html            Technical roadmap
app.html                Earlier static-mock demo (superseded by opspulse.html)

data/
  rng.js                Seeded PRNG — the whole dataset rebuilds from one integer
  generator.js          90 days of history + the four injected patterns + live factories
  store.js              One store, two clocks (cheap tick / throttled engine pass)
  csv.js                CSV parse, tolerant column mapping, ingestion

engine/web/
  stats.js              z-tests, Welch t, OLS slope, onset detection
  aggregate.js          The single place that knows how to slice the dataset
  detect.js             Nine statistical detectors + declared thresholds
  reason.js             Decomposition, playbooks, impact arithmetic
  health.js             Health score + the four risk dimensions
  schema.js             The insight contract + validator
  index.js              Orchestrator

engine/                 Original Node CommonJS version of the 5-agent engine
assets/
  charts.js             Hand-rendered SVG charts (no chart library)
  opspulse.js           The five screens + BI drill-downs + copilot
  servicedesk.js        The CSM tool
  live.css              Both apps (container queries, so the split view needs no second sheet)
tools/
  verify.mjs            Engine acceptance test
  uicheck.mjs           Headless UI test (needs jsdom)
```

---

## Notes

- **Charts:** hand-rendered SVG, zero libraries. The categorical palette is the validated
  colourblind-safe set, re-run against this app's actual dark surface (`#0e1425`) rather than
  assumed. One y-axis always, legends for ≥2 series, a data table on every chart, hover
  tooltips throughout.
- **Performance:** 10,000+ tickets are never put in the DOM — the queue paginates at 50 rows.
  A full engine pass over the whole dataset runs in ~100ms.
- **Persistence:** only the seed and the as-of instant are stored; the dataset rebuilds
  deterministically. Storing 11,600 records would blow the ~5MB localStorage quota.
- **"New data"** in the OpsPulse toolbar reseeds the whole operation — different companies,
  agents, tickets and numbers, with the same four patterns still detectable.
- All data is simulated. This is a prototype.

---

*© 2026 OpsPulse AI · Prototype.*
