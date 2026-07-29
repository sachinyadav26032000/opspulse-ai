/* ==========================================================================
   Exposure — the accounts behind a decision, and why each one is at risk.
   --------------------------------------------------------------------------
   WHAT IS DERIVED vs WHAT IS AUTHORED (this distinction is the whole point):

     DERIVED from the system of record — never written by hand:
       account identity, ARR, plan, region, renewal date, CSM/owner,
       every signal value, every delta, every observed_at timestamp.

     AUTHORED — a template standing in for what a language model generates in
     the shipped product:
       the risk_reason SENTENCE STRUCTURE, and the grouping of raw records
       into named source systems.

   The facts inside an authored sentence are still read off records. Nothing
   here invents a number. If a signal does not exist for an account it is
   omitted rather than filled in — an account with two sources shows two.

   Why only the top N by ARR: the churn detector legitimately flags ~59
   accounts. Fifty-nine accounts is a list, not a decision. Ranking by revenue
   exposure and cutting to six is the Prioritise step — see demo/SEED_NOTES.md.
   ========================================================================== */

const DAY = 86400000;

export const EXPOSURE_LIMIT = 6;

const iso = (ms) => new Date(ms).toISOString();
const when = (ds, rec) =>
  (rec.created_at ?? rec.submitted_at ?? (ds.meta.day0 + (rec.day_index ?? 0) * DAY));

/** Recent window vs the baseline before it, as the engine defines them. */
const split = (ds, rows) => ({
  recent: rows.filter((r) => r.day_index >= ds.meta.recent_from),
  base: rows.filter((r) => r.day_index < ds.meta.recent_from),
});

const signed = (n) => (n > 0 ? `+${n}` : String(n));

/**
 * Build the exposed-account list for a decision.
 * Returns [] when the insight carries no account-level ids.
 */
export function buildExposedAccounts(ds, insight, limit = EXPOSURE_LIMIT) {
  const ids = insight?._meta?.affected_ids || [];
  if (!ids.length || !ds.accounts?.length) return [];

  const byId = new Map(ds.accounts.map((a) => [a.account_id, a]));
  const picked = ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .sort((a, b) => b.arr_usd - a.arr_usd)
    .slice(0, limit);

  return picked.map((a) => buildOne(ds, a));
}

/**
 * The same account detail, for ONE account, with no insight context.
 *
 * The cohort table reaches accounts that no insight has flagged — that is the
 * point of it, since a renewal with falling adoption may not have tripped any
 * detector yet. Without this the row would have nowhere to go.
 */
export function buildAccountDetail(ds, accountId) {
  const acct = ds.accounts.find((a) => a.account_id === accountId);
  return acct ? buildOne(ds, acct) : null;
}

