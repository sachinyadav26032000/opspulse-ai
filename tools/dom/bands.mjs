/* The brief is now ranked by REVENUE IMPACT and capped, not assembled from
   severity bands. This suite tests that rule: correct ordering, correct cap,
   nothing lost, and the cut declared on screen. */
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

const { createStore } = await import(`${R}/data/store.js`);
const { mountOpsPulse, briefSelection, BRIEF_LIMIT } = await import(`${R}/assets/opspulse.js`);
let fail = 0; const ok = (c, m) => { console.log(`${c ? ' ok ' : 'FAIL'}  ${m}`); if (!c) fail++; };
const worth = (i) => (i.expected_impact.range_low_usd == null ? 0 : (i.expected_impact.range_low_usd + i.expected_impact.range_high_usd) / 2);

console.log('── selection rule, across seeds ──');
for (const seed of [20260724, 555000111, 987654321, 42424242]) {
  const store = createStore({ seed, fresh: true, autoStart: false });
  const ins = store.engine.insights;
  const sel = briefSelection(ins);

  ok(sel.shown.length <= BRIEF_LIMIT, `seed ${seed}: capped at ${BRIEF_LIMIT} (showed ${sel.shown.length} of ${ins.length})`);
  // strictly descending by worth
  const ws = sel.shown.map(worth);
  ok(ws.every((w, i) => i === 0 || w <= ws[i - 1]), `  ordered by revenue impact: ${ws.map((w) => '$' + Math.round(w / 1000) + 'K').join(' > ')}`);
  // nothing below the cut is worth more than anything above it
  const minShown = Math.min(...ws);
  const maxCut = sel.cut.length ? Math.max(...sel.cut.map(worth)) : -1;
  ok(maxCut <= minShown, `  nothing cut outranks anything shown ($${Math.round(maxCut / 1000)}K <= $${Math.round(minShown / 1000)}K)`);
  // nothing is lost
  ok(sel.shown.length + sel.cut.length === ins.length, `  every insight accounted for (${sel.shown.length} shown + ${sel.cut.length} cut = ${ins.length})`);
  ok(sel.sizing.cut === sel.cut.length && sel.sizing.matched === ins.length, '  sizing block agrees with the lists');
}

console.log('\n── revenue decisions outrank support-ops on money ──');
{
  const store = createStore({ seed: 20260724, fresh: true, autoStart: false });
  const sel = briefSelection(store.engine.insights);
  const rev = sel.shown.filter((i) => i._meta.is_revenue).length;
  console.log('   shown: ' + sel.shown.map((i) => `${i._meta.is_revenue ? 'REV' : 'ops'} ${i._meta.title.slice(0, 34)} $${Math.round(worth(i) / 1000)}K`).join('\n          '));
  ok(rev >= 1, `${rev} of ${sel.shown.length} shown decisions are revenue-shaped`);
  const uncostedShown = sel.shown.filter((i) => worth(i) === 0).length;
  ok(uncostedShown === 0, 'no uncosted decision displaced a costed one');
}

console.log('\n── the brief declares its cut ──');
{
  const store = createStore({ seed: 20260724, fresh: true, autoStart: false });
  const host = document.createElement('div'); document.body.appendChild(host);
  mountOpsPulse(host, store, { user: 'Sudharshan' });
  const body = host.querySelector('.lv-body');
  const cards = body.querySelectorAll('.bd-item').length;
  const sel = briefSelection(store.engine.insights);
  ok(cards === sel.shown.length, `${cards} cards rendered, matching the selection`);
  ok(cards <= BRIEF_LIMIT, `never more than ${BRIEF_LIMIT} on screen`);
  const txt = body.textContent.replace(/\s+/g, ' ');
  if (sel.cut.length) {
    ok(/below the cut/.test(txt), 'brief states that decisions sit below the cut');
    ok(/Ranked by revenue impact/.test(txt), 'brief states the ranking basis');
    ok(/Decision Feed/.test(txt), 'brief says where the cut decisions still live');
    ok(new RegExp(`${sel.cut.length} further decision`).test(txt), `brief names the count cut (${sel.cut.length})`);
  }
  // every band class still renders correctly on whatever is shown
  const banded = [...body.querySelectorAll('.bd-item')].every((c) => /bd-(critical|high|medium)/.test(c.className));
  ok(banded, 'every card still carries a severity band rail');
}

console.log(`\n${errs.length} console errors`);
console.log(fail || errs.length ? `\n${fail} CHECK(S) FAILED` : '\nall checks passed');
process.exit(fail || errs.length ? 1 : 0);
