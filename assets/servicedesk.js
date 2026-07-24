/* ==========================================================================
   NorthDesk — the CSM / service-desk tool
   --------------------------------------------------------------------------
   A working support console over the same live dataset OpsPulse analyses:
   ticket queue, escalation board, QA reviews, NPS inbox, agent roster.

   This is the SOURCE SYSTEM. Everything OpsPulse says on the other side of the
   split screen is derived from exactly these rows — no separate feed, no
   second copy. Tickets arriving here are, in the same instant, the tickets the
   decision engine is counting.

   Rendering note: the queue is paginated at 50 rows. 10,000+ tickets are never
   put in the DOM at once.
   ========================================================================== */

import { fmt } from './charts.js';

const PAGE = 50;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

const IC = {
  inbox: '<svg viewBox="0 0 24 24" fill="none"><path d="M3 12h5l2 3h4l2-3h5M3 12l2.5-7h13L21 12v7H3v-7Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  fire: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3s5 3.6 5 9a5 5 0 0 1-10 0c0-1.7.6-2.9 1.2-3.7C9 10 10 11 10 12c1-1 1.5-3 1-5 .6.4 1 .9 1-4Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  qa: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="m8.5 12 2.2 2.2L15.5 9.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none"><path d="m12 3.5 2.5 5.6 6.1.6-4.6 4.1 1.3 6-5.3-3.1L6.7 20l1.3-6-4.6-4.1 6.1-.6L12 3.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="1.7"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.5a3 3 0 0 1 0 5M21 20c0-2.5-1.5-4.6-3.6-5.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/><path d="m20 20-3-3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="none"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="none"><path d="M7 4.5 19 12 7 19.5v-15Z" fill="currentColor"/></svg>',
};

const ago = (ms) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
};
const shortStatus = (s) => (s === 'Pending Customer Response' ? 'Pending' : s);

