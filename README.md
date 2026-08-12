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
| **Ops Copilot** | `app.html` | The original single-screen dashboard — decision feed, insight explorer, analytics. Reads the same store. |
| **MCP server** | `mcp/` | The same engine as tools an LLM can call. Inspector at `mcp-inspector.html`. |

Open any combination of them, in any number of tabs. They all show the same
operation — see **One operation, every tab** below.

---

## Run it

ES modules are blocked on `file://`, so the apps must be served over http. There is **no build
step and nothing to install.**

```bash
node mcp/http.js    # everything, one process, one port  ← start here
```

That serves the apps **and** the MCP endpoint on `http://localhost:5500` — see
**An agent can drive this** below. A static server still works if you only want the apps:

```bash
./serve.sh          # macOS / Linux
serve.cmd           # Windows
python -m http.server 5500
```

The static path cannot answer JSON-RPC, so `/mcp-inspector.html` will report that it
can't reach the endpoint — that is the only difference.

---

## Why the split screen is the point

ServiceDesk and OpsPulse are not two apps that synchronise. They are **two views over one
store**: `demo.html` mounts both against a single `createStore()` instance, so a ticket
arriving in NorthDesk is *already* the object OpsPulse is counting. There is nothing to keep
in sync, and therefore nothing that can drift.

Watch it for thirty seconds: tickets stream into the queue on the left, the ingest ticker on
the right moves with them, and every ~9 seconds the nine detectors re-run over the combined
dataset. Ticks are cheap; the full engine pass is throttled, so the top-3 never flickers
while someone is reading it — but the **KPI numbers refresh on every tick**, because those
are the figures NorthDesk is also showing and the two panes must never disagree mid-read.

---

## One operation, every tab

Sharing an object graph solves the split screen. It does nothing for the second window.
Opening NorthDesk and OpsPulse in separate tabs used to give you the same 90 days of history
— both rebuild it from the persisted seed — and **two different live tails**, because each
tab ran its own simulator.

`data/sync.js` fixes that with one writer and many readers:

- Exactly one tab runs the simulator. It **broadcasts the records it created**, and every
  other tab applies them. Replaying a seeded PRNG per tab would send less, but it makes each
  tab's correctness depend on every tab walking an identical code path — one dropped message
  and they diverge silently and permanently. Shipping records means a follower's state is a
  function of what it *received*, which is inspectable.
- Followers re-run the engine against the **leader's `as_of`**, not their own clock, so a
  window boundary can never put two tabs on opposite sides of a day.
- A tab opened later asks for a snapshot and catches up — live records, plus the patches for
  history the simulator reached back and mutated.
- Pause, reseed and CSV upload work from **any** tab; a follower asks the writer to do it.

Two roles, deliberately separated:

| | |
|---|---|
| **Lock holder** | Decided by `navigator.locks` — an exclusive lock that is never released, so the browser hands it on when that tab closes. Failover with no heartbeat and no tie-break. |
| **Writer** | Who is actually ticking. It can move without the lock moving, because **browsers throttle timers in hidden tabs** to roughly one a minute. Leave the writer in a tab you are not looking at and every tab you *are* looking at goes quiet, so a hidden writer hands off to a visible one. |

Splitting them is what keeps the handoff safe: delegation is a favour the lock holder grants
and can reclaim, and only the lock holder runs the watchdog — so there is never a moment when
two tabs both believe they should be writing.

