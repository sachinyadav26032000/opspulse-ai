#!/usr/bin/env node
/* ==========================================================================
   One process, one port: the apps AND the MCP endpoint.
   --------------------------------------------------------------------------
       node mcp/http.js            → http://localhost:5500

   Serves the repo as static files (so demo.html, opspulse.html, servicedesk.html
   and app.html all work exactly as they do under `python -m http.server`) and
   mounts the MCP JSON-RPC handler at POST /mcp.

   Same origin for both, deliberately. A second process on a second port would
   mean CORS preflights, two commands to start, and a browser inspector that
   silently fails when only one of them is running. One port removes all three.

   The HTTP transport exists for the inspector page and for curl — the canonical
   client transport is stdio (`mcp/server.js`). Both hand the same messages to
   the same `handle()` in rpc.js, so a tool that works in the browser works in
   Claude Desktop without a second implementation to keep in sync.
   ========================================================================== */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSession } from './tools.js';
import { handleLine, SERVER_INFO } from './rpc.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 5500;
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',   // ES modules are blocked without this
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const session = createSession();

/* Resolve a request path to a file inside ROOT, or null. The containment check
   is the load-bearing line: `decodeURIComponent` turns %2e%2e%2f back into
   ../, so a path that looked safe as a string can escape once decoded. Resolve
   first, then verify the result is still under ROOT. */
function resolveStatic(urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (rel === '/' || rel === '') rel = '/demo.html';
  const full = path.resolve(ROOT, `.${rel}`);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return full;
}

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
};

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  /* ── MCP endpoint ─────────────────────────────────────────────────────── */
  if (url.split('?')[0] === '/mcp') {
    if (req.method === 'GET') {
      // A plain browser visit should explain itself rather than 405ing.
      return json(res, 200, {
        server: SERVER_INFO,
        transport: 'POST a JSON-RPC 2.0 message to this path.',
        try: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        inspector: '/mcp-inspector.html',
      });
    }
    if (req.method !== 'POST') {
      return json(res, 405, { error: 'Use POST for JSON-RPC.' });
    }
    let raw;
    try {
      raw = await readBody(req);
    } catch (e) {
      return json(res, 413, { jsonrpc: '2.0', id: null, error: { code: -32600, message: e.message } });
    }
    let out;
    try {
      out = handleLine(session, raw);
    } catch (e) {
      process.stderr.write(`[opspulse-mcp] handler threw: ${e?.stack || e}\n`);
      return json(res, 500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } });
    }
    // A notification produces no response body — 204, not an empty 200.
    if (out === null) { res.writeHead(204); return res.end(); }
    return json(res, 200, out);
  }

  /* ── Static files ─────────────────────────────────────────────────────── */
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(res, 405, { error: 'Method not allowed' });
  }
  const file = resolveStatic(url);
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('404 Not Found');
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'content-length': body.length,
    'cache-control': 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    process.stderr.write(
      `\n  Port ${PORT} is already in use — something else is serving there.\n` +
      `  Stop it, or run:  PORT=5510 node mcp/http.js\n\n`,
    );
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, HOST, () => {
  const base = `http://localhost:${PORT}`;
  process.stdout.write(
    `\n  OpsPulse — one process, one port\n` +
    `  ${'-'.repeat(46)}\n` +
    `  Live Ops Floor   ${base}/demo.html\n` +
    `  OpsPulse         ${base}/opspulse.html\n` +
    `  NorthDesk        ${base}/servicedesk.html\n` +
    `  Ops Copilot      ${base}/app.html\n` +
    `  MCP inspector    ${base}/mcp-inspector.html\n` +
    `  MCP endpoint     POST ${base}/mcp\n` +
    `  ${'-'.repeat(46)}\n` +
    `  seed ${session.seed} · ${session.ds.tickets.length} tickets · ` +
    `${session.engine.insights.length} insights · ${session.index.n} indexed passages\n\n`,
  );
});
