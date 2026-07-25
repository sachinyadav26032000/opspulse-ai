/* OpsPulse — landing page micro-interactions */
(function () {
  "use strict";

  /* Reveal on scroll */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });

  document.querySelectorAll(".reveal").forEach(function (el, i) {
    el.style.transitionDelay = (Math.min(i % 5, 4) * 60) + "ms";
    io.observe(el);
  });

  /* Animated pulse line in hero mock */
  var line = document.getElementById("pulseLine");
  if (line) {
    var t = 0;
    setInterval(function () {
      t += 1;
      var pts = [];
      for (var x = 0; x <= 320; x += 8) {
        var base = 30;
        var wave = Math.sin((x * 0.09) + t * 0.35) * 4;
        // occasional spikes to feel "live"
        var spike = 0;
        var phase = (x + t * 8) % 96;
        if (phase < 6) spike = -18;
        else if (phase >= 6 && phase < 12) spike = 14;
        pts.push(x + "," + (base + wave + spike).toFixed(1));
      }
      line.setAttribute("points", pts.join(" "));
    }, 120);
  }

  /* Small live jitter on hero KPIs */
  var health = document.getElementById("hHealth");
  var csat = document.getElementById("hCsat");
  if (health && csat) {
    setInterval(function () {
      var h = 80 + Math.floor(Math.random() * 5);
      health.textContent = h;
      var c = (3.4 + Math.random() * 1.6).toFixed(1);
      csat.textContent = "−4." + c.split(".")[1] + "%";
      csat.textContent = "−" + c + "%";
    }, 2600);
  }

  /* Nav shadow on scroll */
  var nav = document.querySelector(".nav");
  window.addEventListener("scroll", function () {
    if (window.scrollY > 8) nav.style.boxShadow = "0 10px 30px -18px rgba(0,0,0,.8)";
    else nav.style.boxShadow = "none";
  }, { passive: true });
})();

/* ==========================================================================
   Product layers — expand in place
   --------------------------------------------------------------------------
   The panel is a sibling of the cards inside the same grid, promoted to
   `grid-column: 1 / -1`. On open it is moved to sit directly after the LAST
   card in the clicked card's row, so it spans the row and pushes everything
   below it down rather than being squeezed into one column.

   Rows are derived by comparing offsetTop rather than from a hardcoded column
   count, so this holds at 4 columns, 2 columns and 1 column without knowing
   where the breakpoints are. At one column a row is a single card, which is
   exactly the mobile behaviour we want, for free.
   ========================================================================== */
(function () {
  "use strict";

  var grid = document.getElementById("layerGrid");
  if (!grid) return;

  var cards = Array.prototype.slice.call(grid.querySelectorAll(".layer-card"));
  if (!cards.length) return;

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var openCard = null;

  function panelFor(card) {
    return document.getElementById(card.getAttribute("aria-controls"));
  }

  /* Run `fn` once, on transitionend or on a timeout — whichever lands first.
     transitionend is not guaranteed: an interrupted transition, a display:none
     ancestor, or a background tab can all swallow it, and without the fallback
     the panel would be stranded mid-open with its cleanup never applied. */
  var TRANSITION_MS = 200;
  function afterTransition(panel, fn) {
    var done = false;
    var finish = function () {
      if (done) return;
      done = true;
      panel.removeEventListener("transitionend", onEnd);
      clearTimeout(timer);
      fn();
    };
    var onEnd = function (e) { if (e.target === panel && e.propertyName === "height") finish(); };
    var timer = setTimeout(finish, TRANSITION_MS + 60);
    panel.addEventListener("transitionend", onEnd);
    return finish;
  }

  /* Measure with every panel out of flow — an open panel wraps the cards after
     it onto new rows, which would corrupt the row grouping. */
  function lastCardInRowOf(card) {
    var open = openCard ? panelFor(openCard) : null;
    var wasHidden = open ? open.hidden : null;
    if (open) open.hidden = true;

    var top = card.offsetTop;
    var last = card;
    cards.forEach(function (c) {
      if (Math.abs(c.offsetTop - top) < 2 && c.offsetLeft >= last.offsetLeft) last = c;
    });

    if (open) open.hidden = wasHidden;
    return last;
  }

  function place(card) {
    var panel = panelFor(card);
    var last = lastCardInRowOf(card);
    if (panel.previousElementSibling !== last) {
      grid.insertBefore(panel, last.nextSibling);
    }
    return panel;
  }

  function openPanel(card) {
    var panel = place(card);
    card.setAttribute("aria-expanded", "true");
    panel.hidden = false;
    openCard = card;

    if (reduceMotion.matches) {
      panel.style.height = "auto";
      panel.classList.add("open");
      return;
    }

    panel.style.height = "0px";
    void panel.offsetHeight;                 // flush, so the transition has a start value
    panel.classList.add("open");
    panel.style.height = panel.scrollHeight + "px";

    // Let it reflow with the viewport once the animation has landed.
    panel._settle = afterTransition(panel, function () {
      if (openCard === card) panel.style.height = "auto";
    });
  }

  function closePanel(card, animate) {
    var panel = panelFor(card);
    card.setAttribute("aria-expanded", "false");
    openCard = null;

    // A pending open-settle would otherwise fire mid-close and fight us.
    if (panel._settle) { panel._settle(); panel._settle = null; }

    if (!animate || reduceMotion.matches) {
      panel.hidden = true;
      panel.style.height = "";
      panel.classList.remove("open");
      return;
    }

    panel.style.height = panel.scrollHeight + "px";
    void panel.offsetHeight;
    panel.classList.remove("open");
    panel.style.height = "0px";

    afterTransition(panel, function () {
      // Only tidy up if it has not been reopened in the meantime.
      if (card.getAttribute("aria-expanded") === "true") return;
      panel.hidden = true;
      panel.style.height = "";
    });
  }

  cards.forEach(function (card) {
    // A real <button>, so Enter and Space arrive here as clicks for free.
    card.addEventListener("click", function () {
      if (openCard === card) { closePanel(card, true); return; }
      // Close the outgoing one without animating: the incoming panel has to be
      // measured against a clean layout, and a half-collapsed panel would skew it.
      if (openCard) closePanel(openCard, false);
      openPanel(card);
    });
  });

  var resizeTimer;
  window.addEventListener("resize", function () {
    if (!openCard) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (!openCard) return;
      place(openCard);
      var panel = panelFor(openCard);
      if (panel.style.height && panel.style.height !== "auto") panel.style.height = "auto";
    }, 120);
  }, { passive: true });
})();
