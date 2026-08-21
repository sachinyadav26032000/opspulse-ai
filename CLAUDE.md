# CLAUDE.md — working rules for this repo

Instructions for an agent editing OpsPulse AI. **This file is constraints, not documentation.**
`README.md` explains what the product is and why it is built this way; read it for context.
Read this one for what you must not break.

---

## 1. What this is, in one paragraph

OpsPulse AI is an AI decision engine for operations leaders: a CX director opens it and the
first thing on screen is *"here are your top 3 operational risks and what to do about them."*
It is a dependency-free HTML/CSS/vanilla-ESM prototype with no build step. All data is
simulated. Four apps — `servicedesk.html` (NorthDesk, the source system), `opspulse.html` (the
decision engine), `demo.html` (both side by side), `app.html` (Ops Copilot) — read **one shared
store**, so they cannot disagree. `mcp/` exposes the same engine as tools an agent can call.

---

## 2. Run it

```bash
node mcp/http.js          # apps AND the MCP endpoint, one process, one port → :5500
```

ES modules are blocked on `file://`, so the apps **must** be served over http. A plain static
server (`serve.cmd`, `serve.sh`, `python -m http.server 5500`) still serves the apps but cannot
answer JSON-RPC, so `mcp-inspector.html` will report the endpoint unreachable. That is the only
difference.

---

## 3. The three credibility rules — non-negotiable

This codebase exists to make numbers a skeptical executive cannot dismiss. Every rule below is
enforced by a harness. **Do not weaken one to make a change easier.**

1. **Dollar impact is a range with its arithmetic shown.** Inputs are rounded to display
   precision *before* the range is computed, so the printed inputs genuinely multiply out to
   the printed range. `tools/verify.mjs` re-multiplies and fails the build otherwise. Never
   print a single-point dollar figure, and never round after computing.

2. **Compliance exposure stays deliberately uncosted.** A fabricated fine probability would be
   the least defensible number on the page. It returns `costed: false`. Do not add a dollar
   figure to it, however reasonable the estimate seems.

3. **Card face and the chart behind it read through the same `engine/web/aggregate.js`
   functions.** Never re-slice data for a chart. If a number appears in two places, it must
   come from one call, or the two will drift.

Related, and equally load-bearing:

- **Root cause is labelled a hypothesis, not a finding.** Confidence = 45% statistical + 30%
  explained-by-top-driver + 25% corroboration. Anything under 60% is held for review, not
  actioned. Do not raise a confidence score to clear the bar.
- **Every retrieved passage carries its `record_id` or it is not returned.** An unattributable
  quote is worse than no quote.

---

## 4. Detection is arithmetic. The language layer only explains.

The engine finds patterns **statistically** — it never looks up a known answer. Four patterns
are injected into the generated data and must be *discovered*: refund escalation spike
(~3.2× baseline, blast radius exactly **231** accounts), new-hire QA decline (~18 pts),
onboarding surge (~1.7×), backlog growth (~230→430). The NPS drop is emergent, not injected.
Two releases sit a day apart deliberately, so root-cause must pick the *relevant* event rather
than the *recent* one.

`engine/llm.js` is a **deliberate stub** that throws. The Executive Copilot is templated NLG
over insight objects, not an LLM. If an LLM is ever added it belongs in the explain layer only
— **never in detection, ranking, or costing.** A generated number is a fabricated number.

---

## 5. Verification is the acceptance test

**After any change to `data/`, `engine/`, `assets/`, or `mcp/`, run all eight.** Not a sample.

```bash
node tools/verify.mjs        # 67 — engine finds the patterns, 5 seeds × 4 calendar positions
npm install --no-save jsdom  # prerequisite for all but verify and mcpcheck
node tools/uicheck.mjs       # ~78 — both apps render in jsdom
node tools/synccheck.mjs     # 36 — three stores, one real BroadcastChannel
node tools/appcheck.mjs      # 34 — app.html reads the store, not a mock
node tools/browsercheck.mjs  # 29 — the real navigator.locks path, both directions
node tools/mcpcheck.mjs      # 79 — MCP over a real pipe and over HTTP
node tools/chatcheck.mjs     # 61 — Rio routes 140 real phrasings to the right topic
node tools/principlecheck.mjs # 72 — the five product principles of §6b, as assertions
```

Roughly **440 checks**. Seven totals are fixed; **`uicheck` floats by a few from day to day**
because it drills into every insight the engine produced and how many clear the thresholds
depends on where `Date.now()` falls in the window. A changed `uicheck` total is *not* by itself
a regression — **a failure is.** Do not "fix" a count mismatch by editing the harness.

`mcpcheck` binds port **5599**, so it runs fine alongside a server already on 5500.

