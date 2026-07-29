# UI suites

`tools/verify.mjs` proves the **engine** is honest — the insight contract, the
impact arithmetic, pattern detection across seeds. These prove the **interface**
is: that the nav holds together, the drill spine goes down and back up, the
brief and the cohort agree on their numbers, and a threshold dial reaches the
detector it claims to.

```sh
cd tools/dom
npm install     # once — jsdom only
./run-all.sh
```

`run-all.sh` exits non-zero if any suite fails, and prints an assertion count
per suite.

## Two rules for whoever runs these next

**A suite that dies before asserting is not a pass.** The runner checks exit
codes *as well as* failure lines, and prints how many assertions each suite
actually made. This is not defensive over-engineering — the original sweep
grepped `'^ FAIL'` with a leading space while failures print at column 0, so it
matched nothing, reported every suite clean, and hid four genuinely failing
suites. A suite reporting `ok (0)` is telling you it asserted nothing.

**Selectors break for boring reasons; read the failure before "fixing" it.**
Most failures so far have been stale expectations rather than product bugs — a
nav item moving into the overflow menu, a brief card that now opens a different
surface, three seeds legitimately rounding to the same `$1M`. Check whether the
product changed on purpose before changing the assertion, and prefer selecting
by label over by index.

## The suites

| Suite | What it holds down |
|---|---|
| `nav` | four primary tabs, overflow menu, every view reachable |
| `today` | the morning brief: decision count, the protected figure, the greeting |
| `drill` | decision → exposed accounts → one account, and back |
| `cohort` | renewals × adoption: controls, scope levels, the working list |
| `briefcohort` | the cohort decision reaches the brief and agrees with the surface it opens |
| `churnreason` | the taxonomy, scored against the generator's hidden archetype |
| `thresholds` | config wiring, the dials, engine re-run on change |
| `render`, `layers`, `bands`, `band`, `align`, `density` | layout, hierarchy, content density |
| `explore` | the `explorations/` prototypes still load |

Each suite is standalone: it boots its own JSDOM and mounts `mountOpsPulse`.
There is no shared harness module, deliberately — a broken helper would take
every suite down at once, and these exist to be trustworthy when something else
is on fire.

## Not moved from the original scratchpad

`compare.mjs` and `opspulse-head.mjs` were a one-off before/after density
measurement against a frozen copy of a superseded `opspulse.js` (its nav still
had "Executive Copilot"). They asserted nothing, and committing a stale
duplicate of the whole app as a permanent fixture would rot on contact. If a
before/after measurement is wanted again, take the baseline from git rather
than from a checked-in copy.