export function mountServiceDesk(root, store, { compact = false } = {}) {
  root.classList.add('sd-root');
  root.innerHTML = '';

  const state = { view: 'open', q: '', page: 0, selected: null, freshIds: new Set() };

  /* ── Chrome ── */
  const top = el('div', 'lv-top');
  top.innerHTML = `
    <div class="lv-brand">
      <span class="dot" style="background:linear-gradient(135deg,#3987e5,#256abf)">
        <svg viewBox="0 0 24 24" fill="none"><path d="M3 12h5l2 3h4l2-3h5M3 12l2.5-7h13L21 12v7H3v-7Z" stroke="#04120c" stroke-width="1.9" stroke-linejoin="round"/></svg>
      </span>
      NorthDesk<span class="muted" style="font-weight:600"> · Service Cloud</span>
    </div>
    <span class="chip info" id="sdOrg">Northwind Cloud</span>
    <div class="lv-spacer"></div>
    <span class="lv-live"><span class="lv-dot" id="sdDot"></span><span id="sdLive">live · 0 today</span></span>
    <button class="lv-btn" id="sdToggle" title="Pause or resume the live feed">${IC.pause}<span>Pause</span></button>`;
  root.appendChild(top);

  const layout = el('div', 'sd-layout');
  const side = el('nav', 'sd-side');
  const main = el('div', 'sd-main');
  layout.appendChild(side); layout.appendChild(main);
  root.appendChild(layout);

  const tools = el('div', 'sd-tools');
  tools.innerHTML = `
    <div class="lv-search" style="max-width:340px">${IC.search}<input id="sdQ" placeholder="Search subject, company, ticket id, agent…"/></div>
    <span class="muted" id="sdCount" style="font-size:.78rem"></span>`;
  main.appendChild(tools);

  const scroll = el('div', 'sd-scroll');
  main.appendChild(scroll);
  const pager = el('div', 'pager');
  main.appendChild(pager);
  const detail = el('div', 'sd-detail');
  detail.hidden = true;
  main.appendChild(detail);

  /* ── Views ── */
  const VIEWS = [
    { id: 'open', group: 'Tickets', label: 'Open queue', icon: IC.inbox, count: (d) => d.tickets.filter((t) => !t.resolved_at).length },
    { id: 'all', group: 'Tickets', label: 'All tickets', icon: IC.inbox, count: (d) => d.tickets.length },
    { id: 'breached', group: 'Tickets', label: 'SLA breached', icon: IC.fire, count: (d) => d.tickets.filter((t) => !t.resolved_at && t.sla_breached).length },
    { id: 'aged', group: 'Tickets', label: 'Aged > 72h', icon: IC.fire, count: (d, now) => d.tickets.filter((t) => !t.resolved_at && (now - t.created_at) / 3600000 > 72).length },
    { id: 'escalations', group: 'Escalations', label: 'Escalation board', icon: IC.fire, count: (d) => d.escalations.filter((e) => e.status !== 'Closed').length },
    { id: 'qa', group: 'Quality', label: 'QA reviews', icon: IC.qa, count: (d) => d.qa.length },
    { id: 'nps', group: 'Voice of customer', label: 'NPS inbox', icon: IC.star, count: (d) => d.nps.length },
    { id: 'agents', group: 'Team', label: 'Agent roster', icon: IC.users, count: (d) => d.agents.length },
  ];

  function renderSide() {
    const d = store.dataset, now = Date.now();
    side.innerHTML = '';
    let group = null;
    for (const v of VIEWS) {
      if (v.group !== group) { group = v.group; side.appendChild(el('div', 'lbl', esc(group))); }
      const b = el('button', state.view === v.id ? 'on' : '', `${v.icon}<span>${esc(v.label)}</span><span class="n">${fmt.int(v.count(d, now))}</span>`);
      b.addEventListener('click', () => { state.view = v.id; state.page = 0; state.selected = null; detail.hidden = true; render(); });
      side.appendChild(b);
    }
  }

  /* ── Row sources ── */
  function rows() {
    const d = store.dataset, now = Date.now();
    const q = state.q.trim().toLowerCase();
    const match = (s) => !q || String(s).toLowerCase().includes(q);

    if (state.view === 'escalations') {
      return d.escalations.filter((e) => match(e.company) || match(e.reason) || match(e.escalation_id) || match(e.ticket_id))
        .sort((a, b) => b.opened_at - a.opened_at);
    }
    if (state.view === 'qa') {
      return d.qa.filter((r) => match(r.agent_name) || match(r.qa_id) || match(r.team)).sort((a, b) => b.reviewed_at - a.reviewed_at);
    }
    if (state.view === 'nps') {
      return d.nps.filter((r) => match(r.company) || match(r.verbatim) || match(r.contact_name)).sort((a, b) => b.submitted_at - a.submitted_at);
    }
    if (state.view === 'agents') {
      const byAgent = new Map();
      for (const t of d.tickets) byAgent.set(t.agent_id, (byAgent.get(t.agent_id) || 0) + 1);
      const qaBy = new Map();
      for (const r of d.qa) { if (!qaBy.has(r.agent_id)) qaBy.set(r.agent_id, []); qaBy.get(r.agent_id).push(r.overall_score); }
      return d.agents.filter((a) => match(a.name) || match(a.team) || match(a.agent_id)).map((a) => ({
        ...a, handled: byAgent.get(a.agent_id) || 0,
        qa: qaBy.has(a.agent_id) ? Math.round(qaBy.get(a.agent_id).reduce((x, y) => x + y, 0) / qaBy.get(a.agent_id).length) : null,
      })).sort((a, b) => b.handled - a.handled);
    }

    let list = d.tickets;
    if (state.view === 'open') list = list.filter((t) => !t.resolved_at);
    else if (state.view === 'breached') list = list.filter((t) => !t.resolved_at && t.sla_breached);
    else if (state.view === 'aged') list = list.filter((t) => !t.resolved_at && (now - t.created_at) / 3600000 > 72);
    return list.filter((t) => match(t.ticket_subject) || match(t.company) || match(t.ticket_id) || match(t.category) || match(t.customer_name))
      .sort((a, b) => b.created_at - a.created_at);
  }

  /* ── Table renderers ── */
  const HEADERS = {
    ticket: ['ID', 'Subject', 'Category', 'Priority', 'Status', 'Agent', 'Age', 'SLA'],
    escalations: ['ID', 'Reason', 'Account', 'Sev', 'Status', 'Owner', 'Opened'],
    qa: ['ID', 'Agent', 'Team', 'Cohort', 'Score', 'Weakest area', 'Flags', 'Reviewed'],
    nps: ['ID', 'Account', 'Score', 'Segment', 'Driver', 'Verbatim', 'Received'],
    agents: ['ID', 'Agent', 'Team', 'Role', 'Tenure', 'Tickets handled', 'QA avg'],
  };
  const headerFor = (v) => HEADERS[v] || HEADERS.ticket;

  function cellsFor(v, r, now, agentName) {
    if (v === 'escalations') return [
      `<span class="id">${esc(r.escalation_id)}</span>`,
      `<span class="subj">${esc(r.reason)}</span><span class="co">${esc(r.category)} · ${esc(r.ticket_id)}</span>`,
      `${esc(r.company)}<br><span class="co">${esc(r.plan)} · ${fmt.usdK(r.arr_usd)} ARR</span>`,
      `<span class="pill ${r.severity}">${r.severity}</span>`,
      `<span class="pill ${r.status === 'Closed' ? 'Closed' : 'Open'}">${esc(r.status)}</span>${r.sla_breached ? ' <span class="warnflag">!</span>' : ''}`,
      esc(r.owner),
      `<span class="co">${ago(r.opened_at)}</span>`,
    ];
    if (v === 'qa') {
      const weak = Object.entries(r.dimensions).sort((a, b) => a[1] - b[1])[0];
      return [
        `<span class="id">${esc(r.qa_id)}</span>`,
        esc(r.agent_name),
        `<span class="co">${esc(r.team)}</span>`,
        `<span class="pill ${r.cohort === 'new_hire' ? 'Medium' : 'Low'}">${r.cohort === 'new_hire' ? 'New hire' : 'Tenured'}</span>`,
        `<b class="${r.overall_score < 75 ? 'warnflag' : ''}">${r.overall_score}</b>`,
        `${esc(weak[0].replace(/_/g, ' '))} <span class="co">${weak[1]}</span>`,
        r.flags.length ? `<span class="pill Critical">${r.flags.length}</span>` : '<span class="co">—</span>',
        `<span class="co">${ago(r.reviewed_at)}</span>`,
      ];
    }
    if (v === 'nps') return [
      `<span class="id">${esc(r.response_id)}</span>`,
      `${esc(r.company)}<br><span class="co">${esc(r.contact_name)}</span>`,
      `<b class="${r.score <= 6 ? 'warnflag' : ''}">${r.score}</b>`,
      `<span class="pill ${r.segment === 'detractor' ? 'Critical' : r.segment === 'passive' ? 'Medium' : 'Resolved'}">${esc(r.segment)}</span>`,
      r.driver_tag ? `<span class="co">${esc(r.driver_tag)}</span>` : '<span class="co">—</span>',
      `<span class="subj" style="max-width:34ch;font-weight:400">${esc(r.verbatim)}</span>`,
      `<span class="co">${ago(r.submitted_at)}</span>`,
    ];
    if (v === 'agents') return [
      `<span class="id">${esc(r.agent_id)}</span>`,
      esc(r.name),
      `<span class="co">${esc(r.team)}</span>`,
      `<span class="co">${esc(r.role)}</span>`,
      `<span class="co">${r.tenure_days}d</span>`,
      fmt.int(r.handled),
      r.qa == null ? '<span class="co">—</span>' : `<b class="${r.qa < 75 ? 'warnflag' : ''}">${r.qa}</b>`,
    ];

    const ageH = (now - r.created_at) / 3600000;
    return [
      `<span class="id">${esc(r.ticket_id)}</span>`,
      `<span class="subj">${esc(r.ticket_subject)}</span><span class="co">${esc(r.company)} · ${esc(r.customer_name)}</span>`,
      `<span class="co">${esc(r.category)}</span>`,
      `<span class="pill ${r.ticket_priority}">${r.ticket_priority}</span>`,
      `<span class="pill ${shortStatus(r.ticket_status)}">${esc(shortStatus(r.ticket_status))}</span>${r.escalated ? ' <span class="pill Critical">ESC</span>' : ''}`,
      `<span class="co">${esc(agentName(r.agent_id))}</span>`,
      `<span class="co">${r.resolved_at ? fmt.hrs(r.time_to_resolution_hrs) : ago(r.created_at)}</span>`,
      r.sla_breached ? '<span class="warnflag">breached</span>' : `<span class="co">${Math.round(r.sla_target_hrs)}h</span>`,
    ];
  }

  function render() {
    const d = store.dataset, now = Date.now();
    const agentMap = new Map(d.agents.map((a) => [a.agent_id, a.name]));
    const agentName = (id) => agentMap.get(id) || id;

    renderSide();
    const list = rows();
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    state.page = Math.min(state.page, pages - 1);
    const page = list.slice(state.page * PAGE, state.page * PAGE + PAGE);

    root.querySelector('#sdCount').textContent = `${fmt.int(list.length)} records`;

    const head = headerFor(state.view);
    const table = el('table', 'sd-table');
    table.innerHTML = `<thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>`;
    const tb = el('tbody');
    for (const r of page) {
      const id = r.ticket_id || r.escalation_id || r.qa_id || r.response_id || r.agent_id;
      const tr = el('tr', state.freshIds.has(id) ? 'fresh' : '');
      tr.innerHTML = cellsFor(state.view, r, now, agentName).map((c) => `<td>${c}</td>`).join('');
      tr.addEventListener('click', () => { state.selected = r; renderDetail(); });
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    // The live feed re-renders every few seconds. Replacing the table resets
    // scrollTop, which would yank a viewer back to the top of the queue mid-read
    // — so the position is restored across the swap.
    const keepScroll = scroll.scrollTop;
    scroll.innerHTML = '';
    if (!page.length) scroll.appendChild(el('div', 'empty', 'No records match this view.'));
    else scroll.appendChild(table);
    scroll.scrollTop = keepScroll;

    pager.innerHTML = '';
    const prev = el('button', 'lv-btn', '← Prev'); prev.disabled = state.page === 0;
    const next = el('button', 'lv-btn', 'Next →'); next.disabled = state.page >= pages - 1;
    prev.addEventListener('click', () => { state.page--; render(); scroll.scrollTop = 0; });
    next.addEventListener('click', () => { state.page++; render(); scroll.scrollTop = 0; });
    pager.appendChild(prev);
    pager.appendChild(el('span', '', `Page ${state.page + 1} of ${pages} · showing ${page.length} of ${fmt.int(list.length)}`));
    pager.appendChild(next);
  }

  function renderDetail() {
    const r = state.selected;
    if (!r) { detail.hidden = true; return; }
    detail.hidden = false;
    const d = store.dataset;

    if (r.ticket_id && r.ticket_subject) {
      const agent = d.agents.find((a) => a.agent_id === r.agent_id);
      const esc_ = d.escalations.find((e) => e.escalation_id === r.escalation_id);
      detail.innerHTML = `
        <h4>${esc(r.ticket_subject)}</h4>
        <div class="muted" style="font-size:.78rem">${esc(r.ticket_id)} · ${esc(r.company)} · ${esc(r.customer_name)} &lt;${esc(r.customer_email)}&gt;</div>
        <div class="meta">
          <span class="pill ${r.ticket_priority}">${r.ticket_priority}</span>
          <span class="pill ${shortStatus(r.ticket_status)}">${esc(shortStatus(r.ticket_status))}</span>
          <span class="chip">${esc(r.category)}</span>
          <span class="chip">${esc(r.ticket_channel)}</span>
          <span class="chip">${esc(r.team)}</span>
          <span class="chip">tag: ${esc(r.tag)}</span>
          ${r.escalated ? '<span class="chip hi">escalated</span>' : ''}
          ${r.sla_breached ? '<span class="chip hi">SLA breached</span>' : ''}
          ${r.reopened ? '<span class="chip md">reopened</span>' : ''}
        </div>
        <div class="desc">${esc(r.ticket_description)}</div>
        ${esc_ ? `<div class="desc" style="margin-top:8px;border-left-color:var(--danger)"><b>Escalation ${esc(esc_.escalation_id)} (${esc_.severity})</b> — ${esc(esc_.reason)}<br><span class="muted">Owner: ${esc(esc_.owner)} · ${esc(esc_.status)}</span></div>` : ''}
        <div class="kv">
          <div><dt>Assigned agent</dt><dd>${esc(agent ? agent.name : r.agent_id)}${agent?.cohort === 'new_hire' ? ' <span class="pill Medium">new hire</span>' : ''}</dd></div>
          <div><dt>First response</dt><dd>${fmt.min(r.first_response_time_min)} ${r.frt_sla_breached ? '<span class="warnflag">·  missed</span>' : ''}</dd></div>
          <div><dt>Resolution time</dt><dd>${r.resolved_at ? fmt.hrs(r.time_to_resolution_hrs) : 'open · ' + ago(r.created_at)}</dd></div>
          <div><dt>SLA target</dt><dd>${Math.round(r.sla_target_hrs)}h</dd></div>
          <div><dt>Plan</dt><dd>${esc(r.plan)}</dd></div>
          <div><dt>ARR</dt><dd>${fmt.usd(r.arr_usd)}</dd></div>
          <div><dt>CSAT</dt><dd>${r.customer_satisfaction_rating ? r.customer_satisfaction_rating + '★' : '—'}</dd></div>
          <div><dt>Created</dt><dd>${new Date(r.created_at).toLocaleString()}</dd></div>
        </div>
        ${r.resolution ? `<p class="muted" style="font-size:.8rem;margin:10px 0 0"><b>Resolution:</b> ${esc(r.resolution)}</p>` : ''}
        ${r.regulatory_due_at ? `<p style="font-size:.8rem;margin:8px 0 0;color:var(--warn)"><b>Statutory deadline:</b> ${new Date(r.regulatory_due_at).toLocaleDateString()} (${r.regulatory_days_left} days left)</p>` : ''}`;
    } else if (r.qa_id) {
      detail.innerHTML = `
        <h4>QA review ${esc(r.qa_id)} — ${esc(r.agent_name)}</h4>
        <div class="meta"><span class="chip">${esc(r.team)}</span><span class="pill ${r.cohort === 'new_hire' ? 'Medium' : 'Low'}">${r.cohort === 'new_hire' ? 'New hire' : 'Tenured'}</span><span class="chip">Reviewer: ${esc(r.reviewer)}</span>${r.flags.map((f) => `<span class="chip hi">${esc(f)}</span>`).join('')}</div>
        <div class="kv">${Object.entries(r.dimensions).map(([k, v]) => `<div><dt>${esc(k.replace(/_/g, ' '))}</dt><dd class="${v < 70 ? 'warnflag' : ''}">${v}</dd></div>`).join('')}</div>
        <div class="desc" style="margin-top:10px">${esc(r.note)}</div>`;
    } else if (r.response_id) {
      detail.innerHTML = `
        <h4>NPS ${r.score} — ${esc(r.company)}</h4>
        <div class="meta"><span class="pill ${r.segment === 'detractor' ? 'Critical' : r.segment === 'passive' ? 'Medium' : 'Resolved'}">${esc(r.segment)}</span><span class="chip">${esc(r.plan)}</span><span class="chip">${fmt.usd(r.arr_usd)} ARR</span>${r.driver_tag ? `<span class="chip md">${esc(r.driver_tag)}</span>` : ''}</div>
        <div class="desc">“${esc(r.verbatim)}”</div>
        <div class="kv"><div><dt>Contact</dt><dd>${esc(r.contact_name)}</dd></div><div><dt>Region</dt><dd>${esc(r.region)}</dd></div><div><dt>Received</dt><dd>${new Date(r.submitted_at).toLocaleString()}</dd></div></div>`;
    } else if (r.escalation_id) {
      const t = d.tickets.find((x) => x.ticket_id === r.ticket_id);
      detail.innerHTML = `
        <h4>${esc(r.reason)}</h4>
        <div class="muted" style="font-size:.78rem">${esc(r.escalation_id)} · ${esc(r.company)}</div>
        <div class="meta"><span class="pill ${r.severity}">${r.severity}</span><span class="pill ${r.status === 'Closed' ? 'Closed' : 'Open'}">${esc(r.status)}</span><span class="chip">${esc(r.category)}</span><span class="chip">Owner: ${esc(r.owner)}</span>${r.sla_breached ? '<span class="chip hi">past response SLA</span>' : ''}</div>
        ${t ? `<div class="desc">${esc(t.ticket_subject)}<br><span class="muted">${esc(t.ticket_description)}</span></div>` : ''}
        <div class="kv"><div><dt>Plan</dt><dd>${esc(r.plan)}</dd></div><div><dt>ARR</dt><dd>${fmt.usd(r.arr_usd)}</dd></div><div><dt>Response SLA</dt><dd>${r.response_sla_hrs}h</dd></div><div><dt>Opened</dt><dd>${ago(r.opened_at)}</dd></div></div>`;
    } else {
      detail.innerHTML = `
        <h4>${esc(r.name)}</h4>
        <div class="meta"><span class="chip">${esc(r.agent_id)}</span><span class="chip">${esc(r.team)}</span><span class="chip">${esc(r.role)}</span><span class="pill ${r.cohort === 'new_hire' ? 'Medium' : 'Low'}">${r.cohort === 'new_hire' ? 'New hire' : 'Tenured'}</span></div>
        <div class="kv"><div><dt>Tenure</dt><dd>${r.tenure_days} days</dd></div><div><dt>Tickets handled</dt><dd>${fmt.int(r.handled)}</dd></div><div><dt>QA average</dt><dd class="${r.qa != null && r.qa < 75 ? 'warnflag' : ''}">${r.qa ?? '—'}</dd></div><div><dt>Hired</dt><dd>${new Date(r.hired_at).toLocaleDateString()}</dd></div></div>`;
    }
  }

  /* ── Wiring ── */
  root.querySelector('#sdQ').addEventListener('input', (e) => { state.q = e.target.value; state.page = 0; render(); });
  const toggleBtn = root.querySelector('#sdToggle');
  toggleBtn.addEventListener('click', () => store.toggle());

  function refreshLiveChrome() {
    const c = store.counters;
    root.querySelector('#sdLive').textContent = store.running
      ? `live · ${c.added} in, ${c.resolved} closed`
      : 'paused';
    root.querySelector('#sdDot').className = 'lv-dot' + (store.running ? '' : ' off');
    toggleBtn.innerHTML = store.running ? `${IC.pause}<span>Pause</span>` : `${IC.play}<span>Resume</span>`;
  }

  let pending = false;
  const unsub = store.subscribe((evt) => {
    if (evt.type === 'tick') {
      for (const e of evt.events) state.freshIds.add(e.id);
      setTimeout(() => { for (const e of evt.events) state.freshIds.delete(e.id); }, 2600);
    }
    if (evt.type === 'reset') { state.selected = null; state.page = 0; detail.hidden = true; }
    refreshLiveChrome();
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; render(); });
  });

  render();
  refreshLiveChrome();
  return { destroy: () => { unsub(); root.innerHTML = ''; } };
}