`chatcheck` is the one to run after *any* edit to `assets/chat.js`, including a pure copy edit.
Its routing corpus is the only thing standing between a new topic and the questions it silently
steals from an existing one — adding a key like `"cost"` to a topic that is not pricing is a
one-word change that quietly misroutes every "what does it cost". If a corpus line fails,
**fix the keys, not the expectation.**

---

## 6. Constraints that are easy to violate by accident

**Zero dependencies, no build step.** There is no root `package.json`, and this is deliberate.
`data/package.json` and `engine/web/package.json` exist *only* as ESM scope markers so Node
treats those browser modules as ES modules — they are not real packages. `jsdom` is installed
with `--no-save` for the harnesses and is gitignored. **Adding a dependency is a decision to
escalate to the user, not one to make.**

**`engine/` is superseded by `engine/web/`.** The top-level `engine/` is the original CommonJS
5-agent version, kept for reference. `engine/web/` is the live ESM engine that runs in both the
browser and Node. **Edit `engine/web/`.** This is the single easiest way to silently do nothing.

**Cross-tab sync has non-obvious invariants** (`data/sync.js`). The leader broadcasts actual
records, never PRNG replay commands — a dropped message would otherwise diverge tabs silently
and permanently. Followers re-run the engine against the **leader's `as_of`**, never their own
clock. `upload` is the one message travelling follower→leader, so it must **not** be guarded by
`isLeader`. `lockHolder` (navigator.locks) and `leader` (who actually ticks) are separate roles
on purpose, because browsers throttle hidden-tab timers to ~1/min.

**Two clocks, on purpose.** Cheap tick ~3.2s; throttled full engine pass ~9s, so the top-3 never
flickers mid-read. But the **KPI strip repaints on every tick**, because those are the figures
NorthDesk also shows and a 9s lag made the two panes visibly disagree.

**Statistics gotchas already fixed — do not regress them** (`assets/app-data.js`): time-to-
resolve is lognormal (mean ~49h vs median ~3h), so every resolution-time figure is a **median**.
Outcome metrics (SLA, CSAT) bucket by the day a ticket **closed**, not opened — bucketing on
creation quietly flatters the recent end, because only already-closed tickets have an outcome
and those are the fast ones. Daily NPS off 6–18 responses swings ±70, so NPS uses a 7-day
trailing window.

**MCP tools are read-only.** All seven. Do not add a mutating tool without asking.

**Say what is built, in the tense it is built in.** The site calls this a **functional MVP**, not
a prototype, because the engine, the detectors, the ingest path and the ledger all run — and the
pitch deck says the same, so the two must not drift. Two claims are load-bearing and easy to
overstate in either direction:

- **Sources.** The engine reads tickets and escalations, QA, NPS, weekly active seats, account
  contract facts and external events. It does **not** read telephony — there is no call data in
  this build, `calls_transcribed` is structurally zero, and the contact-centre panel renders
  locked on *every* tier for that reason. The **CSV upload reads six shapes** — tickets, QA, NPS,
  CRM/account, billing and product usage. "What the engine reads" and "what one export carries"
  are still different sentences: one helpdesk file gives support-shaped findings, and it takes a
  CRM file to put ARR, a renewal date and an owner on them.
- **External signals** (`#external` on `index.html` and `roadmap.html`) are the strongest claim
  on the site and the easiest to get wrong. The schema, panel, entitlement gate, query path and
  provenance rendering are **built and running**; the licensed feed is **not** — records are
  seeded fixtures carrying `seeded: true` and a NULL `source_url`, rendered with a *sample* badge
  because a fabricated link to a real news domain is a citation that does not exist. And an
  external event **surfaces against the account without moving the risk score**; fusion is a
  roadmap item. `chatcheck` pins all three of these.

**Rio (`assets/chat.js`) is the honesty rule applied to the marketing surface.** It is a
knowledge base plus a matcher, not a model, and that is the whole point: a sales bot that
improvises a price, an integration or a certification is the failure mode this product is sold
against. Four things must not be weakened.

- **No model, no network, no key.** There is no backend on a static site, so an LLM call would
  ship a credential to the browser. If a real model is ever added it belongs behind a server,
  and it still may not invent a number. **Adding one is a decision to escalate, not to make.**
- **Every answer is authored and true against the site.** Thresholds and the confidence weights
  come from `trust.html`; the commercial position comes from the `#pricing` section of
  `index.html`. If you change a claim on a page, change it in Rio in the same commit or the two
  will disagree in front of a prospect. Note the in-app tier names and their
  `list_price_usd_month` (`config/entitlements.js`) are a **modelling input for the cost view**,
  never a price list — Rio says so explicitly rather than reconciling them silently.
