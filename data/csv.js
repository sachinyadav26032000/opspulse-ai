/* ==========================================================================
   CSV parsing + ingestion mapping (the Data Upload screen's real engine)
   --------------------------------------------------------------------------
   Upload is not a progress bar here. A parsed file is mapped onto the internal
   schema, appended to the live dataset, and the decision engine re-runs over
   it — so a CSV you drop in genuinely changes what the Decision Feed says.

   Column mapping is tolerant: it accepts the exact Kaggle
   `customer_support_tickets.csv` headers, the internal snake_case names, and
   common variants, because real exports never match a spec exactly.
   ========================================================================== */

/** RFC-4180-ish parser: handles quoted fields, embedded commas/newlines, "". */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const src = text.replace(/^﻿/, '');            // strip BOM

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* ignore */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => h.trim());
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    if (rows[r].length === 1 && rows[r][0].trim() === '') continue;
    const o = {};
    headers.forEach((h, i) => { o[h] = (rows[r][i] ?? '').trim(); });
    out.push(o);
  }
  return { headers, rows: out };
}

export function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n');
}

/* ── Column resolution ───────────────────────────────────────────────────── */

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const ALIASES = {
  ticket: {
    ticket_id: ['ticket_id', 'id', 'case_id', 'ticket_number', 'number'],
    customer_name: ['customer_name', 'name', 'requester', 'contact_name'],
    customer_email: ['customer_email', 'email', 'requester_email'],
    customer_age: ['customer_age', 'age'],
    customer_gender: ['customer_gender', 'gender'],
    product_purchased: ['product_purchased', 'product'],
    date_of_purchase: ['date_of_purchase', 'purchase_date'],
    ticket_type: ['ticket_type', 'type'],
    ticket_subject: ['ticket_subject', 'subject', 'title', 'summary'],
    ticket_description: ['ticket_description', 'description', 'body', 'message'],
    ticket_status: ['ticket_status', 'status', 'state'],
    resolution: ['resolution', 'resolution_notes'],
    ticket_priority: ['ticket_priority', 'priority', 'severity'],
    ticket_channel: ['ticket_channel', 'channel', 'source', 'via'],
    first_response_time_min: ['first_response_time_min', 'first_response_time', 'frt', 'first_reply_time'],
    time_to_resolution_hrs: ['time_to_resolution_hrs', 'time_to_resolution', 'resolution_time'],
    customer_satisfaction_rating: ['customer_satisfaction_rating', 'csat', 'satisfaction', 'rating'],
    created_at: ['created_at', 'created', 'date_created', 'opened_at', 'first_response_time'],
    resolved_at: ['resolved_at', 'closed_at', 'date_closed'],
    category: ['category', 'ticket_type', 'topic'],
    team: ['team', 'group', 'queue'],
    agent_id: ['agent_id', 'assignee', 'assigned_to', 'agent'],
    account_id: ['account_id', 'organization_id', 'company_id'],
    company: ['company', 'organization', 'account'],
    escalated: ['escalated', 'is_escalated'],
    tag: ['tag', 'tags', 'label'],
  },
  nps: {
    response_id: ['response_id', 'id'],
    score: ['score', 'nps', 'nps_score', 'rating'],
    submitted_at: ['submitted_at', 'date', 'created_at', 'response_date'],
    account_id: ['account_id', 'company_id'],
    company: ['company', 'organization', 'account'],
    contact_name: ['contact_name', 'name', 'respondent'],
    verbatim: ['verbatim', 'comment', 'feedback', 'comments'],
    driver_tag: ['driver_tag', 'driver', 'theme', 'reason'],
    plan: ['plan', 'tier'],
    arr_usd: ['arr_usd', 'arr', 'revenue'],
  },
  qa: {
    qa_id: ['qa_id', 'id', 'review_id'],
    agent_id: ['agent_id', 'agent'],
    agent_name: ['agent_name', 'agent', 'name'],
    reviewed_at: ['reviewed_at', 'date', 'review_date'],
    overall_score: ['overall_score', 'score', 'qa_score', 'total'],
    team: ['team', 'group'],
    reviewer: ['reviewer', 'evaluator'],
    ticket_id: ['ticket_id', 'case_id'],
    note: ['note', 'notes', 'comment'],
  },
};

