/* ==========================================================================
   MCP check —  node tools/mcpcheck.mjs
   --------------------------------------------------------------------------
   The failure mode a hand-rolled protocol invites is passing your own tests and
   failing a real client, so this harness does not call the tool functions. It
   SPAWNS `mcp/server.js` as a child process, writes newline-delimited JSON into
   its stdin and reads its stdout — a real handshake over a real pipe — then
   does the same over HTTP against `mcp/http.js` in a second child process.
   If the two transports ever disagree, that is a bug in one of them, and this
   is where it surfaces.

   The protocol half asserts shapes a client depends on: `tools/call` returns a
   content ARRAY of typed blocks, a tool-level problem comes back as isError
   inside a SUCCESSFUL result (a JSON-RPC error would abort a model's turn),
   notifications produce no reply at all, and stdout carries protocol bytes and
   nothing else — one stray console.log there is enough to kill a client's
   parser, and it is the single easiest mistake to make in a stdio server.

   The grounding half is the part that matters for credibility: every retrieved
   passage must resolve to a record that actually exists, every printed dollar
   range must re-multiply from its printed inputs, and compliance exposure must
   still refuse to carry a number.

   The last section EXECUTES the inspector page rather than grepping its source.
   Asserting that the HTML contains `fetch('mcp'` proves nothing — a typo in the
   script leaves a blank page with every check still green — and on a machine
   where the browser cannot reach localhost, running it here is the only way to
   know the page works at all.

       npm install --no-save jsdom && node tools/mcpcheck.mjs
   ========================================================================== */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rel = (p) => fileURLToPath(new URL(p, import.meta.url));
const ROOT = path.resolve(rel('..'));

const g = (s) => `\x1b[32m${s}\x1b[0m`, r = (s) => `\x1b[31m${s}\x1b[0m`, dim = (s) => `\x1b[2m${s}\x1b[0m`;
let checks = 0, fails = 0;
const ok = (label, cond, detail = '') => {
  checks++;
  if (cond) console.log(`  ${g('PASS')} ${label}${detail ? dim('  · ' + detail) : ''}`);
  else { fails++; console.log(`  ${r('FAIL')} ${label}  ${detail}`); }
};

console.log('\n=== MCP server: protocol, transports, grounding ===\n');

/* ── A real stdio client ─────────────────────────────────────────────────── */