Without `BroadcastChannel` or `navigator.locks` — Node, jsdom, older browsers — the whole
layer is a no-op and each tab is its own writer, exactly as before.

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
node tools/verify.mjs                 # 67 checks — the engine finds the patterns
npm install --no-save jsdom
node tools/uicheck.mjs                # 78+ checks — the UI renders them
node tools/synccheck.mjs              # 36 checks — every tab shows the same operation
node tools/appcheck.mjs               # 34 checks — app.html reads the store, not a mock
node tools/browsercheck.mjs           # 29 checks — the real navigator.locks path, both directions
node tools/mcpcheck.mjs               # 79 checks — the MCP server, over a real pipe
node tools/chatcheck.mjs              # 44 checks — Rio answers the right question
```

**Around 370 checks.** Six of the seven totals are fixed; `uicheck` drills into *every* insight
the engine produced, and how many clear the thresholds depends on where `Date.now()` falls in
the window — so its total floats by a few from day to day. A changed uicheck total is
therefore not by itself a regression; a **failure** is.

`verify.mjs` asserts that all four injected patterns are found, root-caused to the *correct*
release, ranked, and costed with arithmetic that reconciles — across **5 seeds × 4 calendar
positions** (including a weekend), because production uses `Date.now()` and a pattern must not
depend on which day someone opens the app.

`uicheck.mjs` renders both apps in jsdom and drives every screen, every drill-down, all 13
copilot intents, the CSV ingest path and the live simulator — failing on any thrown error,
empty render, or `undefined`/`NaN` leaking into user-facing text. It is what caught the two
real bugs in CSV ingestion: day-index rounding silently dropping half of any same-day import,
and uploaded categories crashing the live simulator.

`synccheck.mjs` runs three stores in one process on a real `BroadcastChannel`, standing in
for three tabs. Row counts are not the assertion — two stores can hold 10,042 tickets each
and disagree about every one of them — so it compares ids, timestamps, the fields a live
resolution writes, the id counters a tab would need if it inherited the simulator, and
finally the numbers rendered in two different tabs' DOMs. It caught two real bugs: a live
ticket resolved in a *later* tick never had its patch broadcast, so followers held the open
version forever; and the leader ignored CSV uploads, which are the one message that travels
follower→leader because the file only exists in the tab it was dropped on.

`appcheck.mjs` guards `app.html` against regressing to hard-coded data — the ids on its
cards must be engine insight ids, its connector counts must equal real record counts, and
the NPS decline must be legible in the trend line rather than lost in noise.

`browsercheck.mjs` exists because `synccheck` **injects** leadership, so it never executes
the branch a browser actually takes: `navigator.locks.request` resolves *asynchronously*,
after `createStore` has returned and already sent its `hello`. That gap is not cosmetic —
under injection tab A is the writer before tab B exists, whereas in Chrome both tabs can be
alive, both can have asked for a snapshot, and neither is yet the writer. So this harness
gives Node a spec-shaped Web Locks manager and removes every injection point: real
`BroadcastChannel`, real async election, real handshake, releasing a lock standing in for
closing a tab. It then mounts NorthDesk and OpsPulse in two separate tabs and asserts the
requirement literally — **the numbers on the two screens match, and an action on either
screen reaches the other**: pause from the OpsPulse toolbar stops NorthDesk (and NorthDesk's
own button flips to "Resume"), a CSV dropped on OpsPulse appears in NorthDesk's queue, and
"New data" on either rebuilds both.

`chatcheck.mjs` covers the one surface where a stranger types free text: the Rio widget. A
rendering bug there is obvious, but a question that quietly lands on the *pricing* answer
instead of the *security* answer is not, and clicking around will never find it. So it drives
**126 real-world phrasings** through the matcher and asserts the topic each one reaches, walks
the eight-lesson course, checks that follow-ups like "why?" attach to the previous answer, and
asserts the guardrails decline source code and prompt probes. It also walks every answer the
corpus produces looking for claims the product is not allowed to make about itself — an
unearned certification, a guarantee of accuracy, a dollar figure attached to compliance — because
a chatbot that promises SOC 2 undoes the Trust page above it. It caught a dozen real
misroutings, including `"what does it cost"` landing on the *uncosted-compliance* answer,
because the key `"not costed"` stems to the same token as `"cost"`.

`mcpcheck.mjs` does not call the tool functions — the failure mode a hand-rolled protocol
invites is passing your own tests and failing a real client. It **spawns `mcp/server.js` as a
child process** and drives a real handshake over a real pipe, then does the same over HTTP
against `mcp/http.js` and asserts the two transports agree. It checks the shapes a client
depends on (`tools/call` returns a content *array*; a bad argument comes back as `isError`
inside a *successful* result, because a JSON-RPC error would abort a model's turn;
notifications produce no reply) and that **stdout carries protocol bytes and nothing else** —
one stray `console.log` there is enough to kill a client's parser, and it is the easiest
mistake to make in a stdio server. Then the part that matters: every retrieved `record_id`
must resolve to a record that exists, every printed dollar range must re-multiply from its
printed inputs, and compliance exposure must still refuse to carry a number.

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

## Analytics ranges

Presets are 7 / 30 / 90 days. Alongside them is a **custom window**: two date
fields, clamped to the dataset, that recompute every chart over exactly that span.
The presets answer *"how have the last N days gone"*; a custom window answers
*"what happened around the refund policy change"*, which is the question someone
actually opens the screen with. Picking the dates back-to-front is silently
corrected rather than rejected.

Two things the date handling has to get right, and both were wrong first:
dates are formatted from **local** components, because `toISOString()` is UTC and
east of Greenwich that made the latest selectable date a day earlier than the last
point on the chart; and a date maps to its day index by **rounding**, because across
a DST change two midnights are 23 or 25 hours apart and flooring drops a day.
`appcheck.mjs` round-trips all 90 days to keep both honest.

---

## Executive Copilot

Offline build, so answers are **templated NLG over the engine's computed insight objects** —
not a language model. Every number in every answer is traceable to a record, it links
straight into the relevant drill-down, and when it does not have a grounded answer it says so
instead of guessing. (Swapping in a real model means feeding it the same insight objects; the
grounding layer is the part that matters.)

---

## An agent can drive this — MCP

The Copilot answers the questions it was built for. **`mcp/` exposes the same engine as tools
any LLM can call**, so the questions stop being a fixed list:

```bash
node mcp/http.js                     # then open /mcp-inspector.html
node mcp/server.js                   # stdio, for Claude Desktop / Claude Code
node tools/mcpcheck.mjs              # 79 checks
```

Seven read-only tools. There is no reseed, no resolve, no write of any kind — an agent
inspecting an operation should not be able to change it.

| | |
|---|---|
| `describe_operation` | Window, record counts, release timeline, declared thresholds |
| `get_executive_brief` | The diversity-aware top 3 and the narrative |
| `list_insights` | The full ranked feed |
| `explain_insight` | Evidence, decomposition, confidence parts, **impact arithmetic** |
| `search_evidence` | BM25 over ticket text, NPS verbatims and QA notes |
| `get_metric_series` | Daily inflow / backlog / throughput |
| `get_health` | Health score and its four dimensions, with drivers |

**The division of labour is the point.** Detection stays arithmetic; the model chooses which
finding matters and says it in English. Nothing here asks a model to compute a number, and
the three credibility rules are carried into the tool payloads rather than left behind:

- `explain_insight` returns the **formula, the rounded inputs and the basis lines in the same
  payload as the range**, so a model physically cannot quote the range without its derivation.
- Compliance exposure comes back `costed: false` with the reason, and the server's
  `instructions` tell the model not to estimate one.
- `get_metric_series` returns the series the dataset already computed. It does **not** re-slice
  the tickets with its own bucketing — a second aggregation is exactly how a tool answer starts
  disagreeing with the chart on screen.

**`search_evidence` is retrieval, and every passage carries the id of the record it came from.**
A quote with no `ticket_id` behind it is the thing this codebase refuses to produce, so a
passage that cannot be traced is not returned. BM25 rather than embeddings: no model, no vector
store, no network call, ~2ms over 11,100 passages, and the ranking is inspectable. Retrieval
answers *"what are customers actually saying"*; it deliberately cannot tell you whether a change
is significant, and the tool description says so — that is what the insights are for.

The protocol is hand-rolled (`mcp/rpc.js`, ~150 lines) for the same reason the charts are
hand-rendered SVG: nothing to install. `mcp/server.js` speaks stdio, `mcp/http.js` speaks HTTP,
and both hand the same messages to the same handler — `mcpcheck` asserts the two transports
return byte-identical results, so there is no second implementation to keep in sync.

To wire it into Claude Desktop or Claude Code, add:

```json
{
  "mcpServers": {
    "opspulse": {
      "command": "node",
      "args": ["/absolute/path/to/agent/mcp/server.js"],
      "env": { "OPSPULSE_SEED": "20260724" }
    }
  }
}
```

One world per process — the dataset rebuilds deterministically from `OPSPULSE_SEED`, so an
agent halfway through a line of questioning never has the ground shift under it.

---

## Project structure

```
demo.html               Live Ops Floor — both apps, one store  ← start here
opspulse.html           OpsPulse standalone
servicedesk.html        NorthDesk standalone
app.html                Ops Copilot — the original single-screen dashboard, now store-backed
mcp-inspector.html      MCP client in the browser — drives the real handshake
index.html              Marketing site
roadmap.html            Technical roadmap

