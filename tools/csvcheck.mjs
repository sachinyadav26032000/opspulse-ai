/* ==========================================================================
   csvcheck.mjs — the ten fixture files, through the REAL upload path
   --------------------------------------------------------------------------
   The ninth harness, and the only one that exercises `store.ingestCsv`
   end-to-end against files on disk rather than calling the mappers directly.
   That distinction matters: the bug that started this work — a CRM export
   being ingested as invented tickets — lived in the seam BETWEEN detectKind,
   the two-column floor in store.js and the mapper. Every one of those parts
   was individually fine.

   `fixtures/csv/` is ten files covering the six shapes the parser reads plus
   the four failure modes it has to refuse. They are also genuinely useful as
   sample files: a prospect who wants to see the upload work without exporting
   their own book can drop these in.

   Each file declares what it must do. A file that ingests as the WRONG shape
   is the failure this harness exists to catch, so `expect.kind` is asserted
   before anything else.

   Run:  npm install --no-save jsdom && node tools/csvcheck.mjs
   ========================================================================== */
import { JSDOM } from 'jsdom';
import { readFileSync, readdirSync } from 'node:fs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/opspulse.html', pretendToBeVisual: true,
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.Event = window.Event;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };

const rel = (p) => new URL(p, import.meta.url).href;
const dir = new URL('../fixtures/csv/', import.meta.url).pathname;
const { createStore } = await import(rel('../data/store.js'));

let pass = 0; const fails = [];
const g = (s) => `\x1b[32m${s}\x1b[0m`, r = (s) => `\x1b[31m${s}\x1b[0m`, dim = (s) => `\x1b[2m${s}\x1b[0m`;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`    ${g('PASS')} ${label}${detail ? dim('  · ' + detail) : ''}`); }
  else { fails.push(label + (detail ? ' — ' + detail : '')); console.log(`    ${r('FAIL')} ${label}  ${detail}`); }
};

/* What each fixture must do. `accepted: false` files are the point of the set
   as much as the others: refusing a file correctly is a feature. */
const EXPECT = {
  '01-tickets-kaggle.csv':  { kind: 'ticket',  accepted: true,  appends: true },
  '02-tickets-zendesk.csv': { kind: 'ticket',  accepted: true,  appends: true },
  '03-qa-reviews.csv':      { kind: 'qa',      accepted: true,  appends: true },
  '04-nps-responses.csv':   { kind: 'nps',     accepted: true,  appends: true },
  '05-crm-accounts.csv':    { kind: 'crm',     accepted: true,  joins: true },
  '06-crm-mrr.csv':         { kind: 'crm',     accepted: true,  joins: true },
  '07-billing-invoices.csv':{ kind: 'billing', accepted: true,  joins: true },
  '08-usage-weekly.csv':    { kind: 'usage',   accepted: true,  joins: true },
  '09-crm-unmatched.csv':   { kind: 'crm',     accepted: false },
  '10-unknown-shape.csv':   { kind: 'unknown', accepted: false },
};

console.log('\n=== CSV fixtures through the real upload path ===\n');

const store = createStore({ seed: 1234, asOf: Date.parse('2026-03-12T09:00:00Z'), fresh: true, autoStart: false });
const files = readdirSync(dir).filter((f) => f.endsWith('.csv')).sort();
ok('all ten fixtures are present', files.length === 10, `${files.length} files`);

