# CSV fixtures

Ten small files that exercise the upload path end to end. `tools/csvcheck.mjs` runs all
ten through the real `store.ingestCsv` and asserts what each one must do.

They are also sample files: drop one into the Data Upload screen to see the ingest work
without exporting your own book.

| File | Shape | Must |
|---|---|---|
| `01-tickets-kaggle.csv` | ticket | Ingest under the canonical Kaggle headers |
| `02-tickets-zendesk.csv` | ticket | Ingest under entirely different column names |
| `03-qa-reviews.csv` | qa | Ingest with `review_id` / `agent` / `qa_score` aliases |
| `04-nps-responses.csv` | nps | Ingest with `comment` / `theme` / `response_date` aliases |
| `05-crm-accounts.csv` | crm | **Join** onto existing accounts; set ARR, renewal, owner, seats |
| `06-crm-mrr.csv` | crm | Derive ARR from an MRR column (× 12), never read it as ARR |
| `07-billing-invoices.csv` | billing | Aggregate per account; count overdue, not "unpaid"-as-paid |
| `08-usage-weekly.csv` | usage | Become a weekly series, oldest first, despite reverse file order |
| `09-crm-unmatched.csv` | crm | Be **refused** — unknown ids and an ambiguous company name |
| `10-unknown-shape.csv` | unknown | Be **refused** rather than assumed to be tickets |

The last two matter as much as the first eight. Refusing a file correctly is a feature:
before `detectKind` learned to return `'unknown'`, a CRM export was ingested as a page of
invented Open tickets with its ARR discarded.

## Two bugs these fixtures found

Both were caught the first time the set was run, and neither was visible from reading the
code — they lived in the seam between `detectKind`, the column floor in `store.js` and the
mappers, which is why this harness drives the real ingest entry point rather than calling
the mappers directly.

- **`num()` returned `0` for a missing value.** `Number('')` is 0, so every `?? fallback`
  in `csv.js` was unreachable and every `score == null` guard was dead code. An uploaded
  ticket file with no first-response column reported a perfect 0-minute response on every
  row; a QA file whose score column did not resolve ingested every review as 0 and
  manufactured a coaching gap. `num()` now returns `null` for anything unreadable.
- **`"unpaid"` contains `"paid"`.** The settled test was an unanchored regex, so every
  unpaid invoice was read as settled and dropped out of the overdue count — the one number
  the billing stream exists to produce. The test is word-anchored now.

## Account ids

`AC0001`–`AC0009` exist in every generated book regardless of seed, because ids are
positional. Company names are **not** stable across seeds, which is why the account files
join on id. That is also the honest default: in the sample book 372 of 383 distinct company
names are shared by more than one account, so a name-only join usually should refuse.