/** Best-effort header → field map, plus the fields that could not be found. */
export function resolveColumns(headers, kind) {
  const spec = ALIASES[kind] || ALIASES.ticket;
  const normalized = new Map(headers.map((h) => [norm(h), h]));
  const map = {}, missing = [];
  for (const [field, aliases] of Object.entries(spec)) {
    const hit = aliases.map(norm).find((a) => normalized.has(a));
    if (hit) map[field] = normalized.get(hit);
    else missing.push(field);
  }
  return { map, missing, matched: Object.keys(map).length };
}

/* ── Value coercion ──────────────────────────────────────────────────────── */

const PRIORITY = { critical: 'Critical', urgent: 'Critical', high: 'High', p1: 'Critical', p2: 'High', medium: 'Medium', normal: 'Medium', low: 'Low', p3: 'Medium', p4: 'Low' };
const STATUS_MAP = { open: 'Open', new: 'Open', pending: 'Pending Customer Response', 'pending customer response': 'Pending Customer Response', hold: 'Pending Customer Response', solved: 'Resolved', resolved: 'Resolved', closed: 'Closed' };

const num = (v) => { const n = Number(String(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null; };
const date = (v) => { if (!v) return null; const t = Date.parse(v); return Number.isFinite(t) ? t : null; };

/** Day binning must FLOOR, not round — rounding pushes anything after midday
 *  into the next bucket, which silently rejected half of any same-day import. */
const dayIndexOf = (ms, ds) => Math.floor((ms - ds.meta.day0) / 86400000);

/* Kaggle "Ticket Type" values are not our internal categories. Mapping them
   keeps uploaded rows inside the same category dimension the detectors group
   on — otherwise an import quietly creates parallel categories that no
   baseline exists for, and every one of them looks like an emerging topic. */
const CATEGORY_ALIASES = {
  'refund request': 'Refund', refund: 'Refund', refunds: 'Refund',
  'technical issue': 'Technical', technical: 'Technical', bug: 'Technical', 'product issue': 'Technical',
  'billing inquiry': 'Billing', billing: 'Billing', invoice: 'Billing', payment: 'Billing',
  'cancellation request': 'Cancellation', cancellation: 'Cancellation', churn: 'Cancellation',
  'product inquiry': 'Product Feedback', 'feature request': 'Product Feedback', feedback: 'Product Feedback',
  onboarding: 'Onboarding', setup: 'Onboarding', implementation: 'Onboarding',
  'account access': 'Account Access', login: 'Account Access', access: 'Account Access', password: 'Account Access',
  integration: 'Integrations', integrations: 'Integrations', api: 'Integrations',
  privacy: 'Data & Privacy', gdpr: 'Data & Privacy', 'data & privacy': 'Data & Privacy', dsar: 'Data & Privacy',
};
const KNOWN_CATEGORIES = new Set(['Billing', 'Refund', 'Technical', 'Integrations', 'Account Access', 'Onboarding', 'Product Feedback', 'Cancellation', 'Data & Privacy']);
const TEAM_OF = {
  Billing: 'Billing Ops', Refund: 'Billing Ops', Technical: 'Technical Support',
  Integrations: 'Technical Support', 'Account Access': 'Technical Support', Onboarding: 'Onboarding',
  'Product Feedback': 'Onboarding', Cancellation: 'Retention', 'Data & Privacy': 'Trust & Safety',
};

function normalizeCategory(raw) {
  const s = String(raw || '').trim();
  if (KNOWN_CATEGORIES.has(s)) return s;
  return CATEGORY_ALIASES[s.toLowerCase()] || 'Technical';
}

/**
 * Map parsed rows onto the internal ticket shape and stamp them into the
 * dataset's day grid so every existing aggregation just works.
 */
export function mapTickets(rows, colMap, ds) {
  const DAY_MS = 86400000;
  const out = [], errors = [];
  const get = (r, f) => (colMap[f] ? r[colMap[f]] : undefined);
  const accountIds = new Set(ds.accounts.map((a) => a.account_id));
  const teams = new Set(ds.tickets.map((t) => t.team));

  rows.forEach((r, i) => {
    const created = date(get(r, 'created_at')) ?? date(get(r, 'date_of_purchase')) ?? ds.meta.as_of - Math.random() * 7 * DAY_MS;
    const dayIndex = dayIndexOf(created, ds);
    if (dayIndex < 0 || dayIndex >= ds.meta.days) {
      errors.push(`row ${i + 2}: created date outside the ${ds.meta.days}-day analysis window — skipped`);
      return;
    }
    const category = normalizeCategory(get(r, 'category') || get(r, 'ticket_type'));
    const priority = PRIORITY[String(get(r, 'ticket_priority') || '').toLowerCase()] || 'Medium';
    const status = STATUS_MAP[String(get(r, 'ticket_status') || '').toLowerCase()] || 'Open';
    const resolvedAt = date(get(r, 'resolved_at'));
    const acct = get(r, 'account_id');

    out.push({
      ticket_id: String(get(r, 'ticket_id') || `UP${String(i + 1).padStart(5, '0')}`),
      customer_name: get(r, 'customer_name') || 'Unknown',
      customer_email: get(r, 'customer_email') || '',
      customer_age: num(get(r, 'customer_age')),
      customer_gender: get(r, 'customer_gender') || '',
      product_purchased: get(r, 'product_purchased') || '',
      date_of_purchase: get(r, 'date_of_purchase') || '',
      ticket_type: get(r, 'ticket_type') || category,
      ticket_subject: get(r, 'ticket_subject') || '(no subject)',
      ticket_description: get(r, 'ticket_description') || '',
      ticket_status: resolvedAt ? (status === 'Open' ? 'Resolved' : status) : status,
      resolution: get(r, 'resolution') || '',
      ticket_priority: priority,
      ticket_channel: get(r, 'ticket_channel') || 'Email',
      first_response_time_min: num(get(r, 'first_response_time_min')) ?? 40,
      time_to_resolution_hrs: num(get(r, 'time_to_resolution_hrs')) ?? (resolvedAt ? (resolvedAt - created) / 3600000 : null),
      customer_satisfaction_rating: num(get(r, 'customer_satisfaction_rating')),
      // Distinct-customer counts are a headline number ("231 customers
      // affected"), so uploaded rows must not all collapse into one pseudo
      // account. With no account id column, derive a stable key from whatever
      // identifies the customer in the file.
      account_id: acct && accountIds.has(acct) ? acct
        : acct || 'UP:' + (get(r, 'customer_email') || get(r, 'company') || get(r, 'customer_name') || `row${i}`),
      company: get(r, 'company') || 'Uploaded source',
      plan: 'Growth', arr_usd: 0, region: 'Uploaded',
      agent_id: get(r, 'agent_id') || 'UPLOAD',
      team: teams.has(get(r, 'team')) ? get(r, 'team') : (TEAM_OF[category] || 'Technical Support'),
      category,
      tag: get(r, 'tag') || 'uploaded',
      created_at: created,
      day_index: dayIndex,
      resolved_at: resolvedAt,
      sla_target_hrs: priority === 'Critical' ? 4 : priority === 'High' ? 8 : priority === 'Low' ? 48 : 24,
      sla_breached: false,
      escalated: String(get(r, 'escalated') || '').toLowerCase() === 'true',
      escalation_id: null,
      reopened: false,
      frt_sla_target_min: priority === 'Critical' ? 15 : priority === 'High' ? 60 : priority === 'Low' ? 480 : 240,
      frt_sla_breached: false,
      is_uploaded: true,
    });
  });

  for (const t of out) {
    const ageHrs = ((t.resolved_at ?? ds.meta.as_of) - t.created_at) / 3600000;
    t.sla_breached = ageHrs > t.sla_target_hrs;
    t.frt_sla_breached = t.first_response_time_min > t.frt_sla_target_min;
  }
  return { rows: out, errors };
}

export function mapNps(rows, colMap, ds) {
  const DAY_MS = 86400000;
  const out = [], errors = [];
  const get = (r, f) => (colMap[f] ? r[colMap[f]] : undefined);
  rows.forEach((r, i) => {
    const score = num(get(r, 'score'));
    if (score == null || score < 0 || score > 10) { errors.push(`row ${i + 2}: NPS score must be 0–10 — skipped`); return; }
    const at = date(get(r, 'submitted_at')) ?? ds.meta.as_of;
    const dayIndex = dayIndexOf(at, ds);
    if (dayIndex < 0 || dayIndex >= ds.meta.days) { errors.push(`row ${i + 2}: date outside the analysis window — skipped`); return; }
    out.push({
      response_id: String(get(r, 'response_id') || `UPN${i + 1}`),
      submitted_at: at, day_index: dayIndex,
      account_id: get(r, 'account_id') || 'UPLOADED',
      company: get(r, 'company') || 'Uploaded source',
      plan: get(r, 'plan') || 'Growth',
      arr_usd: num(get(r, 'arr_usd')) ?? 0,
      region: 'Uploaded',
      contact_name: get(r, 'contact_name') || 'Unknown',
      score,
      segment: score >= 9 ? 'promoter' : score >= 7 ? 'passive' : 'detractor',
      driver_tag: score <= 6 ? (get(r, 'driver_tag') || 'unclassified') : null,
      verbatim: get(r, 'verbatim') || '',
      last_ticket_id: null,
      is_uploaded: true,
    });
  });
  return { rows: out, errors };
}

export function mapQa(rows, colMap, ds) {
  const DAY_MS = 86400000;
  const out = [], errors = [];
  const get = (r, f) => (colMap[f] ? r[colMap[f]] : undefined);
  const agents = new Map(ds.agents.map((a) => [a.agent_id, a]));
  const DIMS = ['greeting', 'accuracy', 'empathy', 'policy_adherence', 'resolution', 'compliance'];

  rows.forEach((r, i) => {
    const score = num(get(r, 'overall_score'));
    if (score == null) { errors.push(`row ${i + 2}: missing QA score — skipped`); return; }
    const at = date(get(r, 'reviewed_at')) ?? ds.meta.as_of;
    const dayIndex = dayIndexOf(at, ds);
    if (dayIndex < 0 || dayIndex >= ds.meta.days) { errors.push(`row ${i + 2}: date outside the analysis window — skipped`); return; }
    const agentId = get(r, 'agent_id');
    const agent = agents.get(agentId);
    const dims = {};
    for (const d of DIMS) {
      const raw = r[Object.keys(r).find((k) => norm(k) === d) ?? ''];
      dims[d] = num(raw) ?? score;
    }
    const flags = [];
    if (dims.compliance < 70) flags.push('compliance-risk');
    if (dims.policy_adherence < 70) flags.push('policy-deviation');
    out.push({
      qa_id: String(get(r, 'qa_id') || `UPQ${i + 1}`),
      reviewed_at: at, day_index: dayIndex,
      agent_id: agentId || 'UPLOAD',
      agent_name: get(r, 'agent_name') || agent?.name || 'Unknown',
      team: get(r, 'team') || agent?.team || 'Technical Support',
      cohort: agent?.cohort || 'tenured',
      tenure_days: agent?.tenure_days ?? 400,
      reviewer: get(r, 'reviewer') || 'Uploaded',
      ticket_id: get(r, 'ticket_id') || null,
      category: 'Technical',
      overall_score: score, dimensions: dims, flags,
      note: get(r, 'note') || '',
      is_uploaded: true,
    });
  });
  return { rows: out, errors };
}

/** Guess which dataset a file is, from its headers. */
export function detectKind(headers) {
  const h = headers.map(norm);
  const has = (...k) => k.some((x) => h.includes(x));
  if (has('nps', 'nps_score') || (has('score') && has('verbatim', 'comment', 'feedback'))) return 'nps';
  if (has('qa_score', 'overall_score') || has('policy_adherence') || (has('score') && has('reviewer', 'evaluator'))) return 'qa';
  return 'ticket';
}
