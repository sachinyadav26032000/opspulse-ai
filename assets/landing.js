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