function buildOne(ds, acct) {
  const windowDays = ds.meta.days - ds.meta.recent_from;
  const tickets = ds.tickets.filter((t) => t.account_id === acct.account_id);
  const escal = ds.escalations.filter((x) => x.account_id === acct.account_id);
  const nps = ds.nps.filter((x) => x.account_id === acct.account_id);

  const t = split(ds, tickets);
  const e = split(ds, escal);
  const openT = tickets.filter((x) => !x.resolved_at);
  const rated = tickets.filter((x) => x.customer_satisfaction_rating != null);
  const ratedRecent = rated.filter((x) => x.day_index >= ds.meta.recent_from);
  const lastEsc = escal.slice().sort((x, y) => (y.day_index ?? 0) - (x.day_index ?? 0))[0];
  const lastNps = nps.slice().sort((x, y) => (y.day_index ?? 0) - (x.day_index ?? 0))[0];
  const cancel = escal.find((x) => /cancel/i.test(x.category || '') || /cancel/i.test(x.reason || ''));
  const cancelOpen = !!cancel && cancel.status !== 'Closed';
  const cancelAgo = cancel ? Math.max(0, ds.meta.days - 1 - (cancel.day_index ?? 0)) : null;
  const cancelRecent = !!cancel && cancelAgo <= windowDays;

  const mean = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);
  const csatRecent = mean(ratedRecent.map((x) => x.customer_satisfaction_rating));
  const csatBase = mean(rated.filter((x) => x.day_index < ds.meta.recent_from).map((x) => x.customer_satisfaction_rating));

  /* ── Supporting signals · every value read off a record ─────────────────
     Grouped under the source system a real deployment would pull them from.
     A signal with no underlying record is omitted, never zero-filled. */
  const signals = [];

  if (e.recent.length || escal.length) {
    signals.push({
      source: 'CRM · Escalations',
      metric: 'Escalations raised',
      value: `${e.recent.length} in ${windowDays}d`,
      delta: `${signed(e.recent.length - e.base.length)} vs prior period`,
      observed_at: lastEsc ? iso(when(ds, lastEsc)) : null,
      detail: lastEsc ? `Most recent: ${lastEsc.severity} — ${lastEsc.reason}` : null,
    });
  }

  /* If the risk_reason cites a cancellation that is NOT the most recent
     escalation, it would otherwise be quoted but never shown. Surface it as its
     own signal so every claim in the sentence is corroborated on the panel. */
  if (cancel && lastEsc && cancel.escalation_id !== lastEsc.escalation_id) {
    signals.push({
      source: 'CRM · Escalations',
      metric: 'Cancellation case',
      value: `${cancel.severity} · ${cancel.status}`,
      delta: `${cancelAgo} day${cancelAgo === 1 ? '' : 's'} ago`,
      observed_at: iso(when(ds, cancel)),
      detail: cancel.reason,
    });
  }

  if (tickets.length) {
    signals.push({
      source: 'Ticketing',
      metric: 'Tickets opened',
      value: `${t.recent.length} in ${windowDays}d`,
      delta: `${signed(t.recent.length - t.base.length)} vs prior period`,
      observed_at: iso(when(ds, tickets.slice().sort((x, y) => y.day_index - x.day_index)[0])),
      detail: openT.length ? `${openT.length} still open` : 'All resolved',
    });
  }

  if (csatRecent != null) {
    signals.push({
      source: 'Survey · CSAT',
      metric: 'Mean satisfaction',
      value: `${csatRecent.toFixed(1)}★`,
      delta: csatBase != null ? `${signed(+(csatRecent - csatBase).toFixed(1))} vs prior period` : 'no prior ratings',
      observed_at: iso(when(ds, ratedRecent.slice().sort((x, y) => y.day_index - x.day_index)[0])),
      detail: `${ratedRecent.length} rated ticket${ratedRecent.length === 1 ? '' : 's'} in window`,
    });
  }

  if (lastNps) {
    signals.push({
      source: 'Survey · NPS',
      metric: 'Last NPS response',
      value: String(lastNps.score),
      delta: lastNps.segment,
      observed_at: iso(when(ds, lastNps)),
      detail: lastNps.verbatim ? `“${lastNps.verbatim}”` : null,
    });
  }

  signals.push({
    source: 'CRM · Contract',
    metric: 'Renewal',
    value: `${acct.renewal_in_days} days`,
    delta: `${acct.plan} · ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(acct.arr_usd)} ARR`,
    observed_at: iso(ds.meta.as_of),
    detail: acct.renewal_in_days <= 30 ? 'Inside the renewal window' : null,
  });

  return {
    account_id: acct.account_id,
    account_name: acct.company,
    arr_usd: acct.arr_usd,
    plan: acct.plan,
    region: acct.region,
    renewal_date: iso(ds.meta.as_of + acct.renewal_in_days * DAY).slice(0, 10),
    renewal_in_days: acct.renewal_in_days,
    owner: acct.csm,
    contact_name: acct.contact_name,
    risk_reason: riskReason({ acct, days: ds.meta.days, windowDays, e, t, openT, cancel, cancelOpen, cancelRecent, cancelAgo, lastEsc, csatRecent, csatBase, lastNps }),
    recommended_action: recommendedAction({ acct, cancel, cancelOpen, cancelRecent, lastEsc, csatRecent }),
    supporting_signals: signals,
  };
}

/* ── AUTHORED: sentence structure only ────────────────────────────────────
   Stands in for the model-written explanation in the shipped product. The
   clauses are chosen by which risk actually dominates for this account, and
   every figure interpolated below comes from a record. */