- **There are no published prices, and Rio may not invent one.** The `$1,800 / $4,500 / Custom`
  cards were withdrawn pending pricing discovery; `#pricing` now publishes the *shape* (two axes
  — signal sources and ledger retention — and the deliberate non-axis, seats) and says plainly
  that the number is not set. A list price we have not tested is the marketing version of the
  fabricated fine probability §3.2 refuses to print. `chatcheck` asserts across the whole corpus
  that no monthly figure reappears anywhere. **Restoring prices is a decision to escalate.**
- **Design partner terms are agreed per partner and are not published.** The site previously
  promised the product "free through the partnership"; that promise is withdrawn, and `chatcheck`
  guards it. Do not reintroduce a price, a discount or a free tier for the programme.
- **The guardrails decline on purpose.** Source, infrastructure, credentials and customer data
  are refused; the published thresholds, the confidence formula and the refusal list stay open,
  because publishing those *is* the pitch. Guardrails are matched on whole phrases only —
  a wrong decline accuses the visitor of something, which is worse than a wrong answer.
- **Suggested questions appear exactly once**, with the opening line. Re-offering them after
  every answer turns a conversation into a menu and eats two rows of panel height on a phone.

Below the acceptance bar Rio names the nearest topics instead of guessing, and below *that* it
says it does not know and hands off to a human. **Do not lower the bar to reduce fallbacks** —
that trade is exactly the one the confidence floor in the engine refuses to make.

---

## 6b. The five product principles

These define what the product **is**, not how it is built, and each one is enforced by
`tools/principlecheck.mjs`. Each was written against a real defect found by probing the engine,
so the harness is a regression test, not a statement of intent. **Do not weaken one to make a
change easier** — the failure mode each prevents is named in the file.

1. **The upload path accepts multiple sources, joined on an account key.** Six shapes:
   tickets, QA, NPS (event streams, which append) and CRM, billing, usage (account streams,
   which **join**). `detectKind` returns `'unknown'` for anything it cannot place, and store.js
   refuses it. It must **never** fall back to `'ticket'` again: a CRM export used to clear the
   two-column floor and be ingested as invented Open tickets with its ARR thrown away.

2. **The account is the primary object, not the ticket.** ARR, renewal date and owner hang off
   the account; signals reference it. An account-shaped file must never become event rows, and
   an upload must never **create** an account — it joins on `account_id`, then on a normalised
   company name, and reports why a row did not match. An id join outranks a name join. Company
   name is a weak key by design: in the sample book 372 of 383 distinct names are shared by more
   than one account, so the name fallback usually *should* refuse.

3. **Every decision carries money and a name.** `expected_impact` is a range (§3.1) and
   `named_accounts` carries the top accounts by ARR with their renewal date and owner, **in the
   contract** — not in `_meta`, which is stripped when the wire contract is displayed. The one
   deliberate exception is compliance, which stays uncosted (§3.2) and outranks this rule.
   "47 tickets in the billing category" is a statistic; "six accounts worth $271k, owned by
   Priya" is a decision.

4. **Missing sources degrade, they never break.** `DETECTOR_SOURCES` declares what each detector
   needs; one with a missing source is reported `status: 'skipped'` with the stream named, never
   as a silent `found: 0`. Coverage sets a **ceiling** on confidence (`0.60 + 0.35 × coverage`).
   The ceiling only ever *lowers* a score — it can never lift a finding over the 60% floor. Note
   the three declared weights (45/30/25) are untouched by this and must stay untouched: they are
   computed from data that is present, which is exactly why they cannot see what is absent.

5. **What we do NOT build.** We do not fix their SLAs, clean their CRM, or replace Zendesk or
   Salesforce. We are a read layer that coexists with those tools. A prospect with no systems or
   no defined SLAs is not a customer, and we say so on the first call. Rio's `scope` topic is
   this rule on the marketing surface, and it must stay a plain no — before it existed, "do you
   replace Zendesk" reached the integrations answer and "will you fix our SLAs" reached the
   glossary definition of an SLA, both of which read as evasion.

---

## 7. Style

Match the surrounding code. This codebase has **unusually heavy explanatory comments** — block
comments explain *why* a non-obvious choice was made, not what the line does. Terse code here
is a deviation, not an improvement. Keep the same naming and idiom as the file you are editing.

`.gitattributes` pins **LF** in the repository for everything, with `*.cmd`/`*.bat` checked out
as **CRLF** (cmd.exe mis-parses LF-only files around `goto` labels and parenthesised if/else)
and `*.sh` always LF (a CRLF shebang produces "bad interpreter"). Do not change these.

`.claude/` and `node_modules/` are gitignored.

---

## 8. Verifying UI changes on this machine

The Claude-in-Chrome tools **cannot reach a local dev server here** — `navigate` reports success
while `location.href` is actually `chrome-error://chromewebdata/`. Do not burn turns retrying
ports or hosts. **Verify headlessly with jsdom instead** (that is what `tools/uicheck.mjs` does;
it has caught real bugs a screenshot would not have), then ask the user to open the page for the
visual check.
