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
    chat: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 5h16v11H9l-5 4V5Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>'
  };

  /* ---------- mock data ---------- */
  var state = {
    filter: "all",
    selectedId: null,
    health: 82,
    prevHealth: 80
  };

  var risks = [
    {
      id: "r1", sev: "high", score: 94, title: "Enterprise churn risk — 6 accounts",
      owner: "Unassigned", team: "Customer Success", age: "12m ago",
      metric: "$310k ARR exposed",
      cause: "Onboarding SLA breached <b>3×</b> this week for accounts on the new provisioning flow. Sentiment on last-touch tickets dropped from <b>+0.4 to −0.6</b>, and 4 of 6 accounts have an open P1 older than 48h.",
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
      id: "r2", sev: "high", score: 87, title: "CSAT drop — Billing queue",
      owner: "Unassigned", team: "Support · Billing", age: "27m ago",
      metric: "CSAT 78% → 71%",
      cause: "A pricing-page change shipped Tuesday drove a <b>+41%</b> spike in refund tickets. Handle time is up 22% and first-contact resolution fell to <b>58%</b> as agents lack a clear refund policy for the new plans.",
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
      id: "r3", sev: "medium", score: 68, title: "Agent coaching gap — Team B",
      owner: "Unassigned", team: "Support · Tier 1", age: "44m ago",
      metric: "QA 84% → 74%",
      cause: "Three agents on Team B show a consistent QA dip on <b>technical troubleshooting</b>. Their escalation rate is 2.1× the team median, suggesting a knowledge gap rather than a behavior issue.",
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
      id: "r4", sev: "medium", score: 61, title: "SLA breach risk — EMEA night shift",
      owner: "Unassigned", team: "Support · EMEA", age: "1h ago",
      metric: "SLA 96% → 91%",
      cause: "Inbound volume in the EMEA 22:00–02:00 window is trending <b>+18%</b> week-over-week while staffing held flat. Projected SLA compliance dips below the 90% threshold within 3 days at the current trajectory.",
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
      id: "r5", sev: "low", score: 44, title: "Emerging topic — 'export to CSV'",
      owner: "Unassigned", team: "Product feedback", age: "2h ago",
      metric: "New pattern",
      cause: "A new feature-request cluster around <b>CSV export</b> is forming across tickets and chats. Not urgent, but volume is accelerating and worth routing to product as a signal.",
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
    }).sort(function (a, b) { return b.score - a.score; });
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
      card.innerHTML =
        '<div class="sev-ic">' + sevIcon(r.sev) + '</div>' +
        '<div><div class="risk-title">' + r.title + '</div>' +
          '<div class="risk-meta"><span><b>' + r.metric + '</b></span><span>' + r.team + '</span><span>' + r.age + '</span></div></div>' +
        '<div class="risk-right"><span class="score ' + scoreCls(r.sev) + '">' + r.score + '</span>' + statusHtml + '</div>';
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

    d.innerHTML =
      '<div class="detail">' +
        '<h3>' + r.title + '</h3>' +
        '<div class="d-sub">' + r.team + ' · risk score <b style="color:var(--text)">' + r.score + '/100</b> · ' + r.metric + (r.resolved ? ' · <span style="color:var(--ok)">✓ ' + (r.resolution || "resolved") + '</span>' : '') + '</div>' +

        '<div class="d-section"><div class="lbl">' + IC.info + ' Root-cause analysis</div>' +
          '<div class="root-cause">' + r.cause + '</div></div>' +

        '<div class="d-section"><div class="lbl">' + IC.qa + ' Contributing signals</div>' +
          '<div class="signals">' + sigHtml + '</div></div>' +

        '<div class="d-section"><div class="lbl">' + IC.esc + ' Recommended actions</div>' +
          '<div class="actions">' + actHtml + '</div></div>' +
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
