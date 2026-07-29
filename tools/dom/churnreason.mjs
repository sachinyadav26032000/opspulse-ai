/* The churn reason taxonomy: derived from observables, scored against the
   generator's hidden archetype, and surfaced on the cohort. */
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
/* Repo root, resolved from this file's own location — never an absolute path
   baked in at authoring time, or the suite only runs on one machine. */
const R = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://x/opspulse.html' });
for (const k of ['window','document','navigator','HTMLElement','Node','Blob','FileReader','getComputedStyle','requestAnimationFrame','cancelAnimationFrame','URL','location'])
  if (globalThis[k] === undefined) globalThis[k] = k === 'window' ? dom.window : dom.window[k];
globalThis.localStorage = dom.window.localStorage;
const errs = []; const oe = console.error; console.error = (...a) => { errs.push(a.join(' ')); oe(...a); };
const { generate } = await import(`${R}/data/generator.js`);
const { createStore } = await import(`${R}/data/store.js`);
const { mountOpsPulse } = await import(`${R}/assets/opspulse.js`);
const { buildBookReasons, classifyAccount, CHURN_REASONS, NO_REASON } = await import(`${R}/engine/web/churn-reason.js`);
const { buildCohort } = await import(`${R}/engine/web/cohort.js`);
let fail = 0; const ok = (c,m)=>{console.log(`${c?' ok ':'FAIL'}  ${m}`); if(!c)fail++;};
const M = () => new dom.window.MouseEvent('click',{bubbles:true});

console.log('── the vocabulary is closed and ordered ──');
ok(CHURN_REASONS.length === 6, `${CHURN_REASONS.length} reasons, a readable list`);
ok(CHURN_REASONS[0].key === 'explicit_intent', 'stated intent outranks anything inferred');
ok(CHURN_REASONS[CHURN_REASONS.length-1].key === 'sentiment', 'the softest signal ranks last');
ok(CHURN_REASONS.every(r => r.label && r.short && r.detail), 'every reason explains itself');

