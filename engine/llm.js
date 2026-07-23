'use strict';
/* ==========================================================================
   OpsPulse Decision Engine — LLM seam (pluggable)
   --------------------------------------------------------------------------
   Deliberate architecture choice: DETECTION STAYS STATISTICAL. The LLM is used
   only where it is strong — turning already-structured, deterministic inputs
   into plain-language narration:
       • Root Cause  → explain a correlation the engine already found
       • Recommendation → adapt a matched playbook to the specifics
       • Executive Summary → narrate a brief over a ranked, structured set
   It is NEVER asked to notice an anomaly in noisy time-series. "Keep the boring
   part boring."

   In this prototype the default provider is a deterministic template renderer
   (no network, fully reproducible). The `claude` provider is the production
   seam: drop in the Anthropic SDK and every call site stays identical.
   ========================================================================== */

/**
 * Production seam. Wire the Anthropic SDK here and set OPSPULSE_LLM=claude.
 * Kept as a stub so the prototype runs offline & deterministically.
 *
 *   const Anthropic = require('@anthropic-ai/sdk');
 *   const client = new Anthropic();
 *   const msg = await client.messages.create({
 *     model: 'claude-opus-4-8',           // strong tier for exec summary
 *     max_tokens: 400,
 *     system: 'You narrate structured ops insights. Never invent facts not in the input.',
 *     messages: [{ role: 'user', content: JSON.stringify(structuredInput) }],
 *   });
 *   return msg.content[0].text;
 */
async function claudeComplete(/* { system, input, model } */) {
  throw new Error('claude provider not configured in prototype — set up @anthropic-ai/sdk');
}

/** Template provider — deterministic, offline, used by default. */
const templates = {
  root_cause: (x) => x.text,
  recommendation: (x) => x.text,
  exec_summary: (x) => x.text,
};

async function narrate(kind, structuredInput) {
  const provider = process.env.OPSPULSE_LLM || 'template';
  if (provider === 'claude') {
    return claudeComplete({
      system: 'You narrate structured ops insights over deterministic inputs. Never invent facts.',
      input: structuredInput,
      model: kind === 'exec_summary' ? 'claude-opus-4-8' : 'claude-haiku-4-5-20251001',
    });
  }
  return templates[kind](structuredInput);
}

module.exports = { narrate };
