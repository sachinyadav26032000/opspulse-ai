/* Renders each exploration in jsdom to (a) confirm it runs, (b) prove all three
   emit IDENTICAL content from the shared snapshot, and (c) count what fits. */
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
/* Repo root, resolved from this file's own location — never an absolute path
   baked in at authoring time, or the suite only runs on one machine. */
const R = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '') + '/explorations';
let fail = 0; const ok = (c,m)=>{console.log(`${c?' ok ':'FAIL'}  ${m}`); if(!c)fail++;};

const data = fs.readFileSync(`${R}/data.js`, 'utf8');
const files = ['a-briefing.html','b-instrument.html','c-map.html'];
const out = {};

for (const f of files) {
  const dom = new JSDOM(fs.readFileSync(`${R}/${f}`,'utf8'), { runScripts:'outside-only', pretendToBeVisual:true });
  const w = dom.window;
  w.eval(data);
  // run each inline script in order
  [...w.document.querySelectorAll('script:not([src])')].forEach(s => { try { w.eval(s.textContent); } catch(e){ console.log('  ERR in '+f+': '+e.message); fail++; } });
  const text = w.document.body.textContent.replace(/\s+/g,' ');
  out[f] = { dom, text };
  ok(text.length > 800, `${f} rendered (${text.length} chars)`);
}

const S = JSON.parse(data.slice(data.indexOf('var SNAPSHOT =')+14, data.lastIndexOf(';\n\nif')));

console.log('\n── identical content across all three ──');
// every decision title, action and money range must appear in all three
const musts = [];
S.decisions.forEach(d => { musts.push(d.title, d.action, d.money_range); });
S.exposed_accounts.forEach(a => { musts.push(a.account_name, a.arr_display, a.risk_reason); });
musts.push(S.headline.at_stake_range, S.reconciliation.exposed_total_display);
let missing = [];
for (const m of musts) {
  const absent = files.filter(f => !out[f].text.includes(m.replace(/\s+/g,' ')));
  if (absent.length) missing.push(`${absent.join('+')} missing: "${m.slice(0,54)}…"`);
}
ok(missing.length === 0, `all ${musts.length} content strings present in all three variants`);
missing.slice(0,8).forEach(x => console.log('     ' + x));

console.log('\n── the reconciliation actually reconciles ──');
const sum = S.exposed_accounts.reduce((s,a)=>s+a.arr_usd,0);
ok(sum === S.reconciliation.exposed_total, `six accounts sum to ${S.reconciliation.exposed_total_display}`);
files.forEach(f => ok(out[f].text.includes(S.reconciliation.exposed_total_display), `  ${f} shows the total`));

console.log('\n── no placeholder content ──');
const bad = /lorem|ipsum|placeholder|TODO|XXX|Lorem/;
files.forEach(f => ok(!bad.test(out[f].text), `  ${f} free of placeholder text`));

console.log('\n── constraints ──');
files.forEach(f => {
  const src = fs.readFileSync(`${R}/${f}`,'utf8');
  ok(!/@keyframes|animation:/.test(src), `  ${f} no animation`);
  ok(!/radial-gradient|linear-gradient|box-shadow:\s*0 0/.test(src.replace(/--grad[^;]*/g,'')), `  ${f} no gradients or glows`);
  ok(!/<script[^>]+src="http/.test(src), `  ${f} no external scripts`);
  ok(/#070a12/.test(src), `  ${f} shares the dark theme base`);
});

console.log('\n── structural distinctness (are they actually different?) ──');
const shape = (f) => {
  const d = out[f].dom.window.document;
  return { tables:d.querySelectorAll('table').length, svgOrBlocks:d.querySelectorAll('.blk,.acct').length,
           cols:d.querySelectorAll('.board .col').length, prose:d.querySelectorAll('.problem,.because,.do').length };
};
files.forEach(f => { const s = shape(f); console.log(`  ${f.padEnd(20)} tables=${s.tables} proportional-blocks=${s.svgOrBlocks} columns=${s.cols} prose-blocks=${s.prose}`); });
const A=shape(files[0]), B=shape(files[1]), C=shape(files[2]);
ok(A.prose>0 && A.tables===0, 'A is prose-led with no tables');
ok(B.tables>=2 && B.prose===0, 'B is tabular with no prose blocks');
ok(C.svgOrBlocks>=6 && C.prose===0, 'C is proportional blocks, not prose or tables');

console.log(fail ? `\n${fail} CHECK(S) FAILED` : '\nall checks passed');
process.exit(fail?1:0);