console.log('\n── it never reads the generator\'s answer key ──');
const fs = await import('node:fs');
const src = fs.readFileSync(`${R}/engine/web/churn-reason.js`,'utf8');
ok(!/_archetype/.test(src.replace(/\/\*[\s\S]*?\*\//g,'')), 'no reference to _archetype outside comments');

console.log('\n── scored against the hidden archetype, 3 seeds ──');
const { TUNABLE } = await import(`${R}/config/thresholds.js`);
const DECLINE = TUNABLE.usage_decline_pct;
let totals = { cliffHit: 0, cliffN: 0, erodeHit: 0, erodeN: 0, erodeFalse: 0, erodeWrong: 0, naHit: 0, naN: 0, healthyFP: 0, healthyN: 0, noisyFP: 0, noisyN: 0 };
for (const seed of [20250101, 7, 99]) {
  const ds = generate(seed, Date.parse('2026-07-24T09:00:00Z'));
  const r = buildBookReasons(ds, ds.accounts);
  for (const a of ds.accounts) {
    const got = r.byId.get(a.account_id).primary.key;
    const arch = a.usage._archetype;
    if (arch === 'cliff')          { totals.cliffN++; if (got === 'usage_cliff') totals.cliffHit++; }
    /* Slow declines are scored against the RULE, not the archetype label.
       The generator's slow_decline band runs 0% to -50%, so any threshold
       inside it recovers exactly the share above it — at the configured 25%
       that is ~55%, which measures where a customer-tunable dial sits rather
       than whether the classifier works. What IS a correctness property:
       every account that clears the threshold, and has no higher-precedence
       reason, must be labelled erosion. */
    if (arch === 'slow_decline') {
      const tr = a.usage.usage_trend_30d;
      const higher = ['explicit_intent','never_adopted','usage_cliff'].includes(got);
      if (tr <= -DECLINE && !higher) { totals.erodeN++; if (got === 'usage_erosion') totals.erodeHit++; }
      if (tr > -DECLINE && got === 'usage_erosion') totals.erodeFalse++;
      if (tr > -DECLINE && !['none','explicit_intent','service_failure','sentiment'].includes(got)) totals.erodeWrong++;
    }
    if (arch === 'never_adopted')  { totals.naN++;    if (got === 'never_adopted') totals.naHit++; }
    /* The false-positive test that matters. engaged_noisy exists in this
       dataset precisely so a model can be caught treating contact volume as
       risk. A service_failure label on one is that mistake. */
    if (arch === 'healthy')        { totals.healthyN++; if (got === 'service_failure') totals.healthyFP++; }
    if (arch === 'engaged_noisy')  { totals.noisyN++;   if (got === 'service_failure') totals.noisyFP++; }
  }
}
const rate = (h,n) => n ? (100*h/n) : 0;
ok(rate(totals.cliffHit,totals.cliffN) >= 85, `cliffs recovered: ${rate(totals.cliffHit,totals.cliffN).toFixed(0)}% (${totals.cliffHit}/${totals.cliffN})`);
ok(rate(totals.erodeHit,totals.erodeN) === 100,
   `every slow decline clearing the ${DECLINE}% bar is labelled erosion: ${rate(totals.erodeHit,totals.erodeN).toFixed(0)}% (${totals.erodeHit}/${totals.erodeN})`);
ok(totals.erodeFalse === 0, `no account below the bar is called erosion (${totals.erodeFalse})`);
ok(totals.erodeWrong === 0,
   `slow decliners under the bar fall to "none" or a higher-precedence reason — never a wrong usage label (${totals.erodeWrong})`);
ok(rate(totals.naHit,totals.naN) >= 85, `never-adopted recovered: ${rate(totals.naHit,totals.naN).toFixed(0)}% (${totals.naHit}/${totals.naN})`);
ok(rate(totals.noisyFP,totals.noisyN) <= 2, `engaged-but-noisy NOT called service failures: ${rate(totals.noisyFP,totals.noisyN).toFixed(1)}% (${totals.noisyFP}/${totals.noisyN})`);
ok(rate(totals.healthyFP,totals.healthyN) <= 2, `healthy NOT called service failures: ${rate(totals.healthyFP,totals.healthyN).toFixed(1)}% (${totals.healthyFP}/${totals.healthyN})`);

console.log('\n── the decline dial reaches the classifier ──');
{
  const { setTunable } = await import(`${R}/config/thresholds.js`);
  const d0 = generate(20250101, Date.parse('2026-07-24T09:00:00Z'));
  const sd = d0.accounts.filter(a => a.usage._archetype === 'slow_decline');
  const at = (bar) => {
    setTunable('usage_decline_pct', bar);
    const rr = buildBookReasons(d0, d0.accounts);
    return sd.filter(a => rr.byId.get(a.account_id).primary.key === 'usage_erosion').length;
  };
  const [a15, a25, a35] = [at(15), at(25), at(35)];
  ok(a15 > a25 && a25 > a35,
     `a looser bar catches more of the same band: 15% -> ${a15}, 25% -> ${a25}, 35% -> ${a35}`);
  setTunable('usage_decline_pct', DECLINE);   // restore
  ok(TUNABLE.usage_decline_pct === DECLINE, 'dial restored for the remaining checks');
}

console.log('\n── it refuses to guess ──');
const ds = generate(20250101, Date.parse('2026-07-24T09:00:00Z'));
const book = buildBookReasons(ds, ds.accounts);
ok(book.unexplained > 0, `${book.unexplained} accounts labelled "none" rather than forced into a bucket`);
const blank = classifyAccount({ account_id:'X', arr_usd:0, usage:{} }, {});
ok(blank.primary.key === NO_REASON.key, 'an account with no usage and no contact gets no reason');
ok(blank.evidence.length === 0, 'and no evidence is invented for it');

console.log('\n── every label can show its work ──');
const labelled = book.rows.filter(r => r.primary.key !== 'none');
ok(labelled.every(r => r.evidence.some(e => e.reason === r.primary.key)),
   `all ${labelled.length} labelled accounts carry evidence for their primary reason`);
ok(labelled.every(r => r.evidence.every(e => e.source && e.value)), 'every evidence row names a source and a measured value');

console.log('\n── silence is a flag, not a reason ──');
ok(!CHURN_REASONS.some(r => /silent/i.test(r.key)), 'silence is not in the vocabulary');
const silentAndCaused = book.rows.filter(r => r.is_silent && r.primary.key !== 'none');
ok(silentAndCaused.length > 0,
   `${silentAndCaused.length} accounts are silent AND carry a cause — the cause is not hidden by the silence`);

console.log('\n── the cohort surfaces it ──');
const c = buildCohort(ds, { scope:'all', window:'d90' });
ok(c.summary.reason_mix.length >= 3, `mix has ${c.summary.reason_mix.length} reasons`);
ok(c.summary.reason_mix.reduce((s,m)=>s+m.n,0) === c.summary.below, 'the mix sums to the at-risk count — nothing dropped');
ok(c.rows.every(r => r.churn_reason && r.churn_reason.key), 'every row carries a reason');
console.log('   ' + c.summary.reason_mix.map(m=>`${m.n} ${m.reason.short.toLowerCase()}`).join(' · '));

console.log('\n── and renders it ──');
const store = createStore({ seed: 20260724, fresh: true, autoStart: false });
const host = document.createElement('div'); document.body.appendChild(host);
mountOpsPulse(host, store, { user: 'Sudharshan' });
const body = () => host.querySelector('.lv-body');
[...host.querySelectorAll('#opNav button')].find(b=>b.querySelector('span')?.textContent==='Renewals').dispatchEvent(M());
const chips = [...body().querySelectorAll('.cr-chip')];
ok(chips.length > 0, `${chips.length} reason chips in the table`);
ok(chips.every(ch => ch.getAttribute('title')), 'each chip explains itself on hover');
const hues = new Set(chips.map(ch => [...ch.classList].find(c=>c.startsWith('r-'))));
ok(hues.size >= 2 && [...hues].every(h => h && h !== 'r-none'), `hues assigned per reason, not per rank: ${[...hues].join(', ')}`);
ok(!!body().querySelector('.cs-why'), 'the summary carries the mix');
const mixText = body().querySelector('.cs-why').textContent.replace(/\s+/g,' ').trim();
console.log('   ' + mixText.slice(0, 120));

console.log('\n── the account drill-down shows the label AND its evidence ──');
body().querySelector('.coh-row').dispatchEvent(M());
const w = body().querySelector('.acct-why');
ok(!!w, 'account detail rendered from a cohort row');
ok(!!w.querySelector('p')?.textContent.trim(), 'the risk_reason sentence is still there — the label did not replace it');
const tag = w.querySelector('.cr-chip');
if (tag) {
  ok(!!tag.getAttribute('title'), `primary reason labelled: "${tag.textContent.trim()}"`);
  const evRows = [...w.querySelectorAll('.aw-ev li')];
  ok(evRows.length > 0, `${evRows.length} evidence rows under the label`);
  ok(evRows.every(li => li.querySelector('b') && li.querySelector('small')),
     'each evidence row names what was measured and where it came from');
} else {
  ok(true, 'this row has no qualifying reason — nothing invented for it');
}

console.log(`\n${errs.length} console errors`);
if (errs.length) fail++;
console.log(fail ? `\n${fail} FAILED` : '\nall checks passed');
process.exit(fail ? 1 : 0);
