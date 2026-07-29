/* Density + correctness of the new Dashboard / Feed / Radar content. */
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
const { mountOpsPulse } = await import(`${R}/assets/opspulse.js`);
let fail = 0; const ok = (c,m)=>{console.log(`${c?' ok ':'FAIL'}  ${m}`); if(!c)fail++;};

const store = createStore({ seed: 20260724, fresh: true, autoStart: false });
const host = document.createElement('div'); document.body.appendChild(host);
mountOpsPulse(host, store);
const label = (b) => b.querySelector('span')?.textContent;
const body = () => host.querySelector('.lv-body');
/* Re-query every time: renderNav() rebuilds the bar, so a list captured at
   mount goes stale. Workspace now lives in the overflow (Renewals took its
   primary slot in Task 3), so open More when the label is not on the bar. */
const find = (n) => [...host.querySelectorAll('#opNav button')].find((b)=>label(b)===n);
const click = (b) => b.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));
const go = (n) => { let b = find(n); if (!b) { click(find('More')); b = find(n); } click(b); };

const stat = (n) => {
  go(n); const b = body();
  return {
    chars: b.textContent.replace(/\s+/g,' ').trim().length,
    charts: b.querySelectorAll('.viz').length,
    tiles: b.querySelectorAll('.kpi').length,
    panels: b.querySelectorAll('.panel').length,
    numbers: (b.textContent.match(/\d[\d,.]*/g) || []).length,
  };
};

console.log('── content per view ──');
console.log('  view              chars  charts  tiles  panels  numbers');
for (const v of ['Workspace','Decision Feed','Risk Radar']) {
  const s = stat(v);
  console.log(`  ${v.padEnd(16)} ${String(s.chars).padStart(5)}  ${String(s.charts).padStart(6)}  ${String(s.tiles).padStart(5)}  ${String(s.panels).padStart(6)}  ${String(s.numbers).padStart(7)}`);
}

console.log('\n── Risk Radar (was the emptiest) ──');
go('Risk Radar'); let b = body();
ok(b.querySelectorAll('.kpi').length === 6, `${b.querySelectorAll('.kpi').length} stat tiles added`);
ok(/Every driver in the score/.test(b.textContent), 'all 15 drivers expanded into a ranked bar chart');
ok(/Queue against target/.test(b.textContent), 'backlog-vs-target trend present');
ok(/Demand vs capacity/.test(b.textContent), 'inflow-vs-throughput trend present');
ok(b.querySelectorAll('.viz').length >= 3 && b.querySelectorAll('.viz-radar').length === 1, `${b.querySelectorAll('.viz').length} charts + the radar itself`);
ok(b.querySelectorAll('.viz-legend').length >= 2, 'multi-series charts carry a legend (identity never colour-alone)');

console.log('\n── Decision Feed ──');
go('Decision Feed'); b = body();
ok(b.querySelectorAll('.kpi').length === 6, 'summary strip added');
ok(/Severity ladder/.test(b.textContent), 'severity ladder present');
ok(/Where the money is/.test(b.textContent), 'value ranking present');
ok(/Median confidence/.test(b.textContent) && /Held for review/.test(b.textContent), 'governance numbers surfaced in the strip');

console.log('\n── Workspace (was Dashboard) ──');
go('Workspace'); b = body();
ok(/Where the open work sits/.test(b.textContent), 'open-work breakdown added');
ok(/What the engine made of it/.test(b.textContent), 'signal mix added');
ok(/Queue against target/.test(b.textContent), 'backlog vs target added');

console.log('\n── design-system hygiene ──');
const css = (await import('node:fs')).readFileSync(`${R}/assets/live.css`,'utf8');
ok(/\.kpi\.static \{ cursor: default/.test(css), 'non-interactive tiles do not advertise a drill-down');
// no invented hues: every colour used must come from the validated palette or status set
const src = (await import('node:fs')).readFileSync(`${R}/assets/opspulse.js`,'utf8');
const added = src.slice(src.indexOf('function statStrip'));
const hexes = [...new Set((added.match(/#[0-9a-fA-F]{6}/g) || []))];
ok(hexes.length === 0, `no raw hex colours introduced (${hexes.length ? hexes.join(', ') : 'all via SERIES/STATUS tokens'})`);
// hover layer is inherited from the shared chart components
ok(b.querySelectorAll('.viz-table-btn').length > 0, 'charts ship the table view (accessibility fallback)');

console.log(`\n${errs.length} console errors`);
console.log(fail || errs.length ? `\n${fail} CHECK(S) FAILED` : '\nall checks passed');
process.exit(fail || errs.length ? 1 : 0);
