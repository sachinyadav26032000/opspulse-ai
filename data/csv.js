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

  /* ── Account-keyed sources ──────────────────────────────────────────────
     The three above (ticket, nps, qa) are EVENT streams: each row is a thing
     that happened, and ingesting one means appending rows. The three below are
     ACCOUNT streams: each row describes an account, and ingesting one means
     joining onto an account that already exists and enriching it.

     That distinction is why they cannot share a mapper. A CRM export mapped
     through `mapTickets` does not merely lose its ARR — it fabricates a
     support ticket per account, which then feeds the backlog and emerging-topic
     detectors. Silently turning a renewal book into invented tickets is worse
     than refusing the file, so `detectKind` now recognises these shapes and
     `mapAccounts` patches accounts instead of inventing events. */
  crm: {
    account_id: ['account_id', 'id', 'company_id', 'organization_id', 'crm_id', 'sfdc_id'],
    company: ['company', 'account', 'account_name', 'organization', 'customer', 'name'],
    arr_usd: ['arr_usd', 'arr', 'annual_recurring_revenue', 'contract_value', 'acv', 'annual_value'],
    mrr_usd: ['mrr_usd', 'mrr', 'monthly_recurring_revenue'],
    renewal_date: ['renewal_date', 'renewal', 'renews_on', 'contract_end', 'contract_end_date', 'end_date', 'expiry_date'],
    owner: ['owner', 'csm', 'account_owner', 'account_manager', 'success_manager', 'assigned_to', 'owner_name'],
    plan: ['plan', 'tier', 'package', 'product_tier', 'subscription_plan'],
    seats: ['seats', 'licenses', 'licences', 'contracted_seats', 'subscription_seats'],
    region: ['region', 'territory', 'geo'],
  },
  billing: {
    account_id: ['account_id', 'company_id', 'customer_id', 'organization_id'],
    company: ['company', 'account', 'account_name', 'organization', 'customer'],
    invoice_id: ['invoice_id', 'invoice', 'invoice_number', 'invoice_no', 'id'],
    amount_usd: ['amount_usd', 'amount', 'total', 'invoice_amount', 'value', 'amount_due'],
    due_date: ['due_date', 'due', 'due_on', 'payment_due'],
    paid_at: ['paid_at', 'paid_on', 'payment_date', 'paid'],
    status: ['status', 'invoice_status', 'payment_status', 'state'],
  },
  usage: {
    account_id: ['account_id', 'company_id', 'customer_id', 'organization_id'],
    company: ['company', 'account', 'account_name', 'organization', 'customer'],
    week_of: ['week_of', 'week', 'week_start', 'week_ending', 'period', 'date'],
    active_seats: ['active_seats', 'weekly_active_seats', 'wau', 'active_users', 'monthly_active_users', 'mau', 'active'],
    contracted_seats: ['contracted_seats', 'seats', 'licenses', 'licences', 'entitled_seats'],
  },
};

/** Event streams append rows; account streams join onto an existing account. */
export const ACCOUNT_KINDS = new Set(['crm', 'billing', 'usage']);
export const EVENT_KINDS = new Set(['ticket', 'nps', 'qa']);

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

/* Returns null — not 0 — for anything that is not a number.
   `Number('')` is 0, so the previous version turned a missing column, an empty
   cell and the word "unknown" all into a confident zero. That made every
   `?? fallback` in this file unreachable (`0 ?? 40` is 0) and every
   `score == null` guard below dead code. The visible damage: an uploaded
   ticket file with no first-response column reported a perfect 0-minute
   response on every row, and a QA file whose score column did not resolve
   ingested every review as 0 and manufactured a coaching gap out of nothing.
   A value we cannot read must be absent, never zero. */
const num = (v) => {
  if (v == null) return null;
  const cleaned = String(v).replace(/[^0-9.\-]/g, '');
  if (!/\d/.test(cleaned)) return null;          // '', 'abc', '-', '.' are not numbers
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};
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

/* ==========================================================================
   Account-keyed ingestion
   --------------------------------------------------------------------------
   The account is the primary object. A CRM, billing or usage export does not
   describe events — it describes accounts — so ingesting one JOINS onto the
   book that is already loaded and enriches it, and never appends a row to an
   event stream.

   The join is deliberately conservative. An account id that matches wins; a
   normalised company name is the fallback; anything else is reported back as
   an unmatched key rather than being created. Inventing an account from a
   billing row would mean a renewal book that grows every time someone uploads
   an invoice export, and a book you cannot reconcile against your own CRM is
   not evidence of anything.
   ========================================================================== */

/** Company names never match exactly across two systems. Strip the noise. */
const companyKey = (s) => String(s || '')
  .toLowerCase()
  .replace(/[.,]/g, '')
  .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|plc|gmbh|bv|ab|sa|srl|pty|group|holdings|technologies|technology|software|systems|solutions|labs)\b/g, '')
  .replace(/[^a-z0-9]+/g, '')
  .trim();

