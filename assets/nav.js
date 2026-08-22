/* ==========================================================================
   OpsPulse — compact nav menu
   --------------------------------------------------------------------------
   Below 1180px the section links leave the bar (see "Nav: compact menu" in
   site.css) and arrive here instead. The panel is built by cloning the real
   .nav-links anchors rather than by duplicating them in the markup: three
   pages carry this nav, and a second hand-maintained copy of the link list is
   a guarantee that one page will eventually disagree with the other two.

   It is also why the button lives behind this file. With JS off, .nav-toggle
   is never shown and the panel is never populated, so a visitor gets the old
   behaviour — links hidden, corner CTAs intact — rather than a control that
   opens nothing.
   ========================================================================== */
(function () {
  "use strict";

  var nav = document.querySelector(".nav");
  var toggle = document.getElementById("navToggle");
  var menu = document.getElementById("navMenu");
  var links = nav && nav.querySelector(".nav-links");
  if (!nav || !toggle || !menu || !links) return;

  var inner = menu.querySelector(".nav-menu-inner") || menu;

  /* The panel takes whatever the bar is not currently showing, which is why it
     is rebuilt on every open rather than once at load: the corner sheds "Log
     in" at 720px and then the Ops Floor tab and the demo CTA at 620px, so what
     belongs in here depends on the width at the moment it opens. Reading the
     computed display rather than re-testing the widths keeps all three of
     those breakpoints declared in the stylesheet and nowhere else — a second
     copy in JS is a second thing to forget when one of them moves.

     Rank puts them in the order a visitor wants rather than the order the
     markup happens to use: section links, then the quiet ones, then the CTA. */
  function rank(a) {
    if (a.classList.contains("btn")) return 2;
    if (a.classList.contains("nav-tab")) return 1;
    return 0;
  }

  function build() {
    inner.textContent = "";

    Array.prototype.forEach.call(links.children, function (a) {
      inner.appendChild(a.cloneNode(true));
    });

    var cta = nav.querySelector(".nav-cta");
    var spare = Array.prototype.filter.call(cta.querySelectorAll("a"), function (a) {
      return window.getComputedStyle(a).display === "none";
    });
    spare.sort(function (a, b) { return rank(a) - rank(b); });

    spare.forEach(function (a) {
      var copy = a.cloneNode(true);
      /* A plain text link keeps none of its bar styling — it should read as one
         more row in the list. The tab and the button keep theirs, because the
         panel restyles them rather than replacing them. */
      if (!rank(a)) copy.removeAttribute("class");
      inner.appendChild(copy);
    });
  }

  function isOpen() {
    return toggle.getAttribute("aria-expanded") === "true";
  }

  function open() {
    build();
    menu.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
  }

  function close(refocus) {
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    if (refocus) toggle.focus();
  }

  toggle.addEventListener("click", function () {
    if (isOpen()) close(false);
    else open();
  });

  /* A tap on a link inside the panel is a navigation to an anchor on the same
     page, which does not reload anything — so nothing would close the panel
     and it would still be sitting over the section just scrolled to. */
  inner.addEventListener("click", function (e) {
    if (e.target.closest("a")) close(false);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen()) close(true);
  });

  document.addEventListener("click", function (e) {
    if (!isOpen()) return;
    if (!nav.contains(e.target)) close(false);
  });

  /* Widening past the breakpoint puts the links back in the bar and hides the
     button; leaving the panel open would strand it below a nav that already
     shows everything in it, with no visible control to dismiss it. */
  window.addEventListener("resize", function () {
    if (isOpen() && window.getComputedStyle(toggle).display === "none") close(false);
  }, { passive: true });
})();
