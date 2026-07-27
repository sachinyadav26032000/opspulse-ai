/* ==========================================================================
   MCP over JSON-RPC 2.0 — the protocol, with no transport opinion.
   --------------------------------------------------------------------------
   Hand-rolled rather than taken from the SDK, for the same reason the charts
   in this repo are hand-rolled SVG: the whole prototype installs nothing, and
   the part of MCP a read-only tool server actually needs is `initialize`,
   `tools/list` and `tools/call`. That is this file.

   The risk of hand-rolling a protocol is passing your own tests and failing a
   real client, so the shapes below follow the spec literally — `tools/call`
   returns a `content` array of typed blocks (not a bare object), a tool that
   fails returns `isError: true` INSIDE a successful result rather than a
   JSON-RPC error, and only genuine protocol faults (unknown method, malformed
   request) produce an `error` member. `tools/mcpcheck.mjs` drives a real
   handshake over a real pipe against this, not against the functions directly.

   Transport-agnostic on purpose: `server.js` speaks stdio for Claude Desktop
   and Claude Code, `http.js` speaks HTTP for the browser inspector, and both
   hand raw messages to the same `handle()`.
   ========================================================================== */

import { TOOLS, callTool } from './tools.js';

export const SERVER_INFO = { name: 'opspulse-decision-engine', version: '1.0.0' };

/* Versions this server knows how to speak. If a client asks for one of these
   we echo it back; otherwise we answer with our preferred version and let the
   client decide whether it can proceed — which is what the spec asks for and
   is strictly better than echoing a version we do not implement. */
const SUPPORTED = new Set(['2025-06-18', '2025-03-26', '2024-11-05']);
const PREFERRED = '2024-11-05';

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message, data) => ({
  jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data },
});

/**
 * Handle one decoded JSON-RPC message.
 * @returns the response object, or `null` for notifications (which by spec
 *          must produce no reply at all — returning `{}` here would make some
 *          clients treat a fire-and-forget notice as a failed request).
 */
export function handle(session, msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return fail(msg?.id ?? null, -32600, 'Invalid Request');
  }

  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion;
      return ok(id, {
        protocolVersion: SUPPORTED.has(asked) ? asked : PREFERRED,
        // Only tools. No resources, no prompts, no sampling — claiming a
        // capability we do not implement is how a client ends up calling a
        // method that returns -32601 in the middle of a conversation.
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'OpsPulse is a decision engine over a live customer-operations dataset. ' +
          'Detection is statistical; your job is to choose and narrate what it found, ' +
          'never to compute a number yourself. Call describe_operation first to ground ' +
          'the window and sample sizes. Call explain_insight before quoting any dollar ' +
          'figure — the range and its arithmetic are returned together. Insights with ' +
          'status held_for_review are below the confidence cutoff and must be presented ' +
          'as such. Compliance exposure is deliberately uncosted; do not estimate it. ' +
          'Quote record_id when citing retrieved text. All data is simulated.',
      });
    }

    // Notifications: acknowledged by producing no response at all.
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;

    case 'ping':
      return isNotification ? null : ok(id, {});

    case 'tools/list':
      return ok(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });

    case 'tools/call': {
      const name = params?.name;
      if (typeof name !== 'string') return fail(id, -32602, 'Invalid params: name is required');
      try {
        const result = callTool(session, name, params.arguments ?? {});
        /* Content blocks, not a bare object. A tool-level problem (bad insight
           id, unknown metric) rides back as an ordinary result flagged with
           isError so the model can read the message and correct itself; a
           JSON-RPC error would abort the turn instead. */
        return ok(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !!result?.error,
        });
      } catch (e) {
        if (e && e.code === -32601) return fail(id, -32601, e.message);
        return ok(id, {
          content: [{ type: 'text', text: `Tool "${name}" failed: ${e?.message || String(e)}` }],
          isError: true,
        });
      }
    }

    // Declared unsupported explicitly rather than falling through to a generic
    // "method not found", so a client probing capabilities gets a clear answer.
    case 'resources/list':
      return ok(id, { resources: [] });
    case 'prompts/list':
      return ok(id, { prompts: [] });

    default:
      return isNotification ? null : fail(id, -32601, `Method not found: ${method}`);
  }
}

/** Parse one line and handle it. Malformed JSON is a -32700, per spec. */
export function handleLine(session, line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return fail(null, -32700, 'Parse error');
  }
  // Batches are legal JSON-RPC; a client that sends one should not get silence.
  if (Array.isArray(msg)) {
    if (!msg.length) return fail(null, -32600, 'Invalid Request');
    const out = msg.map((m) => handle(session, m)).filter(Boolean);
    return out.length ? out : null;
  }
  return handle(session, msg);
}
