/* ==========================================================================
   principlecheck.mjs — the five product principles, as assertions
   --------------------------------------------------------------------------
   The eighth harness. The other seven check that the thing works; this one
   checks that the thing is still the product we said it was. Each block below
   is one of the five rules the product is defined by, written so that a change
   which quietly violates one fails here rather than in a demo.

   Every assertion in this file was written against a REAL defect found by
   probing the engine, not from reading it:

     1 · A CRM export was classified as ticket data, cleared the two-column
         floor in store.js, and was ingested as a page of invented Open
         tickets with its ARR, renewal date and owner discarded.
     2 · Account-keyed sources had no ingest path at all, so the account could
         not be the primary object of an upload.
     3 · The insight contract carried money but no names. Account ids existed
         only on `_meta`, the half explicitly stripped when the wire contract
         is displayed.
     4 · Every detector ran unconditionally and reported `found: 0` whether it
         had ran or had no data, and dropping an entire stream moved peak
         confidence by exactly nothing — it stayed at 0.95.
     5 · "Do you replace Zendesk" reached the integrations answer and "will you
         fix our SLAs" reached the glossary definition of an SLA.

   Run:  npm install --no-save jsdom && node tools/principlecheck.mjs
   ========================================================================== */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { generate } from '../data/generator.js';
import { runEngine } from '../engine/web/index.js';
import { parseCsv, detectKind, resolveColumns, mapAccounts, applyAccountPatches } from '../data/csv.js';

const AS_OF = Date.parse('2026-03-12T09:00:00Z');
const SEED = 1234;

let pass = 0; const fails = [];
const ok = (label, cond, detail) => {
  if (cond) { pass++; console.log('  \x1b[32mPASS\x1b[0m ' + label + (detail ? '\x1b[2m  ' + detail + '\x1b[0m' : '')); }
  else { fails.push(label + (detail ? '  — ' + detail : '')); console.log('  \x1b[31mFAIL\x1b[0m ' + label + (detail ? '  ' + detail : '')); }
};
const head = (t) => console.log('\n\x1b[1m' + t + '\x1b[0m');

const ingest = (ds, csv) => {
  const { headers, rows } = parseCsv(csv);
  const kind = detectKind(headers);
  const { map, matched } = resolveColumns(headers, kind);
  return { kind, matched, headers, rows, map };
};

/* ── 1 · The upload path accepts multiple sources ─────────────────────────
   Not one ticket file. Several, joined on an account key. */
head('1 — Multiple sources, joined on an account key');
{
  const ds = generate(SEED, AS_OF);
  const a = ds.accounts.slice(0, 3);

  const SHAPES = {
    ticket:  ['Ticket ID', 'Customer Name', 'Ticket Status', 'Ticket Priority', 'Ticket Subject'],
    qa:      ['qa_id', 'agent_name', 'overall_score', 'reviewer'],
    nps:     ['response_id', 'score', 'verbatim', 'submitted_at'],
    crm:     ['account_id', 'company', 'arr_usd', 'renewal_date', 'owner'],
    billing: ['account_id', 'invoice_id', 'amount_usd', 'due_date', 'paid_at', 'status'],
    usage:   ['account_id', 'week', 'active_seats', 'contracted_seats'],
  };
  for (const [want, headers] of Object.entries(SHAPES)) {
    ok(`a ${want} export is recognised as ${want} data`, detectKind(headers) === want, `got '${detectKind(headers)}'`);
  }
  /* The original defect: 'ticket' was the unconditional fallback, so anything
     unrecognised became tickets. A file we cannot place must be refused. */
  ok('an unplaceable file is refused rather than assumed to be tickets',
    detectKind(['foo', 'bar', 'baz']) === 'unknown', `got '${detectKind(['foo', 'bar', 'baz'])}'`);

  const crm = ['account_id,company,arr_usd,renewal_date,owner',
    ...a.map((x, i) => `${x.account_id},${x.company},${250000 + i * 1000},2026-09-30,Priya Raman`)].join('\n');
  const p = ingest(ds, crm);
  const r = mapAccounts(p.rows, p.map, ds, p.kind);
  applyAccountPatches(ds, r.patches);
  ok('a CRM export joins onto accounts already in the book', r.patches.length === 3, `${r.patches.length} patched`);
  ok('CRM ARR lands on the account', a[0].arr_usd === 250000, `$${a[0].arr_usd}`);
  ok('CRM owner lands on the account', a[0].csm === 'Priya Raman', a[0].csm);
  ok('CRM renewal date becomes days-to-renewal', a[0].renewal_in_days === Math.round((Date.parse('2026-09-30') - AS_OF) / 86400000), `${a[0].renewal_in_days}d`);

  const bill = ['account_id,invoice_id,amount_usd,due_date,paid_at,status',
    `${a[0].account_id},INV-1,12000,2026-01-10,,overdue`,
    `${a[0].account_id},INV-2,5000,2026-01-05,2026-01-04,paid`].join('\n');
  const pb = ingest(ds, bill);
  applyAccountPatches(ds, mapAccounts(pb.rows, pb.map, ds, pb.kind).patches);
  ok('billing rows aggregate per account', a[0].billing?.invoices === 2, JSON.stringify(a[0].billing));
  ok('a paid invoice is not counted as overdue', a[0].billing?.overdue_invoices === 1, `${a[0].billing?.overdue_invoices} overdue`);

  const use = ['account_id,week,active_seats,contracted_seats',
    `${a[0].account_id},2026-03-02,90,180`, `${a[0].account_id},2026-01-05,170,180`, `${a[0].account_id},2026-02-02,140,180`].join('\n');
  const pu = ingest(ds, use);
  applyAccountPatches(ds, mapAccounts(pu.rows, pu.map, ds, pu.kind).patches);
  ok('usage rows become a weekly series, oldest first regardless of file order',
    JSON.stringify(a[0].usage_weeks) === JSON.stringify([170, 140, 90]), JSON.stringify(a[0].usage_weeks));

  /* The join must refuse rather than guess. Company name is a far weaker key
     than it looks: most names in the book are shared by several accounts. */
  const ds2 = generate(SEED, AS_OF);
  const bad = ['account_id,company,arr_usd', 'AC9999,Nonexistent Corp,50000'].join('\n');
  const pbad = ingest(ds2, bad);
  const rbad = mapAccounts(pbad.rows, pbad.map, ds2, pbad.kind);
  ok('an unknown account is never created from an upload', rbad.patches.length === 0);
  ok('the refusal says which kind of failure it was',
    rbad.reasons.unknown_account_id === 1, JSON.stringify(rbad.reasons));
  ok('an account-id join outranks a company-name join', (() => {
    const d = generate(SEED, AS_OF); const t = d.accounts[0];
    const csv = ['account_id,company,arr_usd', `${t.account_id},${t.company},200000`, `,${t.company},99999`].join('\n');
    const pp = ingest(d, csv);
    applyAccountPatches(d, mapAccounts(pp.rows, pp.map, d, pp.kind).patches);
    return t.arr_usd === 200000;
  })());
}