function stdioClient() {
  const child = spawn(process.execPath, [rel('../mcp/server.js')], {
    cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let stdout = '', stderr = '', buf = '';
  const unsolicited = [];

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c) => {
    stdout += c;
    buf += c;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { unsolicited.push(line); continue; }
      const res = pending.get(msg.id);
      if (res) { pending.delete(msg.id); res(msg); } else unsolicited.push(line);
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c) => { stderr += c; });

  let id = 0;
  return {
    child,
    /** Send a request and wait for its reply. */
    send(method, params) {
      const myId = ++id;
      const msg = { jsonrpc: '2.0', id: myId, method, ...(params ? { params } : {}) };
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 15000);
        pending.set(myId, (m) => { clearTimeout(timer); resolve(m); });
        child.stdin.write(`${JSON.stringify(msg)}\n`);
      });
    },
    /** Send a notification (no id) — must produce no reply. */
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) })}\n`);
    },
    /** Write a raw line, bypassing JSON encoding. */
    raw(line) { child.stdin.write(`${line}\n`); },
    get stdout() { return stdout; },
    get stderr() { return stderr; },
    get unsolicited() { return unsolicited; },
    close() { return stop(child); },
  };
}

/* Wait for the child to actually be gone before moving on. Calling kill() and
   then process.exit() straight after aborts the Node process on Windows with a
   libuv assertion in async.c — the harness prints ALL CHECKS PASSED and then
   exits 127, which reads as a failure to anything scripting it. */
function stop(child) {
  return new Promise((resolve) => {
    const done = () => {
      // Tear the pipes down explicitly. Leaving them open is what leaves libuv
      // with a half-closed handle to trip over during teardown.
      for (const s of [child.stdin, child.stdout, child.stderr]) {
        try { s?.removeAllListeners(); s?.destroy(); } catch { /* already gone */ }
      }
      child.removeAllListeners();
      resolve();
    };
    if (child.exitCode !== null || child.signalCode !== null) return done();
    child.once('close', done);
    try { child.stdin?.end(); } catch { /* already closed */ }
    child.kill();
    // Belt and braces: never hang the harness on a child that will not die.
    setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } done(); }, 3000).unref();
  });
}

const cli = stdioClient();
const parse = (res) => JSON.parse(res.result.content[0].text);

console.log('— Handshake over a real stdio pipe —');

const init = await cli.send('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'mcpcheck', version: '1.0.0' },
});
ok('initialize returns a result, not an error', !!init.result && !init.error, init.error?.message);
ok('echoes a protocol version it supports', typeof init.result?.protocolVersion === 'string',
  init.result?.protocolVersion);
ok('advertises the tools capability', !!init.result?.capabilities?.tools);
ok('does not advertise capabilities it has not implemented',
  !init.result?.capabilities?.resources && !init.result?.capabilities?.prompts
  && !init.result?.capabilities?.sampling);
ok('identifies itself', init.result?.serverInfo?.name === 'opspulse-decision-engine',
  `${init.result?.serverInfo?.name} v${init.result?.serverInfo?.version}`);
ok('ships instructions that state the grounding rules',
  /explain_insight/.test(init.result?.instructions || '')
  && /held_for_review/.test(init.result?.instructions || '')
  && /uncosted/i.test(init.result?.instructions || ''));

cli.notify('notifications/initialized');
await new Promise((r2) => setTimeout(r2, 120));
ok('a notification produces no reply at all', cli.unsolicited.length === 0,
  cli.unsolicited.slice(0, 1).join(''));

const listed = await cli.send('tools/list');
const tools = listed.result?.tools || [];
ok('tools/list returns the seven tools', tools.length === 7, tools.map((t) => t.name).join(', '));
ok('every tool carries a name, a description and an inputSchema',
  tools.every((t) => t.name && t.description && t.inputSchema?.type === 'object'));
ok('every declared required arg exists in that tool\'s properties',
  tools.every((t) => (t.inputSchema.required || []).every((k) => k in (t.inputSchema.properties || {}))));
ok('descriptions say when to use the tool, not just what it returns',
  tools.every((t) => t.description.length > 120));

console.log('\n— tools/call wire shape —');

const brief = await cli.send('tools/call', { name: 'get_executive_brief', arguments: {} });
ok('returns a content ARRAY of typed blocks', Array.isArray(brief.result?.content)
  && brief.result.content[0]?.type === 'text');
ok('the block payload parses as JSON', (() => { try { parse(brief); return true; } catch { return false; } })());
ok('a healthy call is not flagged isError', brief.result.isError === false);

const bad = await cli.send('tools/call', { name: 'explain_insight', arguments: { insight_id: 'ins_nope' } });
ok('a bad argument returns isError INSIDE a successful result, not a JSON-RPC error',
  !bad.error && bad.result?.isError === true);
ok('and the error text tells the model how to recover',
  Array.isArray(parse(bad).available) && parse(bad).available.length > 0);

const unknown = await cli.send('tools/call', { name: 'definitely_not_a_tool', arguments: {} });
ok('an unknown TOOL is a JSON-RPC -32601', unknown.error?.code === -32601, unknown.error?.message);

const badMethod = await cli.send('nonsense/method');
ok('an unknown METHOD is a JSON-RPC -32601', badMethod.error?.code === -32601);

cli.raw('{ this is not json');
await new Promise((r2) => setTimeout(r2, 120));
ok('malformed JSON is answered with -32700 rather than killing the process',
  cli.unsolicited.some((l) => { try { return JSON.parse(l).error?.code === -32700; } catch { return false; } })
  || (await (async () => { const p = await cli.send('ping'); return !!p.result; })()));

const ping = await cli.send('ping');
ok('the process survived all of that and still answers ping', !!ping.result && !ping.error);

console.log('\n— stdout discipline —');
ok('every stdout line is valid JSON — no stray logging on the protocol stream',
  cli.stdout.split('\n').filter((l) => l.trim()).every((l) => {
    try { JSON.parse(l); return true; } catch { return false; }
  }));
ok('diagnostics went to stderr instead', /opspulse-mcp/.test(cli.stderr), cli.stderr.trim().split('\n')[0]);

/* ── Grounding: the answers have to be defensible ────────────────────────── */

console.log('\n— Grounding: retrieval is attributable —');

const search = await cli.send('tools/call', {
  name: 'search_evidence',
  arguments: { query: 'refund window 30 days policy', limit: 10 },
});
const sr = parse(search);
ok('BM25 finds the injected refund-policy language', sr.passages.length > 0,
  `${sr.total_matched} matched of ${sr.corpus_size} indexed`);
ok('every passage carries a record_id', sr.passages.every((p) => !!p.record_id));
ok('every passage carries the record kind and a day index',
  sr.passages.every((p) => ['ticket', 'nps', 'qa'].includes(p.kind) && Number.isFinite(p.day_index)));
ok('results are ranked descending by score',
  sr.passages.every((p, i2) => i2 === 0 || sr.passages[i2 - 1].score >= p.score));
ok('the tool says plainly that hit count is not prevalence', /not evidence of how common/i.test(sr.note));

// Every returned id must resolve to a record that actually exists in the dataset.
const { createSession } = await import(new URL('../mcp/tools.js', import.meta.url).href);
const session = createSession();
const ids = new Set([
  ...session.ds.tickets.map((t) => t.ticket_id),
  ...session.ds.nps.map((n) => n.response_id),
  ...session.ds.qa.map((q) => q.qa_id),
]);
ok('every retrieved record_id resolves to a real record',
  sr.passages.every((p) => ids.has(p.record_id)),
  `${sr.passages.length} checked`);

const filtered = await cli.send('tools/call', {
  name: 'search_evidence',
  arguments: { query: 'onboarding setup confusing', kind: 'nps', limit: 5 },
});
const fr = parse(filtered);
ok('the kind filter is honoured', fr.passages.every((p) => p.kind === 'nps'), `${fr.passages.length} nps passages`);

const windowed = await cli.send('tools/call', {
  name: 'search_evidence',
  arguments: { query: 'refund', from_day: 80, to_day: 89, limit: 5 },
});
const wr = parse(windowed);
ok('the day-window filter is honoured',
  wr.passages.every((p) => p.day_index >= 80 && p.day_index <= 89));

const empty = await cli.send('tools/call', { name: 'search_evidence', arguments: { query: 'the and of' } });
ok('a query of nothing but stopwords returns nothing rather than everything',
  parse(empty).passages.length === 0);

console.log('\n— Grounding: the money has to reconcile —');

const list = parse(await cli.send('tools/call', { name: 'list_insights', arguments: {} }));
ok('the feed is ranked and non-empty', list.insights.length > 0, `${list.insights.length} insights`);

let costed = 0, uncosted = 0, held = 0;
for (const row of list.insights) {
  const e = parse(await cli.send('tools/call', { name: 'explain_insight', arguments: { insight_id: row.insight_id } }));
  const imp = e.expected_impact;
  if (imp.costed) {
    costed++;
    const meta = session.engine.insights.find((x) => x.insight_id === row.insight_id)._meta.impact;
    const product = imp.inputs.reduce((a, x) => a * x.value, 1);
    const lo = Math.round(product * meta.range_factor[0]);
    const hi = Math.round(product * meta.range_factor[1]);
    if (Math.abs(lo - imp.range_low_usd) > 1 || Math.abs(hi - imp.range_high_usd) > 1) {
      ok(`impact re-multiplies for ${row.insight_id}`, false,
        `printed ${imp.range_low_usd}–${imp.range_high_usd}, inputs give ${lo}–${hi}`);
    }
    if (!imp.formula || !Array.isArray(imp.basis) || !imp.basis.length) {
      ok(`${row.insight_id} ships its formula and basis`, false);
    }
  } else {
    uncosted++;
    if (imp.range_high_usd != null || !/statutory|legal/i.test(imp.why_uncosted || '')) {
      ok(`${row.insight_id} stays uncosted with a reason`, false);
    }
  }
  if (e.status === 'held_for_review') {
    held++;
    if (!/BELOW the 60% confidence cutoff/.test(e.why.caveat)) {
      ok(`${row.insight_id} is flagged as held in its own payload`, false);
    }
  }
}
ok('every costed insight re-multiplies from its printed inputs to its printed range',
  true, `${costed} costed insights checked`);
ok('every costed insight ships formula + basis alongside the range', true);
ok('compliance exposure is returned uncosted, with the reason stated',
  uncosted > 0, `${uncosted} uncosted`);
ok('any held-for-review insight says so in its own payload', true, `${held} held`);

const top = parse(brief);
ok('the brief\'s top 3 are three DIFFERENT entities, not one story told twice',
  new Set(top.top_3.map((t) => t.entity)).size === top.top_3.length,
  top.top_3.map((t) => t.entity).join(' | '));
ok('every top-3 id resolves through explain_insight',
  top.top_3.every((t) => list.insights.some((i2) => i2.insight_id === t.insight_id)));

console.log('\n— Series and health read through the engine, not a second aggregation —');

const series = parse(await cli.send('tools/call', { name: 'get_metric_series', arguments: { metric: 'backlog' } }));
ok('the backlog series is the dataset\'s own', series.values.length === session.ds.meta.days
  && series.values.every((v, i2) => v === session.ds.meta.series.backlog[i2]));
ok('it carries date labels, not bare indices', series.labels.length === series.values.length
  && typeof series.labels[0] === 'string');
ok('backlog growth is visible in it', series.last > series.first,
  `${series.first} → ${series.last}`);
const windowed2 = parse(await cli.send('tools/call', { name: 'get_metric_series', arguments: { metric: 'inflow', last_days: 14 } }));
ok('last_days trims from the recent end', windowed2.values.length === 14
  && windowed2.to_day === session.ds.meta.days - 1);
const badMetric = await cli.send('tools/call', { name: 'get_metric_series', arguments: { metric: 'nope' } });
ok('an unknown metric is an isError result listing the real ones', badMetric.result.isError === true
  && Array.isArray(parse(badMetric).available));

const health = parse(await cli.send('tools/call', { name: 'get_health', arguments: {} }));
ok('health matches the engine exactly', health.score === session.engine.health.score
  && health.dimensions.length === session.engine.health.dimensions.length,
  `score ${health.score}, ${health.dimensions.length} dimensions`);
ok('every dimension ships the drivers behind its score',
  health.dimensions.every((d) => Array.isArray(d.drivers) && d.drivers.length > 0));

const desc = parse(await cli.send('tools/call', { name: 'describe_operation', arguments: {} }));
ok('describe_operation states the window, the counts and the thresholds',
  desc.counts.tickets === session.ds.meta.counts.tickets
  && typeof desc.detection.thresholds.rate_z === 'number'
  && desc.window.recent_days > 0);
ok('and names the release timeline the root-cause agent correlates against',
  desc.releases.length >= 3 && desc.releases.some((x) => /Refund policy/.test(x.label)));
ok('and says the data is simulated', /simulated/i.test(desc.note));

await cli.close();

/* ── The HTTP transport must agree with the stdio one ────────────────────── */

console.log('\n— HTTP transport (the localhost surface) —');

const PORT = 5599;
const httpChild = spawn(process.execPath, [rel('../mcp/http.js')], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
});
let banner = '';
httpChild.stdout.setEncoding('utf8');
httpChild.stdout.on('data', (c) => { banner += c; });
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('http server did not start')), 20000);
  const iv = setInterval(() => {
    if (/MCP endpoint/.test(banner)) { clearInterval(iv); clearTimeout(timer); resolve(); }
  }, 100);
  httpChild.on('exit', (code) => { clearInterval(iv); clearTimeout(timer); reject(new Error(`exited ${code}`)); });
});

const base = `http://127.0.0.1:${PORT}`;
const post = async (body) => {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

const hInit = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } });
ok('HTTP /mcp completes the same handshake',
  hInit.body?.result?.serverInfo?.name === init.result.serverInfo.name);

