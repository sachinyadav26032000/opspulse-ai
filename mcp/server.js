#!/usr/bin/env node
/* ==========================================================================
   MCP stdio transport — the entry point Claude Desktop / Claude Code spawns.
   --------------------------------------------------------------------------
   Newline-delimited JSON in on stdin, newline-delimited JSON out on stdout.

   THE RULE THAT BREAKS THIS SERVER IF IGNORED: stdout carries the protocol and
   nothing else. A stray console.log — a debug line, a deprecation warning, a
   "server started" banner — lands in the middle of the JSON stream and the
   client's parser dies on it, usually with an error that points nowhere near
   the print statement. Diagnostics go to stderr, which the client shows in its
   logs and ignores otherwise.

   Run it directly to check it loads:
       node mcp/server.js            # then paste a JSON-RPC line and press enter
   Or drive it properly:
       node tools/mcpcheck.mjs
   ========================================================================== */

import { createSession } from './tools.js';
import { handleLine, SERVER_INFO } from './rpc.js';

const log = (...a) => process.stderr.write(`[opspulse-mcp] ${a.join(' ')}\n`);

let session;
try {
  session = createSession();
} catch (e) {
  log('failed to build the dataset:', e?.stack || e);
  process.exit(1);
}

log(
  `${SERVER_INFO.name} v${SERVER_INFO.version} ready — seed ${session.seed}, ` +
  `${session.ds.tickets.length} tickets, ${session.engine.insights.length} insights, ` +
  `${session.index.n} indexed passages`,
);

const send = (msg) => { if (msg) process.stdout.write(`${JSON.stringify(msg)}\n`); };

/* Manual line buffering rather than readline: a large tool result can arrive
   split across chunk boundaries, and a partial line parsed as JSON is a parse
   error that looks like a protocol bug. Hold the tail until its newline. */
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try {
      send(handleLine(session, line));
    } catch (e) {
      // A thrown handler must not take the process down — the client would
      // see the pipe close with no explanation.
      log('handler threw:', e?.stack || e);
      send({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } });
    }
  }
});

// The client closing the pipe is how a session ends; that is not a failure.
process.stdin.on('end', () => { log('stdin closed — exiting'); process.exit(0); });
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
