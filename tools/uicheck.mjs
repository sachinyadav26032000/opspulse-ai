/* ==========================================================================
   Headless UI check —  node tools/uicheck.mjs
   --------------------------------------------------------------------------
   Renders BOTH apps against a jsdom document and drives every screen,
   drill-down, copilot intent, CSV ingest path and the live simulator, failing
   on any thrown error, empty render or bad string interpolation.

   The web app itself has zero dependencies; this harness needs jsdom, which is
   why it is not vendored:

       npm install --no-save jsdom && node tools/uicheck.mjs

   Runs alongside tools/verify.mjs, which proves the ENGINE finds the four
   injected patterns. This one proves the UI can render what it found.
   ========================================================================== */

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="desk"></div><div id="pulse"></div></body></html>', {
  url: 'http://localhost/opspulse.html', pretendToBeVisual: true,
});
const { window } = dom;

globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.Blob = window.Blob;
globalThis.FileReader = window.FileReader;
globalThis.Event = window.Event;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
Object.defineProperty(globalThis, 'performance', { value: { now: () => Number(process.hrtime.bigint() / 1000000n) }, configurable: true });
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };

const errors = [];
window.addEventListener('error', (e) => errors.push('window error: ' + e.message));
const origErr = console.error;
console.error = (...a) => { errors.push('console.error: ' + a.join(' ')); origErr(...a); };

const rel = (p) => new URL(p, import.meta.url).href;
const { createStore } = await import(rel('../data/store.js'));
const { mountServiceDesk } = await import(rel('../assets/servicedesk.js'));
const { mountOpsPulse } = await import(rel('../assets/opspulse.js'));
const { toCsv } = await import(rel('../data/csv.js'));
const { KAGGLE_COLUMNS } = await import(rel('../data/generator.js'));

let checks = 0, fails = 0;
const g = (s) => `\x1b[32m${s}\x1b[0m`, r = (s) => `\x1b[31m${s}\x1b[0m`, dim = (s) => `\x1b[2m${s}\x1b[0m`;
const ok = (label, cond, detail = '') => {
  checks++;
  if (cond) console.log(`  ${g('PASS')} ${label}${detail ? dim('  · ' + detail) : ''}`);
  else { fails++; console.log(`  ${r('FAIL')} ${label}  ${detail}`); }
};
const run = (label, fn) => {
  try { const res = fn(); ok(label, true, typeof res === 'string' ? res : ''); return res; }
  catch (e) { checks++; fails++; console.log(`  ${r('FAIL')} ${label}  ${e.message}`); }
};

console.log('\n=== Headless UI render check ===\n');

const store = createStore({ autoStart: false, fresh: true });
console.log(`store ready: ${store.dataset.tickets.length} tickets · ${store.engine.insights.length} insights\n`);

const deskEl = document.getElementById('desk');
const pulseEl = document.getElementById('pulse');
const navTo = (label) => [...pulseEl.querySelectorAll('#opNav button')].find((b) => b.textContent.includes(label)).click();

console.log('— Mount —');
run('ServiceDesk mounts', () => { mountServiceDesk(deskEl, store); return deskEl.querySelectorAll('.sd-table tbody tr').length + ' rows'; });
run('OpsPulse mounts', () => { mountOpsPulse(pulseEl, store); return pulseEl.querySelectorAll('.risk-card').length + ' top-3 cards'; });

/* Host pages size their app with `#app > * { flex: 1 }`. If a mount appends
   more than one child there, the TOOLBAR becomes a flex child too and grows to
   half the viewport — which is exactly the bug that shipped. jsdom does no
   layout so the blank band is invisible, but the structural cause is not. */
ok('ServiceDesk mounts exactly one root child', deskEl.children.length === 1, `${deskEl.children.length} children`);
ok('OpsPulse mounts exactly one root child', pulseEl.children.length === 1, `${pulseEl.children.length} children`);
ok('ServiceDesk root carries .sd-root', deskEl.firstElementChild?.classList.contains('sd-root'));
ok('OpsPulse root carries .op-root', pulseEl.firstElementChild?.classList.contains('op-root'));
ok('toolbar is nested inside the app root, not a sibling',
  !!deskEl.querySelector('.sd-root > .lv-head > .lv-top') && !!pulseEl.querySelector('.op-root > .lv-head > .lv-top'));