const results = [];
for (const f of files) {
  const exp = EXPECT[f];
  console.log(`\n\x1b[1m${f}\x1b[0m ${dim('→ expects ' + exp.kind + (exp.accepted ? '' : ', refused'))}`);
  const before = {
    tickets: store.dataset.tickets.length, nps: store.dataset.nps.length, qa: store.dataset.qa.length,
    accounts: store.dataset.accounts.length,
  };
  let res, threw = null;
  try { res = store.ingestCsv(readFileSync(dir + f, 'utf8')); } catch (e) { threw = e; }
  ok('ingest did not throw', !threw, threw?.message || '');
  if (threw) continue;

  ok(`detected as '${exp.kind}'`, res.kind === exp.kind, `got '${res.kind}'`);
  ok(exp.accepted ? 'accepted' : 'refused, with a reason',
    res.ok === exp.accepted, res.ok ? `added ${res.added ?? 0}` : res.error);

  const after = {
    tickets: store.dataset.tickets.length, nps: store.dataset.nps.length, qa: store.dataset.qa.length,
    accounts: store.dataset.accounts.length,
  };
  /* The invariant that makes the account the primary object: an upload may
     enrich the book, never grow it. */
  ok('no account was invented by the upload', after.accounts === before.accounts,
    `${before.accounts} → ${after.accounts}`);

  if (exp.appends) {
    const grew = (after.tickets - before.tickets) + (after.nps - before.nps) + (after.qa - before.qa);
    ok('event rows were appended', grew === res.added && grew > 0, `${grew} rows`);
  }
  if (exp.joins) {
    ok('joined onto accounts rather than appending events',
      res.joined === true && after.tickets === before.tickets && after.nps === before.nps && after.qa === before.qa,
      `${res.accounts_matched} accounts matched`);
  }
  results.push({ file: f, kind: res.kind, ok: res.ok, added: res.added ?? 0,
    matched: res.accounts_matched ?? 0, via: res.joined_via, reasons: res.unmatched_reasons, error: res.error });
}

/* ── What the joins actually did to the book ──────────────────────────────── */
console.log('\n\x1b[1mThe book after all ten files\x1b[0m');
const byId = new Map(store.dataset.accounts.map((a) => [a.account_id, a]));
const a1 = byId.get('AC0001');
ok('CRM ARR landed on the account', a1.arr_usd === 265000, `$${a1.arr_usd.toLocaleString()}`);
ok('CRM owner landed on the account', a1.csm === 'Priya Raman', a1.csm);
ok('CRM seats landed on the account', a1.seats === 180, `${a1.seats}`);
ok('billing aggregated per account', a1.billing?.invoices === 3, JSON.stringify(a1.billing));
ok('a paid invoice was not counted overdue', a1.billing?.overdue_invoices === 2, `${a1.billing?.overdue_invoices} of 3`);
ok('usage became a series, oldest first despite file order',
  JSON.stringify(a1.usage_weeks) === JSON.stringify([171, 158, 140, 92]), JSON.stringify(a1.usage_weeks));
const a7 = byId.get('AC0007');
ok('MRR was derived to ARR rather than read as-is', a7.arr_usd === 90000, `$7,500 mrr → $${a7.arr_usd.toLocaleString()} arr`);

/* ── The engine over the enriched book ────────────────────────────────────── */
console.log('\n\x1b[1mThe engine, over the book these files built\x1b[0m');
const e = store.engine;
ok('the insight contract still validates', e.run.contract_valid, e.run.contract_errors.slice(0, 2).join('; '));
ok('billing is now a present source', e.run.sources.present.billing === true,
  `missing: [${e.run.sources.missing}]`);
ok('every insight names accounts with money attached',
  e.insights.every((i) => i.named_accounts.every((n) => n.company && n.arr_usd !== undefined)));

console.log('\n\x1b[1mResults table\x1b[0m');
console.log(dim('  file                        kind      verdict   rows  accts  join'));
for (const x of results) {
  const verdict = x.ok ? g('accepted') : r('refused ');
  const join = x.via ? Object.entries(x.via).map(([k, v]) => `${k}:${v}`).join(' ') : '';
  console.log(`  ${x.file.padEnd(27)} ${x.kind.padEnd(9)} ${verdict}  ${String(x.added).padStart(4)}  ${String(x.matched).padStart(5)}  ${join}`);
  if (!x.ok) console.log(dim(`      ↳ ${x.error}`));
  if (x.reasons && Object.keys(x.reasons).length) console.log(dim(`      ↳ refusals: ${JSON.stringify(x.reasons)}`));
}

store.close();
console.log('');
if (fails.length) { console.log(r(`${fails.length} CHECK(S) FAILED`) + `  (${pass}/${pass + fails.length})`); process.exit(1); }
console.log(g('ALL CSV FIXTURE CHECKS PASSED') + `  (${pass}/${pass})`);