/** Index the loaded book by both join keys, so either column can resolve. */
function accountIndex(ds) {
  const byId = new Map(), byName = new Map();
  for (const a of ds.accounts) {
    byId.set(String(a.account_id), a);
    const k = companyKey(a.company);
    /* A name that is ambiguous across two accounts is not a join key. Storing
       null rather than the first hit makes the collision explicit, so those
       rows are reported unmatched instead of being applied to whichever
       account happened to be generated first. */
    if (k) byName.set(k, byName.has(k) ? null : a);
  }
  return { byId, byName };
}

/**
 * Map account-keyed rows onto the loaded book.
 *
 * Returns the accounts it touched and the keys it could not place. Nothing is
 * mutated here: the caller applies `patches`, so a join that resolves badly
 * can be inspected before it changes the dataset.
 */
export function mapAccounts(rows, colMap, ds, kind) {
  const DAY_MS = 86400000;
  const get = (r, f) => (colMap[f] ? r[colMap[f]] : undefined);
  const { byId, byName } = accountIndex(ds);
  const errors = [], unmatched = [];
  /* Counted rather than just listed, so the caller can say "812 rows joined on
     account id, 40 refused because the company name was ambiguous" instead of
     showing a truncated list and leaving the shape of the failure to guesswork. */
  const reasons = Object.create(null);
  const joinedVia = Object.create(null);
  /* Keyed by account so several rows for one account (invoices, usage weeks)
     collapse into a single patch rather than fighting each other. */
  const patches = new Map();

  /* Returns the account, or a REASON it could not resolve one. "No such
     account" and "that name belongs to nine accounts" are different problems
     with different fixes — the first needs the right book, the second needs an
     account id column — and collapsing them into one "unmatched" count tells
     the user neither. Company names are far more ambiguous than they look:
     in the sample book 372 of 383 distinct names are shared by more than one
     account, so the name fallback usually SHOULD refuse. */
  const resolve = (r) => {
    const id = get(r, 'account_id');
    if (id && byId.has(String(id))) return { acct: byId.get(String(id)), via: 'account_id' };
    const nm = companyKey(get(r, 'company'));
    if (nm && byName.has(nm)) {
      const hit = byName.get(nm);
      if (hit) return { acct: hit, via: 'company' };
      return { acct: null, reason: 'ambiguous_company' };
    }
    return { acct: null, reason: id ? 'unknown_account_id' : 'unknown_company' };
  };
  const patchFor = (acct) => {
    if (!patches.has(acct.account_id)) {
      patches.set(acct.account_id, { account_id: acct.account_id, company: acct.company, fields: {}, via: {} });
    }
    return patches.get(acct.account_id);
  };

  /* An account-id join outranks a company-name join, and a name row may not
     overwrite a field an id row already set. Two systems disagreeing about one
     account's ARR is normal; resolving that by whichever row happened to come
     last in the file is not. Same-strength rows still last-write-wins, which is
     the ordinary upsert and is what a corrected re-export should do. */
  const set = (p, key, value, via) => {
    if (p.via[key] === 'account_id' && via !== 'account_id') return;
    p.fields[key] = value;
    p.via[key] = via;
  };

  rows.forEach((r, i) => {
    const { acct, reason, via } = resolve(r);
    if (!acct) {
      const key = get(r, 'account_id') || get(r, 'company') || `row${i + 2}`;
      reasons[reason] = (reasons[reason] || 0) + 1;
      if (unmatched.length < 40) unmatched.push({ key: String(key), reason });
      return;
    }
    joinedVia[via] = (joinedVia[via] || 0) + 1;
    const p = patchFor(acct);

    if (kind === 'crm') {
      /* ARR is the field this whole product hangs off, so it is taken from an
         explicit ARR column or derived from MRR, and never guessed. */
      /* ARR is taken from an ARR column, or derived from MRR, and never
         guessed. With `num` fixed, a missing column is null and the `??`
         actually falls through to the MRR branch. */
      const mrr = num(get(r, 'mrr_usd'));
      const arr = num(get(r, 'arr_usd')) ?? (mrr != null ? mrr * 12 : null);
      if (arr != null && arr >= 0) set(p, 'arr_usd', Math.round(arr), via);
      const seats = num(get(r, 'seats'));
      if (seats != null && seats > 0) set(p, 'seats', Math.round(seats), via);
      const ren = date(get(r, 'renewal_date'));
      if (ren != null) {
        /* Stored as days-to-renewal because that is what every consumer reads,
           and measured against the dataset clock rather than the wall clock so
           an uploaded book segments into the same windows as the loaded one. */
        set(p, 'renewal_in_days', Math.round((ren - ds.meta.as_of) / DAY_MS), via);
      }
      const owner = get(r, 'owner');
      if (owner) set(p, 'csm', String(owner).trim(), via);
      const plan = get(r, 'plan');
      if (plan) set(p, 'plan', String(plan).trim(), via);
      const region = get(r, 'region');
      if (region) set(p, 'region', String(region).trim(), via);
      return;
    }

    if (kind === 'billing') {
      const amount = num(get(r, 'amount_usd')) ?? 0;
      const due = date(get(r, 'due_date'));
      const paid = date(get(r, 'paid_at'));
      const status = String(get(r, 'status') || '').toLowerCase();
      /* Paid is paid, whatever the status column says. Otherwise an invoice is
         overdue only if its due date has actually passed on the dataset clock
         — a status string alone is somebody else's opinion. */
      /* Word-anchored, because "unpaid" contains "paid". Without the
         boundaries every unpaid invoice was read as settled and dropped out of
         the overdue count — the one number this stream exists to produce. */
      const settled = paid != null || /\b(paid|settled|closed)\b/.test(status);
      const overdue = !settled && ((due != null && due < ds.meta.as_of) || /\b(overdue|past.?due|late|delinquent)\b/.test(status));
      const b = p.fields.billing || (p.fields.billing = { invoices: 0, overdue_invoices: 0, overdue_amount_usd: 0, max_days_overdue: 0 });
      b.invoices += 1;
      if (overdue) {
        b.overdue_invoices += 1;
        b.overdue_amount_usd += Math.round(amount);
        if (due != null) b.max_days_overdue = Math.max(b.max_days_overdue, Math.round((ds.meta.as_of - due) / DAY_MS));
      }
      return;
    }

    /* usage */
    const seats = num(get(r, 'active_seats'));
    if (seats == null || seats < 0) {
      if (errors.length < 8) errors.push(`row ${i + 2}: no readable active-seat count — skipped`);
      return;
    }
    const contracted = num(get(r, 'contracted_seats'));
    if (contracted != null && contracted > 0) set(p, 'seats', Math.round(contracted), via);
    const wk = date(get(r, 'week_of'));
    const u = p.fields._usage || (p.fields._usage = []);
    /* Sorted by week at apply time. An export in reverse-chronological order is
       common enough that trusting file order would invert half the trends. */
    u.push({ at: wk ?? 0, seats: Math.round(seats) });
  });

  /* Collapse usage rows into the weekly series shape the engine already reads,
     oldest first. Nothing else in the codebase has to learn a new shape. */
  for (const p of patches.values()) {
    delete p.via;                                   // join bookkeeping, not account data
    if (!p.fields._usage) continue;
    const weeks = p.fields._usage.sort((a, b) => a.at - b.at).map((x) => x.seats);
    delete p.fields._usage;
    if (weeks.length) p.fields.usage_weeks = weeks;
  }

  return { patches: [...patches.values()], errors, unmatched, reasons, joined_via: joinedVia };
}

