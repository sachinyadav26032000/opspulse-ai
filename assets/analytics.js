/* ==========================================================================
   OpsPulse AI — Analytics View
   Charts-heavy, fully self-contained SVG. No chart libraries.
   Palette: dataviz reference categorical (dark steps) for multi-series;
            brand emerald/cyan for single-series. Diverging blue↔red for sentiment.
   ========================================================================== */
window.Analytics = (function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"];
  var BRAND = "#34d399", BRAND2 = "#22d3ee";
  var DIV = { pos: "#3987e5", neg: "#e66767", mid: "#2b3450" };

  /* seeded PRNG so data is stable per range */
  function makeRng(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  /* `range` is a trailing day count (7/30/90). `custom` overrides it with an
     explicit {from,to} of day indices when the user picks dates; `span` is how
     many days that works out to, which the labels and the window caption need. */
  var state = { range: 30, custom: null, span: 30, mounted: false, tables: {} };
  var bounds = null;                 // {days, minDate, maxDate} — set by the host
  var tip = null;

  /* ---------------- data ---------------- */
  /* Every chart below is fed by exactly one function, which is what makes this
     view swappable: app.js injects a provider that computes the same object
     from the live dataset. The simulated version stays as the fallback so the
     file still runs standalone, but nothing wired to a store ever reaches it. */
  var provider = null;

  /** The window currently selected, in whatever form the provider understands. */
  function currentRange() { return state.custom || state.range; }

  function genData(days) {
    if (provider) return provider(currentRange());
    // Fallback path (analytics.js standalone) only understands a day count.
    days = state.span;
    var rng = makeRng(days === 7 ? 11 : days === 90 ? 91 : 30);
    var labels = [], csat = [], nps = [], sla = [], handle = [];
    var channels = { Tickets: [], Calls: [], Chat: [], Survey: [], QA: [] };
    var chanKeys = Object.keys(channels);
    var now = 21; // day-of-month anchor (Date-free)
    for (var i = 0; i < days; i++) {
      // label
      var dayIdx = (now - (days - 1 - i));
      labels.push(labelFor(dayIdx, days, i));
      // CSAT: gentle decline in the final stretch
      var dip = i > days - 8 ? (i - (days - 8)) * 0.7 : 0;
      csat.push(clamp(84 + Math.sin(i * 0.5) * 2 + (rng() - 0.5) * 3 - dip, 68, 92));
      nps.push(clamp(41 + Math.sin(i * 0.4 + 1) * 5 + (rng() - 0.5) * 5 - dip * 0.6, 20, 60));
      sla.push(clamp(95 + Math.sin(i * 0.7) * 1.6 + (rng() - 0.5) * 1.4 - dip * 0.4, 88, 99));
      handle.push(clamp(4.4 + Math.sin(i * 0.3) * 0.5 + (rng() - 0.5) * 0.5, 3.4, 6.2));
      // channel volume
      chanKeys.forEach(function (k, ki) {
        var b = [520, 180, 300, 90, 60][ki];
        var wk = ((dayIdx % 7) === 0 || (dayIdx % 7) === 6) ? 0.6 : 1; // weekend dip
        channels[k].push(Math.round((b * wk) * (0.8 + rng() * 0.5)));
      });
    }
    // risk mix
    var riskMix = [
      { label: "Churn risk", value: 34 },
      { label: "CSAT / quality", value: 27 },
      { label: "SLA breach", value: 19 },
      { label: "Coaching gap", value: 14 },
      { label: "Other signals", value: 6 }
    ];
    // resolution time distribution
    var resBuckets = [
      { label: "<1h", value: 18 }, { label: "1–2h", value: 31 },
      { label: "2–4h", value: 24 }, { label: "4–8h", value: 14 },
      { label: "8–24h", value: 9 }, { label: ">24h", value: 4 }
    ];
    // sentiment heatmap: 7 days x 12 two-hour buckets, value -1..1
    var heat = [];
    var rng2 = makeRng(7);
    for (var d = 0; d < 7; d++) {
      var row = [];
      for (var h = 0; h < 12; h++) {
        var peak = (h >= 4 && h <= 8) ? 0.25 : -0.1;          // daytime better
        var weekend = (d >= 5) ? -0.2 : 0;
        var v = clamp(peak + weekend + (rng2() - 0.5) * 0.9, -1, 1);
        row.push(v);
      }
      heat.push(row);
    }
    // QA by dimension (radar), two teams
    var qaDims = ["Greeting", "Accuracy", "Empathy", "Resolution", "Compliance", "Efficiency"];
    var qaTeams = [
      { name: "Team A · Onboarding", color: SERIES[0], vals: [92, 88, 90, 86, 94, 83] },
      { name: "Team B · Tier 1", color: SERIES[1], vals: [80, 71, 84, 68, 88, 74] }
    ];
    // agent leaderboard
    var agents = [
      { name: "Priya N.", score: 96 }, { name: "Marcus L.", score: 93 },
      { name: "Sofia R.", score: 91 }, { name: "David K.", score: 88 },
      { name: "Amara O.", score: 85 }, { name: "Liam W.", score: 82 },
      { name: "Chen Y.", score: 79 }, { name: "Noah B.", score: 74 }
    ];

    return { labels: labels, csat: csat, nps: nps, sla: sla, handle: handle,
             channels: channels, chanKeys: chanKeys, riskMix: riskMix, resBuckets: resBuckets,
             heat: heat, qaDims: qaDims, qaTeams: qaTeams, agents: agents };
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function labelFor(dayIdx, days, i) {
    var dow = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][((dayIdx % 7) + 7) % 7];
    if (days === 7) return dow;
    // show a label every ~Math.ceil(days/8) points
    var step = Math.ceil(days / 7);
    return (i % step === 0) ? ("Jul " + ((dayIdx % 31) + 1)) : "";
  }

  /* ---------------- svg helpers ---------------- */
  function svgEl(w, h) {
    return '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet" role="img">';
  }
  function niceMax(v) { var p = Math.pow(10, Math.floor(Math.log10(v))); return Math.ceil(v / p) * p; }

  /* ---------- LINE / AREA (single series, rich crosshair) ---------- */
  function areaChart(opts) {
    // opts: {labels, data, color, min, max, fmt, id, unit}
    var W = 760, H = 260, L = 46, R = 18, T = 18, B = 34;
    var n = opts.data.length;
    var min = opts.min, max = opts.max;
    var pw = W - L - R, ph = H - T - B;
    var sx = function (i) { return L + (n === 1 ? pw / 2 : (i / (n - 1)) * pw); };
    var sy = function (v) { return T + ph - ((v - min) / (max - min)) * ph; };
    var fmt = opts.fmt || function (v) { return Math.round(v); };

    var s = svgEl(W, H);
    // gridlines + y labels (5 ticks)
    for (var g = 0; g <= 4; g++) {
      var gv = min + (max - min) * g / 4;
      var gy = sy(gv);
      s += '<line class="grid-line" x1="' + L + '" y1="' + gy.toFixed(1) + '" x2="' + (W - R) + '" y2="' + gy.toFixed(1) + '"/>';
      s += '<text x="' + (L - 8) + '" y="' + (gy + 3).toFixed(1) + '" text-anchor="end">' + fmt(gv) + '</text>';
    }
    // x labels
    opts.labels.forEach(function (lb, i) {
      if (!lb) return;
      s += '<text x="' + sx(i).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle">' + lb + '</text>';
    });
    // area + line
    var linePts = opts.data.map(function (v, i) { return sx(i).toFixed(1) + " " + sy(v).toFixed(1); });
    var areaD = "M" + L + " " + (T + ph) + " L" + linePts.join(" L") + " L" + (W - R) + " " + (T + ph) + " Z";
    var lineD = "M" + linePts.join(" L");
    var gid = "ag_" + opts.id;
    s += '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
         '<stop offset="0" stop-color="' + opts.color + '" stop-opacity="0.34"/>' +
         '<stop offset="1" stop-color="' + opts.color + '" stop-opacity="0"/></linearGradient></defs>';
    s += '<path d="' + areaD + '" fill="url(#' + gid + ')"/>';
    s += '<path d="' + lineD + '" fill="none" stroke="' + opts.color + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';
    // crosshair + dot (hidden until hover)
    s += '<line class="crosshair" id="cx_' + opts.id + '" x1="0" y1="' + T + '" x2="0" y2="' + (T + ph) + '" style="opacity:0"/>';
    s += '<circle id="cd_' + opts.id + '" r="5" fill="' + opts.color + '" stroke="#0e1425" stroke-width="2" style="opacity:0"/>';
    // hit area
    s += '<rect class="hit" x="' + L + '" y="' + T + '" width="' + pw + '" height="' + ph + '" data-hit="' + opts.id + '"/>';
    s += '</svg>';

    // stash geometry for interactivity
    GEO[opts.id] = { sx: sx, sy: sy, n: n, data: opts.data, labels: opts.labels, color: opts.color, unit: opts.unit || "", name: opts.name, fmt: fmt, L: L, R: R, pw: pw, W: W };
    return s;
  }
  var GEO = {};

  /* ---------- STACKED AREA (channels) ---------- */
  function stackedArea(opts) {
    var W = 760, H = 260, L = 46, R = 18, T = 18, B = 34;
    var keys = opts.keys, data = opts.data, labels = opts.labels;
    var n = labels.length;
    // totals
    var totals = [];
    for (var i = 0; i < n; i++) { var t = 0; keys.forEach(function (k) { t += data[k][i]; }); totals.push(t); }
    var max = niceMax(Math.max.apply(null, totals) * 1.05);
    var pw = W - L - R, ph = H - T - B;
    var sx = function (i) { return L + (i / (n - 1)) * pw; };
    var sy = function (v) { return T + ph - (v / max) * ph; };

    var s = svgEl(W, H);
    for (var g = 0; g <= 4; g++) {
      var gv = max * g / 4, gy = sy(gv);
      s += '<line class="grid-line" x1="' + L + '" y1="' + gy.toFixed(1) + '" x2="' + (W - R) + '" y2="' + gy.toFixed(1) + '"/>';
      s += '<text x="' + (L - 8) + '" y="' + (gy + 3).toFixed(1) + '" text-anchor="end">' + Math.round(gv) + '</text>';
    }
    labels.forEach(function (lb, i) { if (lb) s += '<text x="' + sx(i).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle">' + lb + '</text>'; });

    // build cumulative bands bottom→top
    var baseline = new Array(n).fill(0);
    keys.forEach(function (k, ki) {
      var top = baseline.map(function (b, i) { return b + data[k][i]; });
      var up = top.map(function (v, i) { return sx(i).toFixed(1) + " " + sy(v).toFixed(1); });
      var dn = baseline.map(function (v, i) { return sx(i).toFixed(1) + " " + sy(v).toFixed(1); }).reverse();
      var d = "M" + up.join(" L") + " L" + dn.join(" L") + " Z";
      s += '<path d="' + d + '" fill="' + SERIES[ki] + '" fill-opacity="0.82"/>';
      // 2px surface separator on top boundary
      s += '<path d="M' + up.join(" L") + '" fill="none" stroke="#0e1425" stroke-width="2"/>';
      s += '<path d="M' + up.join(" L") + '" fill="none" stroke="' + SERIES[ki] + '" stroke-width="1"/>';
      baseline = top;
    });
    s += '<line class="crosshair" id="cx_chan" x1="0" y1="' + T + '" x2="0" y2="' + (T + ph) + '" style="opacity:0"/>';
    s += '<rect class="hit" x="' + L + '" y="' + T + '" width="' + pw + '" height="' + ph + '" data-hit="chan"/>';
    s += '</svg>';

    GEO.chan = { sx: sx, n: n, keys: keys, data: data, labels: labels, L: L, pw: pw, W: W, totals: totals };
    return s;
  }

  /* ---------- HISTOGRAM (single series) ---------- */
  function histogram(buckets) {
    var W = 380, H = 220, L = 34, R = 12, T = 14, B = 40;
    var max = niceMax(Math.max.apply(null, buckets.map(function (b) { return b.value; })));
    var pw = W - L - R, ph = H - T - B;
    var bw = pw / buckets.length;
    var s = svgEl(W, H);
    for (var g = 0; g <= 3; g++) {
      var gy = T + ph - (ph * g / 3);
      s += '<line class="grid-line" x1="' + L + '" y1="' + gy + '" x2="' + (W - R) + '" y2="' + gy + '"/>';
      s += '<text x="' + (L - 6) + '" y="' + (gy + 3) + '" text-anchor="end">' + Math.round(max * g / 3) + '</text>';
    }
    buckets.forEach(function (b, i) {
      var h = (b.value / max) * ph;
      var x = L + i * bw + bw * 0.16, y = T + ph - h, w = bw * 0.68;
      s += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(h, 2).toFixed(1) + '" rx="4" fill="' + BRAND + '" class="mk" data-tip="' + b.label + '§' + b.value + '% of tickets"/>';
      s += '<text x="' + (L + i * bw + bw / 2).toFixed(1) + '" y="' + (H - 22) + '" text-anchor="middle">' + b.label + '</text>';
      s += '<text class="val-label" x="' + (L + i * bw + bw / 2).toFixed(1) + '" y="' + (y - 5).toFixed(1) + '" text-anchor="middle">' + b.value + '%</text>';
    });
    s += '</svg>';
    return s;
  }

  /* ---------- DONUT ---------- */
  function donut(items) {
    var W = 340, H = 240, cx = 118, cy = 120, rO = 92, rI = 58;
    var total = items.reduce(function (a, b) { return a + b.value; }, 0);
    var s = svgEl(W, H);
    var ang = -Math.PI / 2;
    items.forEach(function (it, i) {
      var frac = it.value / total;
      var a2 = ang + frac * Math.PI * 2;
      var gap = 0.03; // ~surface gap between arcs
      s += arcPath(cx, cy, rI, rO, ang + gap, a2 - gap, SERIES[i % SERIES.length]);
      // direct % label
      var mid = (ang + a2) / 2, lr = (rO + rI) / 2;
      var lx = cx + Math.cos(mid) * lr, ly = cy + Math.sin(mid) * lr;
      if (frac > 0.06) s += '<text x="' + lx.toFixed(1) + '" y="' + (ly + 3).toFixed(1) + '" text-anchor="middle" style="fill:#fff;font-weight:700">' + Math.round(frac * 100) + '%</text>';
      ang = a2;
    });
    s += '<text x="' + cx + '" y="' + (cy - 4) + '" text-anchor="middle" style="fill:#fff;font-size:22px;font-weight:800">' + total + '</text>';
    s += '<text x="' + cx + '" y="' + (cy + 15) + '" text-anchor="middle" style="font-size:10px">open risks</text>';
    s += '</svg>';
    return s;
  }
  function arcPath(cx, cy, rI, rO, a1, a2, color) {
    var large = (a2 - a1) > Math.PI ? 1 : 0;
    var x1 = cx + Math.cos(a1) * rO, y1 = cy + Math.sin(a1) * rO;
    var x2 = cx + Math.cos(a2) * rO, y2 = cy + Math.sin(a2) * rO;
    var x3 = cx + Math.cos(a2) * rI, y3 = cy + Math.sin(a2) * rI;
    var x4 = cx + Math.cos(a1) * rI, y4 = cy + Math.sin(a1) * rI;
    return '<path d="M' + x1.toFixed(1) + ' ' + y1.toFixed(1) +
      ' A' + rO + ' ' + rO + ' 0 ' + large + ' 1 ' + x2.toFixed(1) + ' ' + y2.toFixed(1) +
      ' L' + x3.toFixed(1) + ' ' + y3.toFixed(1) +
      ' A' + rI + ' ' + rI + ' 0 ' + large + ' 0 ' + x4.toFixed(1) + ' ' + y4.toFixed(1) +
      ' Z" fill="' + color + '"/>';
  }

  /* ---------- RADAR (2 series) ---------- */
  function radar(dims, teams) {
    var W = 340, H = 300, cx = 170, cy = 150, r = 108;
    var n = dims.length;
    function pt(i, frac) {
      var a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      return [cx + Math.cos(a) * r * frac, cy + Math.sin(a) * r * frac];
    }
    var s = svgEl(W, H);
    // rings
    [0.25, 0.5, 0.75, 1].forEach(function (fr) {
      var pts = [];
      for (var i = 0; i < n; i++) { var p = pt(i, fr); pts.push(p[0].toFixed(1) + "," + p[1].toFixed(1)); }
      s += '<polygon points="' + pts.join(" ") + '" fill="none" stroke="rgba(255,255,255,0.08)"/>';
    });
    // axes + labels
    for (var i = 0; i < n; i++) {
      var p = pt(i, 1);
      s += '<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '" stroke="rgba(255,255,255,0.08)"/>';
      var lp = pt(i, 1.16);
      s += '<text x="' + lp[0].toFixed(1) + '" y="' + (lp[1] + 3).toFixed(1) + '" text-anchor="middle" style="font-size:10px">' + dims[i] + '</text>';
    }
    teams.forEach(function (tm) {
      var pts = tm.vals.map(function (v, i) { var p = pt(i, v / 100); return p[0].toFixed(1) + "," + p[1].toFixed(1); });
      s += '<polygon points="' + pts.join(" ") + '" fill="' + tm.color + '" fill-opacity="0.16" stroke="' + tm.color + '" stroke-width="2"/>';
      tm.vals.forEach(function (v, i) { var p = pt(i, v / 100); s += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3" fill="' + tm.color + '"/>'; });
    });
    s += '</svg>';
    return s;
  }

  /* ---------- mini sparkline for stat tiles ---------- */
  function spark(data, color, up) {
    var W = 200, H = 34, min = Math.min.apply(null, data), max = Math.max.apply(null, data), rng = (max - min) || 1;
    var pts = data.map(function (v, i) { return (i / (data.length - 1) * W).toFixed(1) + " " + (H - ((v - min) / rng) * (H - 4) - 2).toFixed(1); });
    return '<svg class="stat-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
      '<path d="M' + pts.join(" L") + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  /* ---------------- tables (accessibility) ---------------- */
  function trendTable(D) {
    var rows = '<div class="table-scroll"><table class="data-table"><thead><tr><th>Day</th><th>CSAT %</th><th>NPS</th><th>SLA %</th><th>Handle (h)</th></tr></thead><tbody>';
    D.labels.forEach(function (lb, i) {
      rows += '<tr><td>' + (lb || ("d" + (i + 1))) + '</td><td>' + D.csat[i].toFixed(1) + '</td><td>' + D.nps[i].toFixed(0) + '</td><td>' + D.sla[i].toFixed(1) + '</td><td>' + D.handle[i].toFixed(1) + '</td></tr>';
    });
    return rows + '</tbody></table></div>';
  }
  function chanTable(D) {
    var head = '<div class="table-scroll"><table class="data-table"><thead><tr><th>Day</th>' + D.chanKeys.map(function (k) { return '<th>' + k + '</th>'; }).join("") + '<th>Total</th></tr></thead><tbody>';
    D.labels.forEach(function (lb, i) {
      var t = 0; var cells = D.chanKeys.map(function (k) { t += D.channels[k][i]; return '<td>' + D.channels[k][i] + '</td>'; }).join("");
      head += '<tr><td>' + (lb || ("d" + (i + 1))) + '</td>' + cells + '<td>' + t + '</td></tr>';
    });
    return head + '</tbody></table></div>';
  }

  /* ---------------- render ---------------- */
  function render(mount) {
    var D = genData(state.range);
    GEO = {};

    var csatMin = 66, csatMax = 94;
    var html =
      '<div class="an-toolbar">' +
        '<div class="seg" id="rangeSeg">' +
          seg("7", "7d") + seg("30", "30d") + seg("90", "90d") +
        '</div>' +
        datePicker() +
        '<div class="grow"></div>' +
        '<div class="updated"><span class="dot-live"></span>Live · simulated data · ' + windowLabel() + '</div>' +
      '</div>' +

      /* summary tiles */
      '<div class="an-tiles" style="margin-bottom:18px">' +
        tile("Avg CSAT", avg(D.csat).toFixed(1) + "%", delta(D.csat), spark(D.csat, BRAND)) +
        tile("Avg NPS", Math.round(avg(D.nps)), delta(D.nps), spark(D.nps, BRAND2)) +
        tile("SLA Compliance", avg(D.sla).toFixed(1) + "%", delta(D.sla), spark(D.sla, SERIES[0])) +
        tile("Avg Handle Time", avg(D.handle).toFixed(1) + "h", delta(D.handle, true), spark(D.handle, SERIES[3])) +
      '</div>' +

      '<div class="an-grid">' +

        /* headline trend */
        panel("CSAT Trend", "customer satisfaction over time · one axis (%)",
          areaChart({ id: "csat", labels: D.labels, data: D.csat, color: BRAND, min: csatMin, max: csatMax, name: "CSAT", unit: "%", fmt: function (v) { return Math.round(v) + "%"; } }) +
          '<div class="legend"><span class="li"><span class="sw round" style="background:' + BRAND + '"></span>CSAT %</span></div>',
          "csat", trendTable(D)) +

        /* two-up: channels + risk mix */
        '<div class="an-3">' +
          panel("Ticket Volume by Channel", "stacked · same unit (interactions)",
            stackedArea({ labels: D.labels, keys: D.chanKeys, data: D.channels }) +
            legend(D.chanKeys, SERIES),
            "chan", chanTable(D)) +
          panel("Open Risk Mix", "share of active risks by category",
            donut(D.riskMix) + legend(D.riskMix.map(function (r) { return r.label; }), SERIES, true),
            null, null) +
        '</div>' +

        /* two-up: resolution histogram + sentiment heatmap */
        '<div class="an-2">' +
          panel("Resolution Time Distribution", "share of tickets by time-to-resolve",
            histogram(D.resBuckets), null, null) +
          panel("Sentiment by Hour", "diverging · negative ↔ positive (7 days × 2h)",
            heatmap(D.heat), null, null) +
        '</div>' +

        /* two-up: QA radar + leaderboard */
        '<div class="an-2">' +
          panel("QA Score by Dimension", "two teams across 6 quality dimensions",
            '<div class="radar-wrap">' + radar(D.qaDims, D.qaTeams) + '</div>' +
            legend(D.qaTeams.map(function (t) { return t.name; }), D.qaTeams.map(function (t) { return t.color; })),
            null, null) +
          panel("Agent Leaderboard", "composite quality score · top performers",
            hbars(D.agents), null, null) +
        '</div>' +

      '</div>';

    mount.innerHTML = html;

    // segmented range control — a preset always clears a custom window
    $$("#rangeSeg button").forEach(function (b) {
      b.classList.toggle("on", !state.custom && +b.getAttribute("data-v") === state.range);
      b.addEventListener("click", function () {
        state.range = +b.getAttribute("data-v");
        state.custom = null;
        state.span = state.range;
        render(mount);
      });
    });

    // custom range
    var applyBtn = $("#anApply");
    if (applyBtn) {
      applyBtn.addEventListener("click", function () {
        var f = dayOfIso($("#anFrom").value), t = dayOfIso($("#anTo").value);
        if (f == null || t == null) return;
        if (f > t) { var tmp = f; f = t; t = tmp; }        // picked back-to-front
        state.custom = { from: f, to: t };
        state.span = t - f + 1;
        render(mount);
      });
    }
    var clearBtn = $("#anClear");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        state.custom = null; state.span = state.range; render(mount);
      });
    }
    // Enter in either field applies, so the range can be set without reaching
    // for the button.
    $$("#anDates input").forEach(function (inp) {
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter" && applyBtn) applyBtn.click(); });
    });
    // table toggles
    $$("[data-table-toggle]", mount).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-table-toggle");
        var chart = $("#chartWrap_" + id), table = $("#tableWrap_" + id);
        var showTable = table.hidden;
        table.hidden = !showTable; chart.hidden = showTable;
        btn.classList.toggle("on", showTable);
        btn.textContent = showTable ? "Chart" : "Table";
      });
    });
    // animate hbars + heat
    requestAnimationFrame(function () {
      $$(".hbar-row .track i", mount).forEach(function (i) { i.style.width = i.getAttribute("data-w") + "%"; });
    });

    bindHovers(mount, D);
    state.mounted = true;
  }

  /* ---------------- interactivity ---------------- */
  function bindHovers(mount, D) {
    tip = $("#chartTip");
    // line/area crosshair
    $$(".hit", mount).forEach(function (hit) {
      var id = hit.getAttribute("data-hit");
      var svg = hit.closest("svg");
      hit.addEventListener("mousemove", function (e) {
        var rect = svg.getBoundingClientRect();
        if (id === "chan") {
          var g = GEO.chan;
          var frac = (e.clientX - rect.left) / rect.width * g.W;
          var i = Math.round(clamp((frac - g.L) / g.pw, 0, 1) * (g.n - 1));
          var cx = $("#cx_chan", svg); cx.setAttribute("x1", g.sx(i)); cx.setAttribute("x2", g.sx(i)); cx.style.opacity = 1;
          var rowsH = D.chanKeys.map(function (k, ki) {
            return '<div class="tt-r"><span class="sw" style="background:' + SERIES[ki] + '"></span>' + k + '<b>' + D.channels[k][i] + '</b></div>';
          }).join("");
          showTip('<div class="tt-h">' + (D.labels[i] || ("Day " + (i + 1))) + ' · total ' + g.totals[i] + '</div>' + rowsH, e.clientX, rect.top + 8);
        } else {
          var geo = GEO[id];
          var f = (e.clientX - rect.left) / rect.width * geo.W;
          var idx = Math.round(clamp((f - geo.L) / geo.pw, 0, 1) * (geo.n - 1));
          var cx2 = $("#cx_" + id, svg), cd = $("#cd_" + id, svg);
          cx2.setAttribute("x1", geo.sx(idx)); cx2.setAttribute("x2", geo.sx(idx)); cx2.style.opacity = 1;
          cd.setAttribute("cx", geo.sx(idx)); cd.setAttribute("cy", geo.sy(geo.data[idx])); cd.style.opacity = 1;
          showTip('<div class="tt-h">' + (geo.labels[idx] || ("Day " + (idx + 1))) + '</div><div class="tt-r"><span class="sw" style="background:' + geo.color + '"></span>' + geo.name + '<b>' + geo.fmt(geo.data[idx]) + '</b></div>', e.clientX, rect.top + 8);
        }
      });
      hit.addEventListener("mouseleave", function () {
        hideTip();
        if (id === "chan") { var c = $("#cx_chan", svg); if (c) c.style.opacity = 0; }
        else { var a = $("#cx_" + id, svg), b = $("#cd_" + id, svg); if (a) a.style.opacity = 0; if (b) b.style.opacity = 0; }
      });
    });
    // simple marks (histogram bars, heat cells)
    $$("[data-tip]", mount).forEach(function (m) {
      m.addEventListener("mousemove", function (e) {
        var parts = m.getAttribute("data-tip").split("§");
        showTip('<div class="tt-h">' + parts[0] + '</div><div class="tt-r">' + parts[1] + '</div>', e.clientX, e.clientY - 4);
      });
      m.addEventListener("mouseleave", hideTip);
    });
  }
  function showTip(html, x, y) { if (!tip) return; tip.innerHTML = html; tip.hidden = false; tip.style.left = x + "px"; tip.style.top = y + "px"; }
  function hideTip() { if (tip) tip.hidden = true; }

  /* ---------------- small builders ---------------- */
  function seg(v, lbl) { return '<button data-v="' + v + '">' + lbl + '</button>'; }

  /* ---------------- custom date range ----------------
     The presets answer "how have the last N days gone". A custom window answers
     "what happened around the policy change on the 14th", which is the question
     someone actually opens this screen with. Both inputs are clamped to the
     dataset: offering dates outside it would just draw an empty chart. */
  /* Local components, not toISOString(): the inputs, the labels and the bounds
     all have to name the same day, and UTC formatting shifts it east of GMT. */
  function isoAt(dayIdx) {
    if (!bounds) return '';
    var d = new Date(Date.parse(bounds.minDate + 'T00:00:00') + dayIdx * 86400000);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function dayOfIso(iso) {
    if (!bounds || !iso) return null;
    var d = Math.round((Date.parse(iso + 'T00:00:00') - Date.parse(bounds.minDate + 'T00:00:00')) / 86400000);
    if (isNaN(d)) return null;
    return Math.max(0, Math.min(bounds.days - 1, d));
  }
  function currentWindow() {
    if (state.custom) return state.custom;
    var to = bounds ? bounds.days - 1 : state.range - 1;
    return { from: Math.max(0, to - state.range + 1), to: to };
  }
  function windowLabel() {
    var w = currentWindow();
    if (!state.custom) return state.range + '-day window';
    var f = new Date(Date.parse(isoAt(w.from) + 'T00:00:00'));
    var t = new Date(Date.parse(isoAt(w.to) + 'T00:00:00'));
    var opt = { month: 'short', day: 'numeric' };
    return f.toLocaleDateString(undefined, opt) + ' → ' + t.toLocaleDateString(undefined, opt) +
      ' · ' + state.span + ' days';
  }
  function datePicker() {
    if (!bounds) return '';                 // standalone: presets only
    var w = currentWindow();
    return '<div class="an-dates" id="anDates">' +
      '<input type="date" id="anFrom" value="' + isoAt(w.from) + '" min="' + bounds.minDate + '" max="' + bounds.maxDate + '" aria-label="Range start"/>' +
      '<span class="sep">→</span>' +
      '<input type="date" id="anTo" value="' + isoAt(w.to) + '" min="' + bounds.minDate + '" max="' + bounds.maxDate + '" aria-label="Range end"/>' +
      '<button class="an-date-btn" id="anApply">Apply</button>' +
      (state.custom ? '<button class="an-date-btn" id="anClear">Clear</button>' : '') +
      '</div>';
  }
  function tile(k, v, d, sparkSvg) {
    return '<div class="kpi an-stat"><div class="k">' + k + '</div><div class="v">' + v + '</div>' +
      '<div class="d ' + (d.up ? "up" : "down") + '"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="' +
      (d.up ? "M12 19V5M6 11l6-6 6 6" : "M12 5v14M6 13l6 6 6-6") + '" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      d.txt + '</div>' + sparkSvg + '</div>';
  }
  function panel(title, hint, body, tableId, tableHtml) {
    var actions = "";
    if (tableId && tableHtml) {
      actions = '<div class="ph-actions"><button class="chip-btn" data-table-toggle="' + tableId + '">Table</button></div>';
    }
    var inner;
    if (tableId && tableHtml) {
      inner = '<div id="chartWrap_' + tableId + '">' + body + '</div>' +
              '<div id="tableWrap_' + tableId + '" hidden>' + tableHtml + '</div>';
    } else { inner = body; }
    return '<div class="panel"><div class="panel-head"><h3>' + title + '</h3><span class="hint">' + hint + '</span>' + actions + '</div>' +
           '<div class="panel-body">' + inner + '</div></div>';
  }
  function legend(names, colors, round) {
    return '<div class="legend">' + names.map(function (nm, i) {
      return '<span class="li"><span class="sw ' + (round ? "round" : "") + '" style="background:' + (typeof colors === "function" ? colors(i) : colors[i % colors.length]) + '"></span>' + nm + '</span>';
    }).join("") + '</div>';
  }
  function heatmap(grid) {
    var days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    var s = '<div style="display:grid;grid-template-columns:34px 1fr;gap:6px;align-items:center">';
    // hour axis header
    s += '<div></div><div style="display:grid;grid-template-columns:repeat(12,1fr);gap:3px;font-size:10px;color:var(--text-dim)">';
    for (var h = 0; h < 12; h++) s += '<div style="text-align:center">' + (h * 2) + '</div>';
    s += '</div>';
    grid.forEach(function (row, d) {
      s += '<div style="font-size:11px;color:var(--text-dim)">' + days[d] + '</div>';
      s += '<div class="heat-grid" style="grid-template-columns:repeat(12,1fr)">';
      row.forEach(function (v, h) {
        s += '<div class="heat-cell" style="background:' + heatColor(v) + '" data-tip="' + days[d] + ' ' + (h * 2) + ':00§Sentiment ' + (v >= 0 ? "+" : "") + v.toFixed(2) + '"></div>';
      });
      s += '</div>';
    });
    s += '</div>';
    s += '<div class="heat-scale"><span>−1</span><span class="bar"></span><span>+1</span></div>';
    return s;
  }
  function heatColor(v) {
    // diverging blue(pos) ↔ gray(mid) ↔ red(neg)
    var c;
    if (v >= 0) c = lerpColor(DIV.mid, DIV.pos, v); else c = lerpColor(DIV.mid, DIV.neg, -v);
    return c;
  }
  function lerpColor(a, b, t) {
    var ca = hx(a), cb = hx(b);
    var r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
    var g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
    var bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
    return "rgb(" + r + "," + g + "," + bl + ")";
  }
  function hx(h) { h = h.replace("#", ""); return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)]; }
  function hbars(agents) {
    var max = Math.max.apply(null, agents.map(function (a) { return a.score; }));
    return '<div class="hbars">' + agents.map(function (a, i) {
      var col = i === 0 ? BRAND : i < 3 ? SERIES[0] : SERIES[2];
      return '<div class="hbar-row"><span class="who">' + a.name + '</span>' +
        '<span class="track"><i data-w="' + Math.round(a.score / max * 100) + '" style="width:0;background:' + col + '"></i></span>' +
        '<span class="sc">' + a.score + '</span></div>';
    }).join("") + '</div>';
  }

  /* ---------------- stats ---------------- */
  function avg(a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; }
  function delta(a, invert) {
    var half = Math.floor(a.length / 2);
    var first = avg(a.slice(0, half)), last = avg(a.slice(half));
    var diff = last - first;
    var pct = (diff / first) * 100;
    var up = invert ? diff < 0 : diff > 0;
    return { up: up, txt: (diff >= 0 ? "+" : "") + pct.toFixed(1) + "% vs prior" };
  }

  return {
    render: render,
    /** @param fn (range) => data — range is a day count or {from,to} day indices.
     *  @param b  {days,minDate,maxDate} — enables the custom date picker. */
    setProvider: function (fn, b) { provider = fn; if (b) bounds = b; },
    setBounds: function (b) { bounds = b; },
  };
})();