mcp/
  tools.js              The seven read-only tools over the live engine
  retrieve.js           BM25 index + search — every passage carries its record id
  rpc.js                MCP over JSON-RPC 2.0, transport-agnostic
  server.js             stdio transport (Claude Desktop / Claude Code)
  http.js               HTTP transport + static file server — one process, one port

data/
  rng.js                Seeded PRNG — the whole dataset rebuilds from one integer
  generator.js          90 days of history + the four injected patterns + live factories
  store.js              One store, two clocks (cheap tick / throttled engine pass)
  sync.js               One writer, many tabs — leader election + visibility handoff
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
  app.js                Ops Copilot renderers (unchanged) over store-backed data
  app-data.js           Insight objects → the shapes app.js and analytics.js render
  analytics.js          The charts view; its one data function is now injectable
  live.css              Both apps (container queries, so the split view needs no second sheet)
tools/
  verify.mjs            Engine acceptance test
  uicheck.mjs           Headless UI test (needs jsdom)
  synccheck.mjs         Cross-tab sync test (needs jsdom)
  appcheck.mjs          app.html data-provenance test (needs jsdom)
  browsercheck.mjs      Real navigator.locks path, both directions (needs jsdom)
  mcpcheck.mjs          MCP over a real pipe + both transports (needs jsdom)
  chatcheck.mjs         Rio's routing corpus + guardrails (needs jsdom)
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
  deterministically. Storing 11,600 records would blow the ~5MB localStorage quota. The live
  tail is not persisted — it travels between open tabs over `BroadcastChannel`, and a full
  reload starts a fresh one.
- **Statistics:** time-to-resolve is generated lognormal and behaves like it — across the
  dataset the mean is ~49h and the median ~3h — so every resolution-time figure is a median.
  Outcome metrics (SLA, CSAT) are bucketed by the day a ticket **closed**, not the day it
  opened: bucketing on creation looks natural and quietly flatters the recent end, because of
  tickets opened yesterday only the already-closed ones have an outcome, and those are the
  fast ones.
- **"New data"** in the OpsPulse toolbar reseeds the whole operation — different companies,
  agents, tickets and numbers, with the same four patterns still detectable.
- All data is simulated. This is a prototype.

---

*© 2026 OpsPulse AI · Prototype.*