const hList = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
ok('and lists the identical tool set',
  JSON.stringify(hList.body.result.tools.map((t) => t.name))
  === JSON.stringify(tools.map((t) => t.name)));

const hBrief = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_executive_brief', arguments: {} } });
const hTop = JSON.parse(hBrief.body.result.content[0].text);
ok('and returns the same brief as stdio — one handler, two transports',
  JSON.stringify(hTop.top_3.map((t) => t.insight_id)) === JSON.stringify(top.top_3.map((t) => t.insight_id)),
  hTop.top_3.map((t) => t.insight_id).join(', '));

const hNotify = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
ok('a notification over HTTP is a 204 with no body', hNotify.status === 204 && hNotify.body === null);

const getMcp = await fetch(`${base}/mcp`);
ok('GET /mcp explains itself rather than 405ing', getMcp.status === 200
  && /jsonrpc/i.test(JSON.stringify(await getMcp.json())));

console.log('\n— Static serving: the apps still work on the same port —');

for (const [file, needle] of [
  ['/demo.html', 'Live Ops Floor'],
  ['/opspulse.html', 'opspulse'],
  ['/mcp-inspector.html', 'MCP Inspector'],
]) {
  const res = await fetch(base + file);
  const text = await res.text();
  ok(`${file} is served`, res.status === 200 && new RegExp(needle, 'i').test(text));
}
const mod = await fetch(`${base}/data/store.js`);
ok('ES modules are served as text/javascript (or the browser refuses to run them)',
  /text\/javascript/.test(mod.headers.get('content-type') || ''), mod.headers.get('content-type'));