ok('dashboard leads with the top-3 headline',
  /top \d+ operational risks/i.test(pulseEl.querySelector('.op-hero h2')?.textContent || ''),
  pulseEl.querySelector('.op-hero h2')?.textContent.trim());
ok('health gauge rendered', !!pulseEl.querySelector('.viz-gauge'));
ok('KPI strip has 6 clickable tiles', pulseEl.querySelectorAll('.kpi').length === 6);
ok('briefing lines present', pulseEl.querySelectorAll('.brief-lines li').length >= 3);

console.log('\n— Screens —');
for (const label of ['Decision Feed', 'Risk Radar', 'Executive Copilot', 'Data Upload', 'Dashboard']) {
  run(`screen: ${label}`, () => {
    navTo(label);
    const v = pulseEl.querySelector('.lv-view');
    if (!v || v.innerHTML.length < 300) throw new Error('view rendered empty');
    return v.innerHTML.length + ' bytes';
  });
}

console.log('\n— Decision feed & the four questions —');
navTo('Decision Feed');
ok('every insight has a feed row', pulseEl.querySelectorAll('.feed-row').length === store.engine.insights.length, `${pulseEl.querySelectorAll('.feed-row').length} rows`);
ok('four-question explorer rendered', pulseEl.querySelectorAll('.qbox').length === 4);
ok('impact arithmetic printed on the card', !!pulseEl.querySelector('.math .f'), pulseEl.querySelector('.math .f')?.textContent);
ok('evidence checklist rendered', pulseEl.querySelectorAll('.evidence li').length >= 3);

console.log('\n— BI drill-down for every insight —');
const modal = document.querySelector('.drill');
for (const ins of store.engine.insights) {
  run(`drill: ${ins._meta.title}`, () => {
    const row = [...pulseEl.querySelectorAll('.feed-row')].find((x) => x.textContent.includes(ins._meta.title.slice(0, 22)));
    if (!row) throw new Error('feed row not found');
    row.click();
    pulseEl.querySelector('.act-row .lv-btn.primary').click();
    if (modal.hidden) throw new Error('modal did not open');
    const charts = modal.querySelectorAll('.viz').length, kpis = modal.querySelectorAll('.drill-kpis > div').length;
    if (charts < 2) throw new Error(`only ${charts} charts`);
    if (kpis !== 4) throw new Error(`expected 4 KPIs, got ${kpis}`);
    modal.querySelector('.drill-x').click();
    return `${charts} charts · ${kpis} KPIs`;
  });
}

console.log('\n— BI drill-down for every KPI tile —');
navTo('Dashboard');
[...pulseEl.querySelectorAll('.kpi')].forEach((tile, i) => {
  run(`kpi tile ${i + 1}`, () => {
    tile.click();
    if (modal.hidden) throw new Error('modal did not open');
    const charts = modal.querySelectorAll('.viz').length, title = modal.querySelector('h3').textContent;
    if (charts < 2) throw new Error(`only ${charts} charts`);
    modal.querySelector('.drill-x').click();
    return `${title} · ${charts} charts`;
  });
});

console.log('\n— Risk radar —');
navTo('Risk Radar');
ok('radar polygon rendered', !!pulseEl.querySelector('.viz-radar polygon'));
ok('four dimension cards', pulseEl.querySelectorAll('.dim-card').length === 4);
[...pulseEl.querySelectorAll('.dim-card')].forEach((c, i) => {
  run(`dimension drill ${i + 1}`, () => {
    c.click();
    if (modal.hidden) throw new Error('modal did not open');
    const t = modal.querySelector('h3').textContent, rows = modal.querySelectorAll('.dtable tbody tr').length;
    modal.querySelector('.drill-x').click();
    return `${t} · ${rows} drivers`;
  });
});

