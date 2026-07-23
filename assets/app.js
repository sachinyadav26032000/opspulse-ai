/* ==========================================================================
   OpsPulse AI — Ops Copilot Dashboard engine
   Simulated real-time operations intelligence. All data is mock.
   ========================================================================== */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var el = function (tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  /* ---------- tiny deterministic PRNG (Date.* free) ---------- */
  var _seed = 987654321;
  function rnd() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
  function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }

  /* ---------- icons ---------- */
  var IC = {
    fire: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3s5 3.5 5 9a5 5 0 0 1-10 0c0-1.6.6-2.8 1.2-3.6C9 10 10 11 10 12c1-1 1.5-3 1-5 .6.4 1 .9 1-4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    tri: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3 2 20h20L12 3Z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M12 10v4M12 17h.01" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.9"/><path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.9"/><path d="M12 11v5M12 8h.01" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    coach: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.2" stroke="currentColor" stroke-width="1.8"/><path d="M5 20c0-3.6 3-6.5 7-6.5s7 2.9 7 6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    assign: '<svg viewBox="0 0 24 24" fill="none"><path d="M9 12l2 2 4-4M12 3l7 4v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V7l7-4Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    esc: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 19V5M6 11l6-6 6 6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    flow: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="6" height="5" rx="1.4" stroke="currentColor" stroke-width="1.7"/><rect x="15" y="15" width="6" height="5" rx="1.4" stroke="currentColor" stroke-width="1.7"/><path d="M9 6.5h4a3 3 0 0 1 3 3v5" stroke="currentColor" stroke-width="1.7"/></svg>',
    dismiss: '<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none"><path d="M20 6 9 17l-5-5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    ticket: '<svg viewBox="0 0 24 24" fill="none"><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-4Z" stroke="currentColor" stroke-width="1.7"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 5c0 8 7 15 15 15l1-4-4-2-2 2c-2-1-4-3-5-5l2-2-2-4-5 0Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    qa: '<svg viewBox="0 0 24 24" fill="none"><path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.7"/></svg>',
    survey: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 17.3 6.2 21l1.5-6.6L3 9.9l6.7-.6L12 3l2.3 6.3 6.7.6-4.7 4.5L17.8 21z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 5h16v11H9l-5 4V5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    pulse: '<svg viewBox="0 0 24 24" fill="none"><path d="M3 12h4l2-6 4 12 2-6h6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    brain: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 5a3 3 0 0 0-5.6-1.5A3 3 0 0 0 4 8a3 3 0 0 0 .6 4.5A3 3 0 0 0 7 17a2.5 2.5 0 0 0 5 .5V5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 5a3 3 0 0 1 5.6-1.5A3 3 0 0 1 20 8a3 3 0 0 1-.6 4.5A3 3 0 0 1 17 17a2.5 2.5 0 0 1-5 .5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    coin: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v10M14.6 9.2c0-1-1.2-1.7-2.6-1.7s-2.6.7-2.6 1.7 1.2 1.7 2.6 1.7 2.6.7 2.6 1.9-1.2 1.7-2.6 1.7-2.6-.7-2.6-1.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
  };

  /* ---------- mock data ---------- */
  var state = {
    filter: "all",
    sort: "priority",   // "priority" (impact × confidence × urgency) | "severity"
    selectedId: null,
    health: 82,
    prevHealth: 80
  };

  /* Each risk is a full insight object — the four questions (what / why / worth /
     do) every downstream agent contributes to. The feed row shows the same shape;
     the Insight Explorer renders the richer object behind it. */
  var risks = [
    {
      id: "r1", iid: "ins_9f2a", sev: "high", score: 94, title: "Enterprise churn risk — 6 accounts",
      owner: "Unassigned", team: "Customer Success", age: "12m ago",
      metric: "$180–340k at risk",
      whatHappened: "6 enterprise accounts show a composite health decline of <b>>15 pts</b> over the last 7 days.",
      why: {
        confidence: 0.82,
        hypothesis: "Most likely driven by onboarding SLA breaches on the new provisioning flow — breached <b>3×</b> this week and closely correlated with a last-touch sentiment drop (<b>+0.4 → −0.6</b>). 4 of 6 accounts also carry a P1 open >48h.",
        note: "Correlation, not a confirmed cause — verify before it drives an executive action."
      },
      impact: {
        costed: true, value: "$180k – $340k", type: "Churn prevention", horizon: "14-day window",
        formula: "6 accounts · $520k combined ARR × 34–65% modeled churn probability"
      },
      rec: { owner: "CS Manager", playbook: "pb_churn_escalation_v2" },
      priority: { annualK: 260, urgencyDays: 14, impactLabel: "$260k/yr", urgencyLabel: "14-day window",
        rationale: "Biggest single event — $180–340k ARR at 82% confidence, near-term. It's severity's #1, but annualized it sits just under the billing leak." },
      signals: [
        { src: "Tickets", label: "P1 open >48h across 4 accounts", w: 88 },
        { src: "Calls", label: "Negative sentiment in 5 recent calls", w: 74 },
        { src: "Survey", label: "2 detractor NPS responses (score ≤ 3)", w: 62 }
      ],
      actions: [
        { ic: "esc", t: "Escalate to CS leadership", s: "Loop in the VP of Success + assign a save-play", rec: true },
        { ic: "assign", t: "Assign recovery owner", s: "Route the 6 accounts to a senior CSM" },
        { ic: "flow", t: "Fix onboarding SLA rule", s: "Auto-page on-call when provisioning >24h" }
      ]
    },
    {
      id: "r2", iid: "ins_7c14", sev: "high", score: 87, title: "CSAT drop — Billing queue",
      owner: "Unassigned", team: "Support · Billing", age: "27m ago",
      metric: "$40–70k/mo leakage",
      whatHappened: "Billing-queue CSAT fell <b>78% → 71%</b> in 24h while refund-ticket volume rose <b>41%</b>.",
      why: {
        confidence: 0.88,
        hypothesis: "Correlates tightly with the pricing-page change shipped Tuesday, which preceded the refund spike. Handle time is up 22% and first-contact resolution fell to <b>58%</b> — consistent with agents lacking a refund policy for the new plans.",
        note: "Correlation, not a confirmed cause — verify before it drives an executive action."
      },
      impact: {
        costed: true, value: "$40k – $70k / mo", type: "Margin leakage", horizon: "30-day run-rate",
        formula: "≈220 incremental refunds/mo × $180–320 average refund value"
      },
      rec: { owner: "Billing Lead", playbook: "pb_refund_policy_v1" },
      priority: { annualK: 660, urgencyDays: 30, impactLabel: "$660k/yr", urgencyLabel: "30-day run-rate",
        rationale: "Largest annualized exposure ($660k/yr) at the highest confidence (88%). Severity ranks the churn higher — but this bleeds more money per year. Fix it first." },
      signals: [
        { src: "Tickets", label: "+41% refund ticket volume", w: 91 },
        { src: "QA", label: "Refund-handling score down 11%", w: 70 },
        { src: "Chat", label: "'confusing pricing' mentioned 63×", w: 55 }
      ],
      actions: [
        { ic: "flow", t: "Publish refund macro + policy", s: "Ship a canned response for new plans", rec: true },
        { ic: "coach", t: "Coach Billing team on refunds", s: "15-min huddle + updated playbook" },
        { ic: "assign", t: "Assign to Billing lead", s: "Owner: track resolution to green" }
      ]
    },
    {
      id: "r3", iid: "ins_5b83", sev: "medium", score: 68, title: "Agent coaching gap — Team B",
      owner: "Unassigned", team: "Support · Tier 1", age: "44m ago",
      metric: "$8–15k/mo rework",
      whatHappened: "3 agents on Team B are running <b>>10 pts</b> below the QA baseline on technical scenarios.",
      why: {
        confidence: 0.71,
        hypothesis: "Pattern points to a knowledge gap rather than a behavior issue: the three agents' escalation rate is <b>2.1×</b> the team median and concentrated in technical troubleshooting.",
        note: "Likely, not confirmed — a coaching review will settle it."
      },
      impact: {
        costed: true, value: "$8k – $15k / mo", type: "Efficiency loss", horizon: "30-day run-rate",
        formula: "≈140 excess escalations/mo × $55–105 loaded handling cost"
      },
      rec: { owner: "Team B Lead", playbook: "pb_targeted_coaching_v3" },
      priority: { annualK: 138, urgencyDays: 30, impactLabel: "$138k/yr", urgencyLabel: "30-day run-rate",
        rationale: "Steady $138k/yr efficiency drag at moderate confidence, no deadline — schedule it, don't scramble." },
      signals: [
        { src: "QA", label: "3 agents below 75% on tech scenarios", w: 79 },
        { src: "Tickets", label: "Escalation rate 2.1× median", w: 66 },
        { src: "Calls", label: "Longer hold times on tech calls", w: 48 }
      ],
      actions: [
        { ic: "coach", t: "Schedule targeted coaching", s: "Technical troubleshooting module", rec: true },
        { ic: "assign", t: "Pair with senior mentor", s: "Buddy system for 2 weeks" },
        { ic: "flow", t: "Surface top KB articles", s: "Pin fixes to agent workspace" }
      ]
    },
    {
      id: "r4", iid: "ins_3e61", sev: "medium", score: 61, title: "SLA breach risk — EMEA night shift",
      owner: "Unassigned", team: "Support · EMEA", age: "1h ago",
      metric: "$13–25k SLA credits",
      whatHappened: "EMEA inbound in the <b>22:00–02:00</b> window is up <b>18%</b> week-over-week with staffing flat.",
      why: {
        confidence: 0.64,
        hypothesis: "Projected from the current trajectory — inbound is rising faster than the flat night-shift roster can absorb, so modeled SLA compliance dips below the 90% threshold within ~3 days.",
        note: "Forecast from current trend — not yet an observed breach."
      },
      impact: {
        costed: true, value: "$13k – $25k", type: "SLA penalty exposure", horizon: "3-day forecast",
        formula: "9 contracts with SLA-credit clauses × $1.4k–2.8k credit each"
      },
      rec: { owner: "WFM Planner", playbook: "pb_coverage_rebalance_v2" },
      priority: { annualK: 19, urgencyDays: 3, impactLabel: "$19k once", urgencyLabel: "3-day deadline",
        rationale: "A 3-day deadline makes it urgent, but the $13–25k one-time cost is small. Urgent isn't the same as expensive — it ranks below the money leaks." },
      signals: [
        { src: "Tickets", label: "+18% off-hours inbound", w: 72 },
        { src: "Calls", label: "Abandon rate rising after 23:00", w: 58 }
      ],
      actions: [
        { ic: "flow", t: "Adjust coverage schedule", s: "Shift 2 agents to the night window", rec: true },
        { ic: "esc", t: "Flag to WFM planning", s: "Request temporary capacity" }
      ]
    },
    {
      id: "r5", iid: "ins_1a09", sev: "low", score: 44, title: "Emerging topic — 'export to CSV'",
      owner: "Unassigned", team: "Product feedback", age: "2h ago",
      metric: "Roadmap signal",
      whatHappened: "A new <b>'CSV export'</b> request cluster is forming — 31 tickets and rising in 48h.",
      why: {
        confidence: 0.55,
        hypothesis: "Early clustering only — export/CSV intent is accelerating across tickets and chat, but there isn't enough signal yet to attribute a driver.",
        note: "Emerging pattern — too early to attribute a cause."
      },
      impact: {
        costed: false,
        note: "Not yet costed — volume is accelerating but sits below any revenue or SLA threshold. Routed to product as a roadmap signal, not a dollar risk. The model declines to invent a number it can't defend."
      },
      rec: { owner: "Product Manager", playbook: "pb_product_routing_v1" },
      priority: { annualK: 0, urgencyDays: null, impactLabel: "uncosted", urgencyLabel: "no deadline",
        rationale: "Uncosted watch-list signal — accelerating, but below any dollar threshold and low confidence. Monitor, don't act yet." },
      signals: [
        { src: "Tickets", label: "31 requests in 48h", w: 52 },
        { src: "Chat", label: "'export' intent up 3.4×", w: 40 }
      ],
      actions: [
        { ic: "flow", t: "Route to product board", s: "Tag as feature signal", rec: true },
        { ic: "dismiss", t: "Snooze for 7 days", s: "Re-evaluate if volume grows" }
      ]
    }
  ];

  var sources = [
    { name: "Zendesk", meta: "Ticketing", ic: "ticket", base: 1284 },
    { name: "Aircall", meta: "Call transcripts", ic: "phone", base: 342 },
    { name: "Klaus QA", meta: "Quality reviews", ic: "qa", base: 96 },
    { name: "Delighted", meta: "NPS / CSAT surveys", ic: "survey", base: 218 },
    { name: "Intercom", meta: "Live chat", ic: "chat", base: 671 }
  ];

  var teams = [
    { name: "Team A · Onboarding", score: 91, color: "#34d399" },
    { name: "Team B · Tier 1", score: 74, color: "#fbbf24" },
    { name: "Team C · Billing", score: 71, color: "#fb7185" },
    { name: "Team D · Enterprise", score: 88, color: "#22d3ee" }
  ];

  var tickTemplates = [
    { src: "Tickets", txt: "New P2 ticket — API latency", c: "#38bdf8" },
    { src: "Calls", txt: "Call transcript scored — sentiment −0.3", c: "#fb7185" },
    { src: "QA", txt: "QA review completed — 88%", c: "#34d399" },
    { src: "Survey", txt: "CSAT response received — 4/5", c: "#34d399" },
    { src: "Chat", txt: "Chat resolved — 3m 12s", c: "#22d3ee" },
    { src: "Tickets", txt: "Refund request auto-tagged", c: "#fbbf24" },
    { src: "Calls", txt: "Escalation flagged by copilot", c: "#fb7185" },
    { src: "QA", txt: "Coaching note added to Agent #214", c: "#a78bfa" },
    { src: "Survey", txt: "Detractor NPS — score 2", c: "#fb7185" },
    { src: "Tickets", txt: "SLA timer < 30m on 2 tickets", c: "#fbbf24" }
  ];

  var kpis = [
    { k: "Org Health", id: "kHealth", v: "82", d: "+2 vs 7d", up: true, spark: [70,72,71,74,73,76,78,80,82] },
    { k: "CSAT · 24h", id: "kCsat", v: "79%", d: "−4.2%", up: false, spark: [86,85,84,83,82,81,80,79,79] },
    { k: "SLA Compliance", id: "kSla", v: "94%", d: "−1.1%", up: false, spark: [97,96,96,95,95,94,94,94,94] },
    { k: "Open Risks", id: "kRisks", v: "5", d: "2 high", up: false, spark: [2,3,3,4,4,5,4,5,5] },
    { k: "Avg Resolution", id: "kRes", v: "4.2h", d: "−0.6h", up: true, spark: [5.4,5.1,5.0,4.8,4.7,4.5,4.4,4.3,4.2] }
  ];

  /* ---------- helpers ---------- */
  function sparkPath(data, w, h) {
    var min = Math.min.apply(null, data), max = Math.max.apply(null, data);
    var rng = (max - min) || 1;
    return data.map(function (v, i) {
      var x = (i / (data.length - 1)) * w;
      var y = h - ((v - min) / rng) * (h - 4) - 2;
      return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
    }).join(" ");
  }
  function sevIcon(sev) { return sev === "high" ? IC.tri : sev === "medium" ? IC.warn : IC.info; }
  function scoreCls(sev) { return sev === "high" ? "hi" : sev === "medium" ? "md" : "lo"; }

  /* ---------- prioritization model ----------
     Priority is NOT severity. It's expected value under a decision window:
       priority = annualized_$_at_risk × detection_confidence × urgency
     — all impacts put on one annualized basis so $/mo leaks and one-time costs
     are comparable. Weights are explicit, tunable assumptions, not objective truth. */
  var MAX_ANNUAL_K = 1;
  function urgencyMult(d) {
    if (d == null) return 0.9;
    if (d <= 3) return 1.5;
    if (d <= 7) return 1.35;
    if (d <= 14) return 1.2;
    if (d <= 30) return 1.0;
    return 0.9;
  }
  function urgencyBar(d) {
    if (d == null) return 15;
    if (d <= 3) return 92;
    if (d <= 7) return 78;
    if (d <= 14) return 60;
    if (d <= 30) return 32;
    return 20;
  }
  function computePriority() {
    MAX_ANNUAL_K = Math.max.apply(null, risks.map(function (r) { return r.priority.annualK; })) || 1;
    risks.forEach(function (r) {
      r._praw = r.priority.annualK * r.why.confidence * urgencyMult(r.priority.urgencyDays);
      r._impBar = Math.round(100 * r.priority.annualK / MAX_ANNUAL_K);
    });
    // stable rank (#N of all) so "#2 of 5" stays meaningful as items resolve
    risks.slice().sort(function (a, b) { return b._praw - a._praw; })
      .forEach(function (r, i) { r._rank = i + 1; });
  }

  /* ---------- render: KPIs ---------- */
  function renderKpis() {
    var wrap = $("#kpis");
    wrap.innerHTML = "";
    kpis.forEach(function (m) {
      var c = el("div", "kpi");
      c.innerHTML =
        '<div class="k">' + m.k + '</div>' +
        '<div class="v" id="' + m.id + '">' + m.v + '</div>' +
        '<div class="d ' + (m.up ? "up" : "down") + '">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="' +
          (m.up ? "M12 19V5M6 11l6-6 6 6" : "M12 5v14M6 13l6 6 6-6") +
          '" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          m.d + '</div>' +
        '<svg class="spark" viewBox="0 0 66 30" preserveAspectRatio="none"><path d="' +
          sparkPath(m.spark, 66, 30) + '" fill="none" stroke="' + (m.up ? "#34d399" : "#fb7185") +
          '" stroke-width="1.8" stroke-linecap="round"/></svg>';
      wrap.appendChild(c);
    });
  }

  /* ---------- render: feed ---------- */
  function visibleRisks() {
    var q = ($("#searchBox").value || "").toLowerCase().trim();
    return risks.filter(function (r) {
      if (state.filter === "resolved" && !r.resolved) return false;
      if (state.filter === "high" && (r.sev !== "high" || r.resolved)) return false;
      if (state.filter === "medium" && (r.sev !== "medium" || r.resolved)) return false;
      if (state.filter === "all" && r.resolved) return false;
      if (q) {
        var hay = (r.title + " " + r.team + " " + r.owner + " " + r.metric).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    }).sort(function (a, b) {
      return state.sort === "severity" ? b.score - a.score : b._praw - a._praw;
    });
  }

  function renderFeed() {
    var feed = $("#feed");
    feed.innerHTML = "";
    var list = visibleRisks();
    if (!list.length) {
      feed.appendChild(el("div", "detail-empty", "<div>No risks match this filter. 🎉</div>"));
    }
    list.forEach(function (r) {
      var card = el("div", "risk sev-" + r.sev + (r.resolved ? " resolved" : "") + (state.selectedId === r.id ? " selected" : ""));
      card.setAttribute("data-id", r.id);
      var statusHtml = r.resolved
        ? '<span class="status-chip done">' + IC.check + ' ' + (r.resolution || "Resolved") + '</span>'
        : (r.owner !== "Unassigned"
            ? '<span class="status-chip">' + r.owner + '</span>'
            : '<span class="status-chip">Unassigned</span>');
      var rankHtml = (state.sort === "priority" && !r.resolved)
        ? '<span class="rank-badge' + (r._rank === 1 ? " top" : "") + '">#' + r._rank + '</span>'
        : '';
      var scoreLbl = state.sort === "priority" ? "sev " + r.score : r.score;
      card.innerHTML =
        rankHtml +
        '<div class="sev-ic">' + sevIcon(r.sev) + '</div>' +
        '<div><div class="risk-title">' + r.title + '</div>' +
          '<div class="risk-meta"><span><b>' + r.metric + '</b></span><span>' + r.team + '</span><span>' + r.age + '</span></div></div>' +
        '<div class="risk-right"><span class="score ' + scoreCls(r.sev) + '">' + scoreLbl + '</span>' + statusHtml + '</div>';
      card.addEventListener("click", function () { selectRisk(r.id); });
      feed.appendChild(card);
    });
    // badge = active high/med unresolved
    var open = risks.filter(function (r) { return !r.resolved; }).length;
    $("#navBadge").textContent = open;
    $("#kRisks").textContent = open;
  }

  /* ---------- render: detail ---------- */
  function selectRisk(id) {
    state.selectedId = id;
    renderFeed();
    var r = risks.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    var d = $("#detail");
    var sigHtml = r.signals.map(function (s) {
      return '<div class="signal-row"><span class="src">' + s.src + '</span><span>' + s.label +
        '</span><span class="mini-bar"><i style="width:' + s.w + '%"></i></span></div>';
    }).join("");
    var actHtml = r.actions.map(function (a, i) {
      return '<button class="action' + (a.rec ? " rec" : "") + '" data-act="' + i + '">' +
        '<span class="a-ic">' + (IC[a.ic] || IC.flow) + '</span>' +
        '<span class="a-txt"><strong>' + a.t + '</strong><small>' + a.s + '</small></span>' +
        (a.rec ? '<span class="tag-rec">AI pick</span>' : '') + '</button>';
    }).join("");

    var conf = Math.round(r.why.confidence * 100);
    var confCls = conf >= 80 ? "hi" : conf >= 65 ? "md" : "lo";

    // 0 · Why it ranks where it does — the cross-insight prioritization view
    var pf = function (name, bar, val, cls) {
      return '<div class="pf"><span class="pf-n">' + name + '</span>' +
        '<span class="pf-bar"><i class="' + (cls || "") + '" style="width:' + bar + '%"></i></span>' +
        '<b>' + val + '</b></div>';
    };
    var prioHtml =
      '<div class="prio-box">' +
        '<div class="prio-rank' + (r._rank === 1 ? " top" : "") + '">#' + r._rank + '<small>of ' + risks.length + '</small></div>' +
        '<div class="prio-body">' +
          '<div class="prio-why">' + r.priority.rationale + '</div>' +
          '<div class="prio-factors">' +
            pf("Impact", r._impBar, r.priority.impactLabel, "imp") +
            pf("Confidence", conf, conf + "%", "cf") +
            pf("Urgency", urgencyBar(r.priority.urgencyDays), r.priority.urgencyLabel, "urg") +
          '</div>' +
          '<div class="prio-formula">Priority = annualized $ × confidence × urgency · <span>weights are tunable per org</span></div>' +
        '</div>' +
      '</div>';

    // 3 · What it's worth — dollar range with the math shown, or an honest "uncosted"
    var worthHtml = r.impact.costed
      ? '<div class="q-worth">' +
          '<div class="worth-top"><span class="worth-val">' + r.impact.value + '</span>' +
            '<span class="worth-type">' + r.impact.type + ' · ' + r.impact.horizon + '</span></div>' +
          '<div class="worth-formula"><span class="wf-lbl">how</span>' + r.impact.formula + '</div>' +
          '<div class="worth-note">Range, not a point estimate — the figure a CRO can defend, with its inputs shown.</div>' +
        '</div>'
      : '<div class="q-worth uncosted">' + r.impact.note + '</div>';

    d.innerHTML =
      '<div class="detail">' +
        '<h3>' + r.title + '</h3>' +
        '<div class="d-sub">' + r.team + ' · risk score <b style="color:var(--text)">' + r.score + '/100</b> · <span class="ins-id">' + r.iid + '</span>' + (r.resolved ? ' · <span style="color:var(--ok)">✓ ' + (r.resolution || "resolved") + '</span>' : '') + '</div>' +

        prioHtml +

        // 1 · What happened — deterministic
        '<div class="d-section"><div class="lbl">' + IC.pulse + ' What happened <span class="lbl-tag det">deterministic</span></div>' +
          '<div class="q-what">' + r.whatHappened + '</div></div>' +

        // 2 · Why — hypothesis + confidence + correlated signals
        '<div class="d-section"><div class="lbl">' + IC.brain + ' Why <span class="lbl-tag hyp">hypothesis</span>' +
            '<span class="conf-inline ' + confCls + '">confidence ' + conf + '%</span></div>' +
          '<div class="q-why">' +
            '<div class="conf-meter ' + confCls + '"><i style="width:' + conf + '%"></i></div>' +
            '<p>' + r.why.hypothesis + '</p>' +
            '<div class="hyp-note">' + r.why.note + '</div>' +
          '</div>' +
          '<div class="signals">' + sigHtml + '</div></div>' +

        // 3 · What it's worth
        '<div class="d-section"><div class="lbl">' + IC.coin + ' What it\'s worth</div>' +
          worthHtml + '</div>' +

        // 4 · What to do — with owner role + playbook
        '<div class="d-section"><div class="lbl">' + IC.esc + ' What to do</div>' +
          '<div class="rec-meta">Owner <b>' + r.rec.owner + '</b><span class="rec-dot">·</span>Playbook <code>' + r.rec.playbook + '</code></div>' +
          '<div class="actions">' + actHtml + '</div></div>' +

        // provenance — every field traces to one agent
        '<div class="provenance">' +
          '<span class="pv-lbl">Field provenance</span>' +
          '<span class="pv"><i>Detection</i> what</span>' +
          '<span class="pv"><i>Root-Cause</i> why</span>' +
          '<span class="pv"><i>Impact Model</i> worth</span>' +
          '<span class="pv"><i>Recommendation</i> action</span>' +
        '</div>' +
      '</div>';

    $$(".action", d).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var a = r.actions[+btn.getAttribute("data-act")];
        applyAction(r, a);
      });
    });
    $("#detailPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* ---------- actions ---------- */
  function applyAction(r, a) {
    var msg;
    switch (a.ic) {
      case "esc":
        r.owner = "Escalated"; msg = "Escalated · " + a.t; break;
      case "assign":
        r.owner = "Assigned to you"; msg = "Assigned · owner set"; break;
      case "coach":
        r.owner = "Coaching scheduled"; msg = "Coaching session created"; break;
      case "dismiss":
        r.resolved = true; r.resolution = "Snoozed"; msg = "Risk snoozed"; break;
      case "flow":
      default:
        r.owner = "Action queued"; msg = "Workflow change queued"; break;
    }
    // Recommended/primary actions on high/med risks also resolve them for the demo loop
    if (a.rec && a.ic !== "dismiss") {
      r.resolved = true;
      r.resolution = a.ic === "coach" ? "Coaching booked" : a.ic === "esc" ? "Escalated" : "Fix shipped";
      state.health = Math.min(96, state.health + ri(1, 3));
    }
    toast(msg, a.t);
    renderFeed();
    renderHealth();
    // update detail view
    if (r.resolved && a.rec) {
      state.selectedId = null;
      $("#detail").innerHTML =
        '<div class="detail-empty"><svg viewBox="0 0 24 24" fill="none"><path d="M20 6 9 17l-5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '<div><b style="color:var(--ok)">Resolved.</b> "' + r.title + '" cleared from the feed. Health index updated.</div></div>';
    } else {
      selectRisk(r.id);
    }
  }

  /* ---------- render: sources ---------- */
  var srcCounts = {};
  function renderSources() {
    var wrap = $("#sources");
    wrap.innerHTML = "";
    sources.forEach(function (s) {
      if (srcCounts[s.name] == null) srcCounts[s.name] = s.base;
      var row = el("div", "src");
      row.innerHTML =
        '<div class="s-ic">' + (IC[s.ic] || IC.ticket) + '</div>' +
        '<div><div class="s-name">' + s.name + '</div><div class="s-meta">' + s.meta + '</div></div>' +
        '<div class="s-live"><div class="cnt" data-src="' + s.name + '">' + srcCounts[s.name].toLocaleString() + '</div>' +
        '<div class="st"><span class="dot-live"></span>synced</div></div>';
      wrap.appendChild(row);
    });
  }

  /* ---------- render: QA teams ---------- */
  function renderQa() {
    var wrap = $("#qaTeam");
    wrap.innerHTML = "";
    teams.forEach(function (t) {
      var row = el("div", "qa-row");
      row.innerHTML =
        '<div class="qa-top"><span>' + t.name + '</span><b>' + t.score + '%</b></div>' +
        '<div class="qa-bar"><i style="width:0%;background:' + t.color + '"></i></div>';
      wrap.appendChild(row);
      requestAnimationFrame(function () { $("i", row).style.width = t.score + "%"; });
    });
  }

  /* ---------- render: health gauge ---------- */
  function renderHealth() {
    var pct = state.health;
    var arc = $("#gaugeArc");
    var circ = 264;
    arc.setAttribute("stroke-dashoffset", (circ - (circ * pct / 100)).toFixed(1));
    $("#gaugeNum").textContent = pct;
    $("#kHealth").textContent = pct;
    var delta = pct - state.prevHealth;
    var g = $("#gaugeDelta");
    g.textContent = (delta >= 0 ? "▲ +" : "▼ ") + delta + " vs last sync";
    g.style.color = delta >= 0 ? "var(--ok)" : "var(--danger)";
  }

  /* ---------- toast ---------- */
  function toast(title, sub) {
    var wrap = $("#toasts");
    var t = el("div", "toast");
    t.innerHTML = '<div class="t-ic">' + IC.check + '</div><div><strong>' + title + '</strong><small>' + (sub || "") + '</small></div>';
    wrap.appendChild(t);
    setTimeout(function () { t.classList.add("exit"); setTimeout(function () { t.remove(); }, 320); }, 3200);
  }

  /* ---------- live ingest ticker ---------- */
  var tickClock = 9 * 3600 + 41 * 60; // 09:41:00 baseline seconds
  function fmtClock() {
    var s = tickClock % 60, m = Math.floor(tickClock / 60) % 60, h = Math.floor(tickClock / 3600) % 24;
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(h) + ":" + p(m) + ":" + p(s);
  }
  function pushTick() {
    tickClock += ri(3, 40);
    var tpl = tickTemplates[ri(0, tickTemplates.length - 1)];
    var wrap = $("#ticker");
    var t = el("div", "tick");
    t.innerHTML = '<span class="t-dot" style="background:' + tpl.c + '"></span><span class="t-src">' + tpl.src + '</span>&nbsp;' + tpl.txt + '<time>' + fmtClock() + '</time>';
    wrap.insertBefore(t, wrap.firstChild);
    while (wrap.children.length > 7) wrap.removeChild(wrap.lastChild);
    // bump source counters
    var name = tpl.src === "QA" ? "Klaus QA" : tpl.src === "Survey" ? "Delighted" : tpl.src === "Chat" ? "Intercom" : tpl.src === "Calls" ? "Aircall" : "Zendesk";
    if (srcCounts[name] != null) {
      srcCounts[name] += ri(1, 3);
      var c = $('[data-src="' + name + '"]');
      if (c) c.textContent = srcCounts[name].toLocaleString();
    }
  }

  /* ---------- tabs, search, nav ---------- */
  function bindControls() {
    $$(".tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        $$(".tab").forEach(function (t) { t.classList.remove("active"); });
        tab.classList.add("active");
        state.filter = tab.getAttribute("data-filter");
        renderFeed();
      });
    });
    $("#searchBox").addEventListener("input", renderFeed);

    $$(".seg-sort button").forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.classList.contains("on")) return;
        $$(".seg-sort button").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on");
        state.sort = b.getAttribute("data-sort");
        var note = $("#rankNote");
        if (note) note.textContent = state.sort === "priority"
          ? "impact × confidence × urgency — what to fix first, not just what's loudest"
          : "raw severity score — how alarming, regardless of dollar impact or deadline";
        renderFeed();
        if (state.selectedId) selectRisk(state.selectedId);
      });
    });

    var views = {
      feed:        ["Decision Feed", "Prioritized risks across your operation"],
      signals:     ["Signals", "Unified stream from every connected source"],
      analytics:   ["Analytics", "Trends across CSAT, SLA and QA"],
      team:        ["Team", "Agent performance & coaching"],
      integrations:["Integrations", "Connect ticketing, telephony, QA & feedback"],
      settings:    ["Settings", "Workspace configuration"]
    };
    $$(".nav-item").forEach(function (n) {
      n.addEventListener("click", function () {
        $$(".nav-item").forEach(function (x) { x.classList.remove("active"); });
        n.classList.add("active");
        var v = n.getAttribute("data-view");
        var meta = views[v] || views.feed;
        $("#viewTitle").textContent = meta[0];
        $("#viewSub").innerHTML = meta[1] + ' · <span id="today"></span>';
        setToday();

        var isAnalytics = (v === "analytics");
        $("#view-feed").hidden = isAnalytics;
        $("#view-analytics").hidden = !isAnalytics;
        if (isAnalytics && window.Analytics) {
          window.Analytics.render($("#view-analytics"));
        } else if (v !== "feed" && v !== "analytics") {
          toast(meta[0] + " view", "Prototype focuses on Feed & Analytics");
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });
  }

  function setToday() {
    var t = $("#today");
    if (t) t.textContent = "Wed, Jul 22 · 09:41 local";
  }

  /* ---------- boot ---------- */
  function init() {
    setToday();
    computePriority();
    renderKpis();
    renderFeed();
    renderSources();
    renderQa();
    renderHealth();
    bindControls();
    // seed ticker
    for (var i = 0; i < 5; i++) pushTick();
    setInterval(pushTick, 2600);
    // subtle KPI drift
    setInterval(function () {
      var csat = $("#kCsat");
      if (csat) { var base = 78 + ri(0, 2); csat.textContent = base + "%"; }
    }, 5200);
    // auto-select top risk after a beat
    setTimeout(function () { selectRisk("r1"); }, 500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