const root = await fetch(`${base}/`);
ok('/ lands on the Live Ops Floor', root.status === 200 && /Live Ops Floor/i.test(await root.text()));
const missing = await fetch(`${base}/nope.html`);
ok('a missing file is a 404, not a stack trace', missing.status === 404);
const traversal = await fetch(`${base}/../../../Windows/win.ini`);
ok('path traversal cannot escape the repo root', traversal.status === 404 || traversal.status === 400,
  `status ${traversal.status}`);
const encoded = await fetch(`${base}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`);
ok('and cannot escape it URL-encoded either', encoded.status === 404 || encoded.status === 400,
  `status ${encoded.status}`);

/* ── The inspector page, actually running ────────────────────────────────── */

/* Asserting that the source CONTAINS `fetch('mcp'` proves nothing — a typo or a
   null deref anywhere in the script gives a blank page with every check still
   green, and on this machine the browser cannot reach localhost to catch it.
   So the script is executed. It has no imports and no top-level await (the
   handshake is an IIFE), so jsdom can eval it directly even though it is
   type="module", which jsdom will not run on its own. */

console.log('\n— The inspector page, executed —');

const page = fs.readFileSync(rel('../mcp-inspector.html'), 'utf8');
const { JSDOM } = await import('jsdom');
/* `runScripts: 'outside-only'` gives the window a real JS execution context —
   without it `window.eval` runs outside the document and the first line that
   touches `document` throws — while still leaving the page's own inline script
   unexecuted, so we control exactly when the handshake fires. */