/** Apply what `mapAccounts` resolved. Separate so the join can be inspected. */
export function applyAccountPatches(ds, patches) {
  const byId = new Map(ds.accounts.map((a) => [String(a.account_id), a]));
  let applied = 0;
  for (const p of patches) {
    const acct = byId.get(String(p.account_id));
    if (!acct) continue;
    Object.assign(acct, p.fields);
    acct.is_enriched = true;
    applied += 1;
  }
  return applied;
}

/**
 * Guess which dataset a file is, from its headers.
 *
 * Ordering matters and is not alphabetical. The account-keyed shapes are
 * tested FIRST, because their signature columns (arr, invoice, active_seats)
 * are unambiguous, whereas 'ticket' is the loosest shape in the set and used
 * to be the unconditional fallback. That fallback was the bug: a CRM export
 * shares `account_id` and `company` with the ticket alias table, cleared the
 * two-column floor in store.js, and was ingested as a page of invented Open
 * tickets with its ARR, renewal date and owner thrown away. A file we cannot
 * place now returns 'unknown' and is refused, because a refusal a user can
 * read beats a silent corruption of the book they are trying to analyse.
 */
export function detectKind(headers) {
  const h = headers.map(norm);
  const has = (...k) => k.some((x) => h.includes(x));

  /* Account-keyed, most specific first. */
  if (has('active_seats', 'weekly_active_seats', 'wau', 'active_users', 'mau')) return 'usage';
  if (has('invoice_id', 'invoice_number', 'invoice_no')
      || (has('amount_usd', 'amount', 'amount_due', 'invoice_amount') && has('due_date', 'due', 'paid_at', 'paid_on'))) return 'billing';
  if (has('arr_usd', 'arr', 'annual_recurring_revenue', 'mrr', 'mrr_usd', 'acv', 'contract_value')
      || has('renewal_date', 'renews_on', 'contract_end', 'contract_end_date')) return 'crm';

  /* Event streams. */
  if (has('nps', 'nps_score') || (has('score') && has('verbatim', 'comment', 'feedback'))) return 'nps';
  if (has('qa_score', 'overall_score') || has('policy_adherence') || (has('score') && has('reviewer', 'evaluator'))) return 'qa';

  /* Ticket is claimed only on positive evidence now, never as a fallback. */
  if (has('ticket_id', 'case_id', 'ticket_number', 'ticket_subject', 'ticket_status', 'ticket_type', 'ticket_priority')
      || (has('subject', 'description', 'summary') && has('status', 'state', 'priority', 'severity'))) return 'ticket';

  return 'unknown';
}
