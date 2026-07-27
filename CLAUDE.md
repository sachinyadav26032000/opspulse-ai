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

**After any change to `data/`, `engine/`, `assets/`, or `mcp/`, run all six.** Not a sample.

```bash
node tools/verify.mjs        # 67 — engine finds the patterns, 5 seeds × 4 calendar positions
npm install --no-save jsdom  # prerequisite for all but verify and mcpcheck
node tools/uicheck.mjs       # ~78 — both apps render in jsdom
node tools/synccheck.mjs     # 36 — three stores, one real BroadcastChannel
node tools/appcheck.mjs      # 34 — app.html reads the store, not a mock
node tools/browsercheck.mjs  # 29 — the real navigator.locks path, both directions
node tools/mcpcheck.mjs      # 79 — MCP over a real pipe and over HTTP
```

Roughly **325 checks**. Five totals are fixed; **`uicheck` floats by a few from day to day**
because it drills into every insight the engine produced and how many clear the thresholds
depends on where `Date.now()` falls in the window. A changed `uicheck` total is *not* by itself
a regression — **a failure is.** Do not "fix" a count mismatch by editing the harness.

`mcpcheck` binds port **5599**, so it runs fine alongside a server already on 5500.

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
