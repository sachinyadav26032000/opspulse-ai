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

*(Populated in Task 1.)*

---

## External signals

*(Populated in Task 2.)*

---

## Outcome / decision lifecycle

*(Populated in Task 3.)*
