/* ==========================================================================
   OpsPulse AI — Ops Copilot Dashboard engine
   --------------------------------------------------------------------------
   This screen used to run on its own PRNG and five hand-written risk cards, so
   it agreed with nothing else in the repo. It now reads the SAME store as
   NorthDesk and OpsPulse — which means it also joins the cross-tab sync, and a
   ticket arriving here is the ticket the service desk is showing.

   Every renderer below is unchanged. What changed is where `risks`, `kpis`,
   `sources` and `teams` come from: assets/app-data.js maps the engine's
   insight objects onto the shapes these functions already expected.
   ========================================================================== */
import { createStore } from '../data/store.js';
import { buildModel, buildAnalytics, analyticsBounds, tickRows } from './app-data.js';

(function () {
  "use strict";

  var store = createStore();
  var model = null;

  /* Local, per-insight UI state — who you assigned it to, whether you cleared
     it. Held outside the model because the model is rebuilt on every engine
     pass; without this, dismissing a card would un-dismiss it nine seconds
     later. Keyed by insight_id, so it survives a rebuild but not a reseed. */
  var uiState = {};

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

  /* ---------- view state ---------- */
  var state = {
    filter: "all",
    sort: "priority",   // "priority" (impact × confidence × urgency) | "severity"
    selectedId: null,
    health: 82,
    prevHealth: 80
  };

  /* Each risk is a full insight object — the four questions (what / why / worth /
     do) every downstream agent contributes to. The feed row shows the same shape;
     the Insight Explorer renders the richer object behind it.

     Populated by applyModel() from store.engine.insights. The literals that used
     to live here are gone: they described a company that did not exist. */
  var risks = [];
  var sources = [], teams = [], kpis = [];

  /** Rebuild every list from the store. Called on mount and on each engine pass. */
  function applyModel() {
    model = buildModel(store);
    risks = model.risks.map(function (r) {
      var u = uiState[r.id];
      return u ? Object.assign(r, u) : r;
    });
    sources = model.sources;
    teams = model.teams;
    kpis = model.kpis;
    state.prevHealth = model.prevHealth;
    state.health = model.health;
  }
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
          '<div class="worth-note">Range, not a point estimate: the figure a CRO can defend, with its inputs shown.</div>' +
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
    }
    /* Remember the decision against the insight id. The model is rebuilt from
       the engine every pass, so anything recorded only on `r` would be gone in
       nine seconds — the card would quietly reappear after you cleared it. */
    uiState[r.id] = { owner: r.owner, resolved: !!r.resolved, resolution: r.resolution };
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
  /* `base` is now a real count of records in the store rather than a starting
     number to drift upward from, so the rail is re-read instead of remembered. */
  var srcCounts = {};
  function renderSources() {
    var wrap = $("#sources");
    wrap.innerHTML = "";
    sources.forEach(function (s) {
      srcCounts[s.name] = s.base;
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

  /* ---------- live ingest ticker ----------
     Was a rotating list of invented one-liners on a 2.6s timer. It now renders
     the store's event feed, so each row is a record that exists — and the row
     you see here is the row NorthDesk just added to its queue. */
  function fmtClock(at) {
    var d = new Date(at);
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }
  function renderTicker() {
    var wrap = $("#ticker");
    if (!wrap) return;
    wrap.innerHTML = "";
    var rows = tickRows(store, 7);
    if (!rows.length) {
      wrap.appendChild(el("div", "tick", '<span class="t-src">Waiting for the first events…</span>'));
      return;
    }
    rows.forEach(function (r) {
      var t = el("div", "tick");
      t.innerHTML = '<span class="t-dot" style="background:' + r.c + '"></span><span class="t-src">' + r.src + '</span>&nbsp;' + r.txt + '<time>' + fmtClock(r.at) + '</time>';
      wrap.appendChild(t);
    });
    // The connector counters move because records arrived, not because a timer fired.
    sources.forEach(function (s) {
      var c = $('[data-src="' + s.name + '"]');
      if (c) c.textContent = s.base.toLocaleString();
    });
  }

  /* ---------- tabs, search, nav ---------- */

  /* These controls are <div>/<span> rather than <button> for layout reasons
     that predate this file, which means none of the behaviour a button gives
     for free is present: no focus, no Enter/Space, and a selected state
     carried only by a CSS class. `role="tab"` + `tabindex` in the markup make
     them reachable; this makes them operable and keeps aria-selected in step
     with the class, so the selection is announced rather than only coloured. */
  function activateOnKey(el, fn) {
    el.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
      e.preventDefault();          // Space would otherwise scroll the page
      fn();
    });
  }
  function markSelected(group, chosen) {
    group.forEach(function (x) {
      var on = x === chosen;
      x.classList.toggle("active", on);
      x.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function bindControls() {
    var tabs = $$(".tab");
    tabs.forEach(function (tab) {
      var choose = function () {
        markSelected(tabs, tab);
        state.filter = tab.getAttribute("data-filter");
        renderFeed();
      };
      tab.addEventListener("click", choose);
      activateOnKey(tab, choose);
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
          ? "impact × confidence × urgency: what to fix first, not just what's loudest"
          : "raw severity score: how alarming, regardless of dollar impact or deadline";
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
    var navItems = $$(".nav-item");
    navItems.forEach(function (n) {
      var choose = function () {
        markSelected(navItems, n);
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
          toast(meta[0] + " view", "This MVP focuses on Feed & Analytics");
        }
        window.scrollTo({ top: 0, behavior: "smooth" });
      };
      n.addEventListener("click", choose);
      activateOnKey(n, choose);
    });
  }

  function setToday() {
    var t = $("#today");
    if (t) t.textContent = (model ? model.today : "") + " local";
  }

  /* Redraw everything that reads the model. Called on each engine pass — the
     ~9s cadence, not the ~3.2s tick, so the feed does not reshuffle under a
     reader mid-sentence. The ticker updates on the tick; the cards do not. */
  function renderAll() {
    applyModel();
    computePriority();
    setToday();
    renderKpis();
    renderFeed();
    renderSources();
    renderQa();
    renderHealth();
    renderTicker();
    if (state.selectedId && risks.some(function (r) { return r.id === state.selectedId; })) selectRisk(state.selectedId);
  }

  /* ---------- boot ---------- */
  function init() {
    applyModel();
    setToday();
    computePriority();
    renderKpis();
    renderFeed();
    renderSources();
    renderQa();
    renderHealth();
    renderTicker();
    bindControls();

    // The analytics view charts the same dataset instead of its own PRNG.
    // Passing bounds is what enables its custom date range — the picker has to
    // know where the data starts and stops before it can offer dates.
    if (window.Analytics && window.Analytics.setProvider) {
      window.Analytics.setProvider(
        function (range) { return buildAnalytics(store, range); },
        analyticsBounds(store),
      );
    }

    store.subscribe(function (evt) {
      if (evt.type === "tick") { renderTicker(); return; }
      if (evt.type === "engine" || evt.type === "reset") {
        if (evt.type === "reset") {
          uiState = {};                              // new world, no stale dismissals
          // A reseed moves day 0, so the date picker's limits move with it.
          if (window.Analytics && window.Analytics.setBounds) window.Analytics.setBounds(analyticsBounds(store));
        }
        renderAll();
        if (!$("#view-analytics").hidden && window.Analytics) window.Analytics.render($("#view-analytics"));
      }
    });

    // auto-select the top-ranked risk after a beat
    setTimeout(function () {
      var top = risks.slice().sort(function (a, b) { return a._rank - b._rank; })[0];
      if (top) selectRisk(top.id);
    }, 500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