console.log('\n— Executive Copilot —');
navTo('Executive Copilot');
const QUESTIONS = [
  'What should I focus on today?', 'Why did NPS drop?', 'What operational risks are emerging?',
  'What is our biggest operational risk?', 'How is the new-hire cohort performing?',
  'How much revenue is at risk?', 'Why is the backlog growing?', 'Are we exposed on compliance?',
  'Which accounts might churn?', 'What is our health score?', 'Tell me about refunds',
  'What about onboarding?', 'How is the weather in Paris?',
];
for (const q of QUESTIONS) {
  run(`ask: "${q}"`, () => {
    pulseEl.querySelector('#cpQ').value = q;
    pulseEl.querySelector('.chat-ask').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    const msgs = pulseEl.querySelectorAll('.msg');
    const text = msgs[msgs.length - 1].querySelector('.bubble').textContent.trim();
    if (text.length < 40) throw new Error('answer too short');
    if (/undefined|NaN|\[object/.test(text)) throw new Error('bad interpolation: ' + text.slice(0, 120));
    return text.slice(0, 64).replace(/\s+/g, ' ') + '…';
  });
}

console.log('\n— Live simulation (clean store) —');
{
  const s2 = createStore({ autoStart: false, fresh: true, seed: 991 });
  const before = s2.dataset.tickets.length;
  const radiusOf = (s) => s.engine.insights.find((i) => i.signal_type === 'escalation_spike' && i._meta.entity.key === 'Refund')?._meta.affected_accounts;
  const r0 = radiusOf(s2);
  s2.start();
  await new Promise((res) => setTimeout(res, 7200));
  s2.stop();
  s2.recompute('test');
  ok('live tickets arrived', s2.dataset.tickets.length > before, `${before} → ${s2.dataset.tickets.length}`);
  ok('live events recorded', s2.feed.length > 0, `${s2.feed.length} events`);
  ok('blast radius stays exactly 231 under live traffic', r0 === 231 && radiusOf(s2) === 231, `${r0} → ${radiusOf(s2)}`);
  ok('all four patterns survive live traffic',
    ['escalation_spike', 'coaching_gap', 'emerging_topic', 'backlog_risk'].every((t) => s2.engine.insights.some((i) => i.signal_type === t)));
}

console.log('\n— Data upload (real CSV ingest) —');
const before = store.dataset.tickets.length, beforeInsights = store.engine.insights.length;
const sample = store.dataset.tickets.slice(-120).map((t) => ({
  'Ticket ID': 'UPL' + t.ticket_id, 'Customer Name': t.customer_name, 'Customer Email': t.customer_email,
  'Customer Age': t.customer_age, 'Customer Gender': t.customer_gender, 'Product Purchased': t.product_purchased,
  'Date of Purchase': t.date_of_purchase, 'Ticket Type': t.ticket_type, 'Ticket Subject': t.ticket_subject,
  'Ticket Description': t.ticket_description, 'Ticket Status': t.ticket_status, 'Resolution': t.resolution,
  'Ticket Priority': t.ticket_priority, 'Ticket Channel': t.ticket_channel,
  'First Response Time': new Date(t.created_at).toISOString(), 'Time to Resolution': t.time_to_resolution_hrs,
  'Customer Satisfaction Rating': t.customer_satisfaction_rating,
}));
const res = store.ingestCsv(toCsv(sample, KAGGLE_COLUMNS));
ok('Kaggle-schema CSV accepted', res.ok, res.ok ? `${res.added}/${res.total_rows} rows · ${Object.keys(res.mapped_columns).length} columns mapped` : res.error);
ok('every row ingested (no silent day-binning loss)', res.added === res.total_rows, `${res.added} of ${res.total_rows}`);
ok('rows appended to the live dataset', store.dataset.tickets.length === before + res.added, `${before} → ${store.dataset.tickets.length}`);
ok('engine re-ran over the combined data', store.engine.insights.length >= beforeInsights, `${beforeInsights} → ${store.engine.insights.length} insights`);
ok('uploaded rows are not collapsed into one pseudo-account',
  new Set(store.dataset.tickets.filter((t) => t.is_uploaded).map((t) => t.account_id)).size > 5,
  `${new Set(store.dataset.tickets.filter((t) => t.is_uploaded).map((t) => t.account_id)).size} distinct customers from the file`);
const bad = store.ingestCsv('foo,bar\n1,2\n');
ok('unrecognised CSV rejected with a reason', !bad.ok, bad.error);
ok('engine still contract-valid over uploaded data', store.engine.run.contract_valid);

console.log('\n— ServiceDesk —');
for (const label of ['All tickets', 'SLA breached', 'Escalations', 'QA reviews', 'NPS inbox', 'Agent roster', 'Open queue']) {
  run(`view: ${label}`, () => {
    [...deskEl.querySelectorAll('.sd-side button')].find((b) => b.textContent.includes(label)).click();
    const rows = deskEl.querySelectorAll('.sd-table tbody tr').length;
    if (!rows && !deskEl.querySelector('.empty')) throw new Error('nothing rendered');
    deskEl.querySelectorAll('.sd-table tbody tr')[0]?.click();
    if (rows && deskEl.querySelector('.sd-detail').hidden) throw new Error('detail did not open');
    return `${rows} rows`;
  });
}
run('live re-render preserves queue scroll position', () => {
  [...deskEl.querySelectorAll('.sd-side button')].find((b) => b.textContent.includes('All tickets')).click();
  const sc = deskEl.querySelector('.sd-scroll');
  // jsdom reports 0 height, so force a scrollable box before asserting.
  Object.defineProperty(sc, 'scrollHeight', { value: 4000, configurable: true });
  sc.scrollTop = 640;
  store.recompute('scroll-test');
  [...deskEl.querySelectorAll('.sd-side button')].find((b) => b.textContent.includes('All tickets')).click();
  if (sc.scrollTop !== 640) throw new Error(`scroll jumped to ${sc.scrollTop} — a live tick would yank the viewer to the top`);
  sc.scrollTop = 0;
  return 'scrollTop held at 640 across a re-render';
});
run('a focused input defers the engine re-render', () => {
  navTo('Executive Copilot');
  const input = pulseEl.querySelector('#cpQ');
  input.value = 'half-typed question';
  input.focus();
  store.recompute('typing-test');
  const after = pulseEl.querySelector('#cpQ');
  if (after.value !== 'half-typed question') throw new Error('in-progress text was destroyed by a live re-render');
  input.blur();
  return 'typed text survived an engine pass';
});
run('never renders more than 50 rows', () => {
  [...deskEl.querySelectorAll('.sd-side button')].find((b) => b.textContent.includes('All tickets')).click();
  const n = deskEl.querySelectorAll('.sd-table tbody tr').length;
  if (n > 50) throw new Error(`${n} rows in the DOM`);
  return `${n} rows for ${store.dataset.tickets.length} tickets`;
});

console.log('\n— Reseed —');
run('reseed builds a new world with the same patterns', () => {
  const s = store.reseed(4242);
  const ins = store.engine.insights;
  if (!['escalation_spike', 'coaching_gap', 'emerging_topic', 'backlog_risk'].every((t) => ins.some((i) => i.signal_type === t))) throw new Error('patterns lost after reseed');
  return `seed ${s} · ${ins.length} insights · four patterns intact`;
});

console.log('\n— Chart accessibility invariants —');
navTo('Dashboard');
pulseEl.querySelectorAll('.kpi')[1].click();
const vizzes = [...modal.querySelectorAll('.viz')];
ok('every chart offers a data table', vizzes.every((v) => v.querySelector('.viz-table-btn')), `${vizzes.length} charts`);
ok('no chart shows a one-item legend', vizzes.every((v) => v.querySelectorAll('.viz-legend .viz-key').length !== 1));
ok('every chart svg carries an accessible label', vizzes.every((v) => !v.querySelector('svg.viz-svg') || v.querySelector('svg.viz-svg').getAttribute('aria-label')));
modal.querySelector('.drill-x').click();

/* ── Entitlements ──────────────────────────────────────────────────────────
   THE INVARIANT UNDER TEST: a feature the customer does not have RENDERS. The
   failure mode this guards against is the easy one — gating by not appending
   the panel — which looks fine in review and silently removes the only thing
   that creates upgrade demand. Every check below asserts something is PRESENT
   on the cheap tier, not absent.

   The second invariant is honesty: on a tier that does not ingest external
   signals, the locked panel must not print a count of what it is missing. The
   seeded records are sitting in the same dataset, so counting them would be a
   one-line change and a lie about what the tier can see. */
console.log('\n— Entitlements & tiers —');

const tierBtn = (label) => [...pulseEl.querySelectorAll('#opTierSeg button')].find((b) => b.textContent.trim() === label);
ok('demo tier switcher offers all three tiers', pulseEl.querySelectorAll('#opTierSeg button').length === 3,
  [...pulseEl.querySelectorAll('#opTierSeg button')].map((b) => b.textContent).join(' · '));
ok('the demo defaults to Enterprise so nothing is hidden on open', store.tier === 'enterprise', store.tier);

run('switching to Essential repaints without an engine pass', () => {
  tierBtn('Essential').click();
  if (store.tier !== 'essential') throw new Error(`tier is ${store.tier}`);
  return 'tier = essential';
});

navTo('Dashboard');
ok('Essential still renders the top-3 — the engine is the same on every plan',
  pulseEl.querySelectorAll('.risk-card').length >= 1, `${pulseEl.querySelectorAll('.risk-card').length} cards`);
ok('gated features render as locked panels rather than vanishing',
  pulseEl.querySelectorAll('.panel.locked').length >= 2, `${pulseEl.querySelectorAll('.panel.locked').length} locked panels`);
ok('a locked panel names the tier that opens it',
  [...pulseEl.querySelectorAll('.panel.locked .ent-badge')].length >= 2);
ok('the external signals lock lists the signal types it would show',
  /Acquisition/.test(pulseEl.textContent) && /Stakeholder change/.test(pulseEl.textContent));
ok('the locked copy says "may have" and never invents a count',
  /may have external events/.test(pulseEl.textContent)
  && !/\d+ of your (at-risk )?accounts have external/.test(pulseEl.textContent));

ok('every nav item survives the downgrade — none is removed',
  pulseEl.querySelectorAll('#opNav button').length === 7, `${pulseEl.querySelectorAll('#opNav button').length} nav items`);

run('gated screens open a locked view instead of doing nothing', () => {
  navTo('Executive Copilot');
  if (!pulseEl.querySelector('.panel.locked')) throw new Error('copilot locked view missing');
  if (pulseEl.querySelector('.chat-log')) throw new Error('copilot answered on a plan that does not include it');
  navTo('Impact');
  if (!pulseEl.querySelector('.panel.locked')) throw new Error('impact locked view missing');
  return 'copilot + impact locked';
});

run('delegation locks the control but keeps its label', () => {
  navTo('Decision Feed');
  const assign = [...pulseEl.querySelectorAll('.act-row .lv-btn')].find((b) => /Assign to/.test(b.textContent));
  if (!assign) throw new Error('the assign control disappeared instead of locking');
  if (!assign.disabled) throw new Error('assign is still pressable on Essential');
  return assign.textContent.trim().replace(/\s+/g, ' ');
});

console.log('\n— Assurance: usage counters and cost of goods —');
navTo('Assurance');
ok('Assurance renders both priced axes', pulseEl.querySelectorAll('.use-card').length === 2);
ok('the 2,400-account book trips the Essential ceiling as a warning, not a block',
  pulseEl.querySelectorAll('.use-card.over').length >= 1
  && /not a cut-off/.test(pulseEl.textContent));
ok('the feature list shows locked entries too, not just included ones',
  /Executive Copilot/.test(pulseEl.textContent) && /Contact centre/.test(pulseEl.textContent));

run('gross margin is a range with its arithmetic shown', () => {
  const f = pulseEl.querySelector('.math .f')?.textContent || '';
  const m = f.match(/gross margin (\d+)% – (\d+)%/);
  if (!m) throw new Error(`no margin range rendered: ${f.slice(0, 80)}`);
  if (Number(m[1]) > Number(m[2])) throw new Error('margin range is inverted');
  if (!/÷ \$[\d,]+/.test(f)) throw new Error('the division is not shown');
  return f.replace(/\s+/g, ' ').trim().slice(0, 72);
});
ok('inference and transcription counters are reported as the zeros they are',
  /0 calls/.test(pulseEl.textContent) && /structurally zero/.test(pulseEl.textContent));
ok('every dollar figure is labelled a model, not a measurement',
  /modelled/.test(pulseEl.textContent) && /assumption/.test(pulseEl.textContent));

run('switching up to Growth unlocks contact centre and external signals', () => {
  tierBtn('Growth').click();
  navTo('Dashboard');
  const t = pulseEl.textContent;
  if (!/External signals/.test(t)) throw new Error('external signals panel missing on Growth');
  if (/may have external events/.test(t)) throw new Error('still showing the Essential lock copy');
  navTo('Impact');
  if (pulseEl.querySelector('.panel.locked')) throw new Error('impact still locked on Growth');
  return `${pulseEl.querySelectorAll('.imp-card').length} impact cards`;
});

run('Enterprise opens the Copilot and leaves nothing locked but unbuilt features', () => {
  tierBtn('Enterprise').click();
  navTo('Executive Copilot');
  if (!pulseEl.querySelector('.chat-log')) throw new Error('copilot did not open on Enterprise');
  navTo('Dashboard');
  /* Contact centre stays locked on every tier: it is entitled here and simply
     not built, and the panel says exactly that rather than showing four ticks. */
  const locked = [...pulseEl.querySelectorAll('.panel.locked .panel-hd h3')].map((h) => h.textContent);
  if (!locked.includes('Contact centre')) throw new Error('contact centre should still declare itself unconnected');
  return `locked on Enterprise: ${locked.join(', ') || 'none'}`;
});

/* ── Chrome integrity ──────────────────────────────────────────────────────
   Cheap structural checks over the finished chrome, added after a review found
   four defects of a kind no other assertion here could see. They are all the
   same shape: something rendered fine and MEANT the wrong thing.

     · Impact and Data Upload shared one icon, so two tabs read as one
       destination — at 15px the glyph is read before the label.
     · Four of NorthDesk's eight queues rendered two glyphs between them
       (Open/All both inbox; SLA breached / Aged / Escalations all flame).
     · The active tab was signalled by colour alone, which a screen reader
       cannot see and a colourblind reader may not either.

   Icon uniqueness is asserted per NAV GROUP rather than globally: a glyph
   reused across two different apps is fine, twice inside one menu is not. */
console.log('\n— Chrome integrity —');

const iconOf = (b) => { const svg = b.querySelector('svg'); return svg ? svg.innerHTML.replace(/\s+/g, '') : null; };
for (const [name, sel, root] of [['OpsPulse tab strip', '#opNav button', pulseEl], ['NorthDesk sidebar', '.sd-side button', deskEl]]) {
  const seen = new Map(); const dupes = [];
  for (const b of root.querySelectorAll(sel)) {
    const k = iconOf(b); if (!k) continue;
    const label = b.textContent.replace(/\s+/g, ' ').trim();
    if (seen.has(k)) dupes.push(`"${label}" = "${seen.get(k)}"`); else seen.set(k, label);
  }
  ok(`${name}: every item has its own icon`, dupes.length === 0, dupes.join('; ') || `${seen.size} distinct`);
}

for (const [name, root] of [['OpsPulse', pulseEl], ['NorthDesk', deskEl]]) {
  const ids = [...root.querySelectorAll('[id]')].map((e) => e.id);
  const dupes = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
  ok(`${name}: no duplicate element ids`, dupes.length === 0, dupes.join(', ') || `${ids.length} ids`);

  /* An icon-only control with no accessible name is a button a screen reader
     announces as "button". */
  const unnamed = [...root.querySelectorAll('button')]
    .filter((b) => !(b.textContent || '').trim() && !b.getAttribute('aria-label') && !b.getAttribute('title'));
  ok(`${name}: every button has an accessible name`, unnamed.length === 0,
    unnamed.map((b) => b.outerHTML.slice(0, 60)).join(' | ') || 'all named');
}

const navBtns = [...pulseEl.querySelectorAll('#opNav button')];
const active = navBtns.filter((b) => b.classList.contains('on'));
ok('exactly one tab is active', active.length === 1, `${active.length} active`);
ok('the active tab is announced, not just coloured',
  active.every((b) => b.getAttribute('aria-current') === 'page'));
ok('inactive tabs carry no aria-current',
  navBtns.filter((b) => !b.classList.contains('on')).every((b) => !b.hasAttribute('aria-current')));

/* The header is two bands — title bar and tab strip — so that neither can
   wrap into the other. A single wrapping row put the tier switcher and the
   live indicator at ragged offsets the moment the pane narrowed. */
ok('the OpsPulse header is a two-band shell',
  !!pulseEl.querySelector('.op-root > .lv-head > .lv-top') && !!pulseEl.querySelector('.op-root > .lv-head > #opNav'));
ok('the tab strip scrolls rather than wrapping',
  !!pulseEl.querySelector('#opNav') && !pulseEl.querySelector('#opNav')?.className.includes('wrap'));
ok('NorthDesk uses the same shell', !!deskEl.querySelector('.sd-root > .lv-head > .lv-top'));

console.log(`\n${fails === 0 && !errors.length ? g('ALL UI CHECKS PASSED') : r(`${fails} CHECK(S) FAILED`)}  (${checks - fails}/${checks})`);
if (errors.length) { console.log('\nRuntime errors captured:'); errors.slice(0, 10).forEach((e) => console.log('  ! ' + e)); }
process.exit(fails === 0 && errors.length === 0 ? 0 : 1);