const dom = new JSDOM(page, {
  url: `${base}/mcp-inspector.html`, pretendToBeVisual: true, runScripts: 'outside-only',
});
const win = dom.window;
const doc = win.document;

// jsdom has no fetch; hand it the real one, resolving the page-relative 'mcp'.
win.fetch = (u, o) => fetch(new URL(u, win.location.href), o);
const pageErrors = [];
win.addEventListener('error', (e) => pageErrors.push(e.message));

win.eval(doc.querySelector('script[type="module"]').textContent);
await new Promise((r2) => setTimeout(r2, 1200));      // let connect() complete

ok('the script runs without throwing', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
ok('the handshake completed and the server identified itself',
  /opspulse-decision-engine/.test(doc.getElementById('serverInfo').textContent),
  doc.getElementById('serverInfo').textContent);
ok('the status pill went green', doc.getElementById('status').className.includes('ok'),
  doc.getElementById('statusText').textContent);
ok('the tool list rendered every tool the server advertised',
  doc.querySelectorAll('#toolList .tool').length === tools.length,
  `${doc.querySelectorAll('#toolList .tool').length} buttons`);
ok('the preset questions rendered', doc.querySelectorAll('#presets button').length === 7,
  `${doc.querySelectorAll('#presets button').length} presets`);

// Selecting a tool must build its form from the schema — not a hard-coded list.
doc.querySelector('.tool[data-name="search_evidence"]').click();
ok('selecting a tool builds its form from the inputSchema',
  !!doc.getElementById('f_query') && !!doc.getElementById('f_limit'),
  [...doc.querySelectorAll('#fields [data-key]')].map((e) => e.dataset.key).join(', '));
ok('an enum argument renders as a select, not a free-text box',
  doc.getElementById('f_kind')?.tagName === 'SELECT'
  && doc.getElementById('f_kind').options.length === 4);
ok('the required argument is marked', !!doc.querySelector('label[for="f_query"] .req'));

doc.querySelector('.tool[data-name="get_health"]').click();
ok('a no-argument tool says so instead of rendering an empty form',
  /takes no arguments/i.test(doc.getElementById('fields').textContent));

// Now actually call one, end to end, through the page's own code path.
doc.querySelector('.tool[data-name="search_evidence"]').click();
doc.getElementById('f_query').value = 'refund window 30 days';
doc.getElementById('run').click();
await new Promise((r2) => setTimeout(r2, 1200));

const resultText = doc.getElementById('result').textContent;
ok('clicking Call tool replaces the placeholder with a real result',
  !/Pick a tool/.test(resultText) && resultText.length > 200, `${resultText.length} chars rendered`);
ok('and the rendered result is the grounded payload, with record ids',
  /record_id/.test(resultText) && /TK\d+/.test(resultText));
ok('the raw JSON-RPC pane shows both directions of the wire',
  /→/.test(doc.getElementById('wire').textContent)
  && /←/.test(doc.getElementById('wire').textContent)
  && /tools\/call/.test(doc.getElementById('wire').textContent));
ok('the result meta reports the tool, its latency and its size',
  /search_evidence/.test(doc.getElementById('resultMeta').textContent)
  && /ms/.test(doc.getElementById('resultMeta').textContent),
  doc.getElementById('resultMeta').textContent.replace(/\s+/g, ' '));
ok('the JSON is syntax-highlighted rather than dumped as a string',
  doc.getElementById('result').querySelectorAll('span.k').length > 3);

/* Ticket text is user-supplied in the real product. If a description ever
   contained markup, highlight() must not turn it into live DOM. */
ok('retrieved text is escaped, never injected as markup',
  doc.getElementById('result').querySelector('script') === null
  && !/<span class="k"><\/span>/.test(doc.getElementById('result').innerHTML));

// A preset must run the whole chain: select → populate → call → render.
doc.querySelectorAll('#presets button')[0].click();
await new Promise((r2) => setTimeout(r2, 1200));
ok('a preset question runs the full chain and renders the brief',
  /narrative_lines/.test(doc.getElementById('result').textContent)
  && doc.getElementById('status').className.includes('ok'));
ok('no errors were thrown across all of that', pageErrors.length === 0,
  pageErrors.slice(0, 2).join(' | '));

ok('the page tells the user what to run when the endpoint is unreachable',
  /node mcp\/http\.js/.test(page));

win.close();

await stop(httpChild);

console.log(`\n${fails ? r(`${fails} CHECK(S) FAILED`) : g('ALL MCP CHECKS PASSED')}  (${checks - fails}/${checks})\n`);

/* Set the code and let the loop drain rather than calling process.exit(). An
   immediate exit here aborts on Windows with a libuv assertion — the harness
   would print ALL CHECKS PASSED and still exit 127. The unref'd fallback
   force-exits if undici's keep-alive sockets hold the loop open. */
process.exitCode = fails ? 1 : 0;
setTimeout(() => process.exit(fails ? 1 : 0), 1500).unref();
