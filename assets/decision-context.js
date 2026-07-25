/* ==========================================================================
   Decision context for the Operational Workspace (app.html)
   --------------------------------------------------------------------------
   The workspace is where you INVESTIGATE a decision, not where you find one.
   That distinction is the whole point of the journey:

     Executive Brief → select a decision → workspace → investigate → act

   app.js owns this page's dashboard and its own data, and is deliberately left
   alone. This script only adds the frame around it: a banner saying which
   decision you are here for, and the way back with that decision still in hand.

   Arriving with no decision context is legitimate — someone may open the
   workspace directly to browse. In that case we say so plainly and point at
   the brief, rather than pretending a decision is in flight.
   ========================================================================== */
(function () {
  "use strict";

  var q = new URLSearchParams(window.location.search);
  var signal = q.get("signal");
  var host = document.getElementById("decisionContext");
  if (!host) return;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ── No decision in context: browsing mode ── */
  if (!signal) {
    host.className = "dctx dctx-idle";
    host.innerHTML =
      '<div class="dctx-main">' +
        '<div class="dctx-kicker">Operational workspace</div>' +
        '<div class="dctx-title">No decision in context — you are browsing.</div>' +
        '<p class="dctx-sub">This workspace exists to investigate a decision, not to find one. ' +
        'The Executive Brief ranks what actually needs deciding today; open one from there and it arrives here with its evidence.</p>' +
      '</div>' +
      '<div class="dctx-acts"><a class="dctx-btn primary" href="opspulse.html">Open the Executive Brief →</a></div>';
    return;
  }

  /* ── A decision is in context ── */
  var band = (q.get("band") || "medium").toLowerCase();
  var title = q.get("t") || "Decision";
  var metric = q.get("metric") || "";
  var sev = q.get("sev") || "—";
  var conf = q.get("conf") || "—";
  var owner = q.get("owner") || "unassigned";
  var pb = q.get("pb") || "—";
  var money = q.get("money") || "Not costed";
  var act = q.get("act") || "";

  host.className = "dctx dctx-" + (["critical", "high", "medium"].indexOf(band) >= 0 ? band : "medium");
  host.innerHTML =
    '<div class="dctx-main">' +
      '<div class="dctx-kicker"><span class="dctx-dot"></span>Investigating · ' + esc(band) + ' severity</div>' +
      '<div class="dctx-title">' + esc(title) + '</div>' +
      (metric ? '<p class="dctx-sub">' + esc(metric) + '</p>' : "") +
      (act ? '<p class="dctx-act"><span class="ar">↳</span>' + esc(act) + "</p>" : "") +
      '<div class="dctx-facts">' +
        '<span><b>' + esc(sev) + "</b> severity</span>" +
        '<span><b>' + esc(conf) + "%</b> confidence at brief</span>" +
        '<span><b>' + esc(money) + "</b> at stake</span>" +
        "<span>owner <b>" + esc(owner) + "</b></span>" +
        "<span>playbook <b>" + esc(pb) + "</b></span>" +
      "</div>" +
    "</div>" +
    '<div class="dctx-acts">' +
      '<a class="dctx-btn primary" href="opspulse.html?decide=' + encodeURIComponent(signal) + '">Take action on this decision →</a>' +
      '<a class="dctx-btn" href="opspulse.html">← Back to the Executive Brief</a>' +
      '<p class="dctx-note">Investigating does not commit anything. The decision is recorded only when you commit it in the brief.</p>' +
    "</div>";
})();