function riskReason({ acct, days, windowDays, e, t, openT, cancel, cancelOpen, cancelRecent, cancelAgo, lastEsc, csatRecent, csatBase, lastNps }) {
  const clauses = [];
  const daysAgo = (rec) => (rec == null ? null : Math.max(0, days - 1 - (rec.day_index ?? 0)));
  const agoPhrase = (n) => (n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`);
  let ledWithRenewal = false;

  /* The generator carries only two cancellation reasons, so quoting the reason
     verbatim opened three of six accounts with an identical clause — which
     reads as generated, and that is the one thing this field must not do.
     Lead on what genuinely differs: whether the case is still open, how recent
     it is, and whether the renewal is the more urgent fact. An 80-day-old
     closed case is history; a renewal in 9 days is the reason to act today. */
  const ago = cancelAgo;

  if (cancelOpen) {
    clauses.push(`A ${cancel.severity} cancellation case has been open since ${agoPhrase(ago)}`);
  } else if (acct.renewal_in_days <= 30) {
    clauses.push(`Renewal is ${acct.renewal_in_days} days away`);
    ledWithRenewal = true;
  } else if (cancelRecent) {
    clauses.push(`Raised a ${cancel.severity} cancellation case ${agoPhrase(ago)}, now closed`);
  } else if (e.recent.length >= 2) {
    clauses.push(`${e.recent.length} escalations in the last ${windowDays} days, the most recent a ${lastEsc.severity} on ${lastEsc.category.toLowerCase()}`);
  } else if (e.recent.length === 1) {
    clauses.push(`Escalated once in the last ${windowDays} days — ${lastEsc.severity}, ${lastEsc.reason.toLowerCase()}`);
  } else if (cancel) {
    clauses.push(`Carries a ${cancel.severity} cancellation case from ${agoPhrase(ago)}`);
  } else if (lastEsc) {
    clauses.push(`Escalated earlier in the quarter (${lastEsc.severity}, ${lastEsc.reason.toLowerCase()}) with no repeat since`);
  }

  /* If the renewal led, the cancellation history still belongs in the sentence. */
  if (ledWithRenewal && cancel) {
    clauses.push(`and this account already raised a ${cancel.severity} cancellation case ${agoPhrase(ago)}`);
  }

  if (csatRecent != null && csatBase != null && csatRecent < csatBase) {
    clauses.push(`satisfaction has slipped from ${csatBase.toFixed(1)}★ to ${csatRecent.toFixed(1)}★`);
  } else if (csatRecent != null && csatRecent <= 2.5) {
    clauses.push(`satisfaction is sitting at ${csatRecent.toFixed(1)}★`);
  } else if (lastNps && lastNps.score <= 6) {
    clauses.push(`the last NPS response was a ${lastNps.score}`);
  } else if (openT.length) {
    clauses.push(`${openT.length} ticket${openT.length === 1 ? ' is' : 's are'} still open`);
  } else if (t.recent.length > t.base.length) {
    clauses.push(`contact volume is up (${t.recent.length} ticket${t.recent.length === 1 ? '' : 's'} this window against ${t.base.length} before it)`);
  }

  if (!ledWithRenewal && acct.renewal_in_days <= 30) {
    clauses.push(`and the renewal is ${acct.renewal_in_days} days away`);
  } else if (!ledWithRenewal && acct.renewal_in_days <= 120) {
    clauses.push(`with renewal in ${acct.renewal_in_days} days`);
  }

  /* One short clause reads like a stub. If nothing else qualified, cite what the
     escalation was actually about — it is the most specific fact available. */
  if (clauses.length === 1 && lastEsc) {
    clauses.push(`the open thread was “${lastEsc.reason.toLowerCase()}”`);
  }

  if (!clauses.length) return `Flagged by the churn rule on repeat contact, with renewal in ${acct.renewal_in_days} days.`;
  const s = clauses.join(clauses.length > 2 ? ', ' : ', ');
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

/* AUTHORED: which play to run. Owner is derived (the account's own CSM).
   The cancellation branch MUST check status: an account whose case was closed
   last week needs a different play from one arguing with you right now, and
   claiming a closed case is "already open" contradicts the risk_reason on the
   very same card. */
function recommendedAction({ acct, cancel, cancelOpen, cancelRecent, lastEsc, csatRecent }) {
  let action;
  if (cancelOpen) {
    action = 'Executive save call this week — the cancellation case is still open, so a CSM touch alone will not hold it.';
  } else if (cancel && cancelRecent && acct.renewal_in_days <= 60) {
    action = `Renewal lands in ${acct.renewal_in_days} days and they have already tried to leave once — put an exec on the call, not a check-in.`;
  } else if (cancel && cancelRecent && acct.arr_usd >= 100000) {
    action = 'Executive save call — the case closed without a renewal commitment, and this is a top-decile account by ARR.';
  } else if (cancel && cancelRecent) {
    action = 'Run the save play now while the case is still fresh — closed is not the same as resolved.';
  } else if (cancel) {
    action = 'Treat the renewal as contested: this account has cancelled once before, so open with what changed since.';
  } else if (acct.renewal_in_days <= 30) {
    action = 'Bring the renewal conversation forward and clear every open ticket before it starts.';
  } else if (lastEsc && lastEsc.sla_breached) {
    action = 'Acknowledge the missed SLA directly, then confirm the fix in writing before the next review.';
  } else if (csatRecent != null && csatRecent <= 3) {
    action = 'Schedule a service review — the dissatisfaction is measured, not anecdotal.';
  } else {
    action = 'Proactive check-in ahead of renewal, with the escalation history acknowledged up front.';
  }
  return { action, owner: acct.csm, owner_role: 'Account CSM' };
}