/* ── 2 · The account is the primary object ───────────────────────────────── */
head('2 — The account is the primary object, not the ticket');
{
  const ds = generate(SEED, AS_OF);
  const a = ds.accounts[0];
  for (const f of ['account_id', 'company', 'arr_usd', 'renewal_in_days', 'csm']) {
    ok(`every account carries ${f}`, ds.accounts.every((x) => x[f] !== undefined));
  }
  /* The inversion this guards against: an account-shaped file becoming events. */
  const crmHeaders = ['account_id', 'company', 'arr_usd', 'renewal_date', 'owner'];
  ok('an account-shaped file never becomes ticket rows', detectKind(crmHeaders) !== 'ticket');
  const before = ds.tickets.length;
  const p = ingest(ds, ['account_id,company,arr_usd,renewal_date,owner', `${a.account_id},${a.company},250000,2026-09-30,Priya`].join('\n'));
  applyAccountPatches(ds, mapAccounts(p.rows, p.map, ds, p.kind).patches);
  ok('ingesting account data appends no events', ds.tickets.length === before, `${before} → ${ds.tickets.length}`);
  ok('signals hang off the account', ds.tickets.every((t) => 'account_id' in t));
}

/* ── 3 · Every decision carries money and a name ─────────────────────────── */
head('3 — Every decision carries money and a name');
{
  const out = runEngine(generate(SEED, AS_OF));
  ok('the engine produced insights', out.insights.length > 0, `${out.insights.length}`);
  ok('the insight contract validates', out.run.contract_valid, out.run.contract_errors.slice(0, 2).join('; '));

  for (const i of out.insights) {
    const ei = i.expected_impact;
    /* Compliance is the one deliberate exception, and it is deliberate in the
       other direction: it returns NO dollar figure rather than a fabricated
       one. That rule outranks this principle and must not be "fixed". */
    if (i.signal_type === 'compliance_risk') {
      ok('compliance exposure stays uncosted', ei.range_low_usd === null && ei.range_high_usd === null);
    } else {
      ok(`${i.signal_type} carries a money RANGE, never a point figure`,
        typeof ei.range_low_usd === 'number' && typeof ei.range_high_usd === 'number' && ei.range_low_usd <= ei.range_high_usd,
        `${ei.range_low_usd}–${ei.range_high_usd}`);
    }
  }
  const named = out.insights.filter((i) => i.named_accounts.length > 0);
  ok('insights name the accounts they are about, in the contract',
    named.length === out.insights.length, `${named.length}/${out.insights.length}`);
  ok('a named account carries its own ARR, renewal and owner',
    named.every((i) => i.named_accounts.every((a) => a.company && a.arr_usd !== undefined && a.renewal_in_days !== undefined && 'owner' in a)));
  ok('named accounts are ranked by ARR', named.every((i) => {
    const arr = i.named_accounts.map((a) => a.arr_usd ?? 0);
    return arr.every((v, n) => n === 0 || arr[n - 1] >= v);
  }));
  ok('the affected-account count is in the contract, not only in _meta',
    out.insights.every((i) => typeof i.affected_accounts === 'number'));
  ok('every insight names an owner role for the play',
    out.insights.every((i) => typeof i.recommended_action.owner_role === 'string' && i.recommended_action.owner_role.length > 0));
}

/* ── 4 · Missing sources degrade, they do not break ──────────────────────── */
head('4 — Missing sources degrade, and confidence is capped accordingly');
{
  const full = runEngine(generate(SEED, AS_OF));
  const fullMax = Math.max(...full.insights.map((i) => i.why.confidence));
  ok('a complete book reports full detector coverage', full.run.sources.coverage === 1, `${full.run.sources.coverage}`);

  let lastCeiling = full.run.confidence_ceiling;
  for (const drop of [['qa'], ['qa', 'nps'], ['qa', 'nps', 'escalations']]) {
    const ds = generate(SEED, AS_OF);
    for (const s of drop) ds[s] = [];
    let res = null, threw = null;
    try { res = runEngine(ds); } catch (e) { threw = e.message; }
    ok(`dropping ${drop.join(' + ')} does not break the engine`, !threw, threw || '');
    if (!res) continue;
    ok(`  it still produces insights`, res.insights.length > 0, `${res.insights.length} insights`);
    ok(`  it names the missing sources`, drop.every((s) => res.run.sources.missing.includes(s)), JSON.stringify(res.run.sources.missing));
    ok(`  affected detectors are 'skipped', not silently zero`,
      res.run.detectors_run.some((d) => d.status === 'skipped' && d.missing.length > 0),
      `${res.run.sources.detectors_skipped.join(', ')}`);
    const max = Math.max(...res.insights.map((i) => i.why.confidence));
    ok(`  confidence is capped below the full-book maximum`, max < fullMax, `${max.toFixed(2)} < ${fullMax.toFixed(2)}`);
    ok(`  the ceiling falls as coverage falls`, res.run.confidence_ceiling < lastCeiling,
      `${res.run.confidence_ceiling.toFixed(2)} < ${lastCeiling.toFixed(2)}`);
    ok(`  a capped insight says it was capped`,
      res.insights.some((i) => i._meta.confidence_capped_by === 'source_coverage'));
    lastCeiling = res.run.confidence_ceiling;
  }
  /* The cap may only ever lower. Nothing here may lift a finding over the 60%
     floor that holds it for review. */
  const ds = generate(SEED, AS_OF); ds.qa = []; ds.nps = [];
  const degraded = runEngine(ds);
  ok('the cap only ever lowers a score', degraded.insights.every((i) =>
    i._meta.confidence_uncapped == null || i.why.confidence <= i._meta.confidence_uncapped));
  ok('the confidence floor still holds anything under 60% for review',
    degraded.insights.every((i) => i.why.confidence >= 0.6 || i.status === 'held_for_review'));
}

/* ── 5 · What we do NOT build ────────────────────────────────────────────── */
head('5 — The scope boundary is stated, not implied');
{
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/index.html', pretendToBeVisual: true });
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.Event = dom.window.Event;
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  dom.window.matchMedia = () => ({ matches: true });
  new Function(readFileSync(new URL('../assets/chat.js', import.meta.url).pathname, 'utf8'))();
  const Rio = dom.window.Rio;

  /* Each of these used to reach a plausible neighbour instead of the boundary. */
  const MUST_REACH_SCOPE = [
    'do you replace zendesk', 'can we get rid of salesforce', 'is this a replacement for our helpdesk',
    'will you fix our slas', 'can you clean our crm data', 'we do not have slas defined', 'what do you not do',
  ];
  for (const q of MUST_REACH_SCOPE) {
    ok(`"${q}" reaches the boundary`, Rio.match(q) === 'scope', `→ ${Rio.match(q)}`);
  }
  const topic = Rio.topics ? Rio.topics() : [];
  ok('the boundary is a declared topic', topic.includes('scope'));
}

/* ── Summary ─────────────────────────────────────────────────────────────── */
console.log('');
if (fails.length) {
  console.log(`\x1b[31m${fails.length} CHECK(S) FAILED\x1b[0m  (${pass}/${pass + fails.length})`);
  process.exit(1);
}
console.log(`\x1b[32mALL PRINCIPLE CHECKS PASSED\x1b[0m  (${pass}/${pass})`);
