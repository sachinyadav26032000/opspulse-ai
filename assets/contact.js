/* ==========================================================================
   OpsPulse — contact form
   --------------------------------------------------------------------------
   The site is static: no build step, no dependencies, no backend. That rules
   out posting to a server of our own, and adding a third-party form endpoint
   would be a dependency decision to escalate rather than one to make quietly.

   So submit composes a message and hands it to the visitor's own mail client.
   The trade-off is honest: nothing is silently swallowed, and the visitor can
   see exactly what is being sent and to whom.

   The failure mode of mailto: is that a browser with no mail client
   configured does nothing at all and gives no feedback. That is why the
   composed message is also shown on the page with a copy button — so the
   submission always has a path, even when the mail client does not open.
   ========================================================================== */
(function () {
  "use strict";

  var form = document.getElementById("contactForm");
  if (!form) return;

  /* chat.js publishes the address so it is written down in exactly one place;
     fall back to the literal only if this page loads the form without it. */
  var TO = window.OPSPULSE_CONTACT_EMAIL || "infohireloop@gmail.com";

  var sent = document.getElementById("cfSent");
  var body = document.getElementById("cfSentBody");
  var copyBtn = document.getElementById("cfCopy");
  var copied = document.getElementById("cfCopied");
  var mailLink = document.getElementById("cfMailAgain");

  function val(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || "").trim() : "";
  }

  function compose() {
    var name = val("cfName");
    var email = val("cfEmail");
    var company = val("cfCompany");
    var book = val("cfBook");
    var msg = val("cfMessage");
    var wantsPartner = document.getElementById("cfPartner");
    var partner = wantsPartner && wantsPartner.checked;

    var subject = (partner ? "Design partner" : "Demo request")
      + ": " + (company || name || "OpsPulse enquiry");

    var lines = [
      "Name:     " + (name || "—"),
      "Email:    " + (email || "—"),
      "Company:  " + (company || "—"),
      "Renewal book: " + (book || "—"),
      "Interested in the design partner programme: " + (partner ? "yes" : "no"),
      "",
      "What's happening now:",
      msg || "—"
    ];

    return { subject: subject, text: lines.join("\n") };
  }

  function mailtoUrl(m) {
    return "mailto:" + TO
      + "?subject=" + encodeURIComponent(m.subject)
      + "&body=" + encodeURIComponent(m.text);
  }

  /* "Apply as a design partner" jumps to the same form as "Schedule a demo",
     so tick the box on the way in — otherwise the visitor has to restate the
     thing they just clicked. */
  Array.prototype.forEach.call(document.querySelectorAll('a[data-partner]'), function (a) {
    a.addEventListener("click", function () {
      var box = document.getElementById("cfPartner");
      if (box) box.checked = true;
    });
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    /* Let the browser's own validation UI handle empty required fields —
       it is already localised and screen-reader aware. */
    if (typeof form.reportValidity === "function" && !form.reportValidity()) return;

    var m = compose();
    var url = mailtoUrl(m);

    if (body) body.textContent = "To: " + TO + "\nSubject: " + m.subject + "\n\n" + m.text;
    if (mailLink) mailLink.href = url;
    if (copied) copied.hidden = true;
    if (sent) {
      sent.hidden = false;
      sent.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    /* Opening the mail client can steal focus or, on a machine with no client,
       do nothing at all — either way the panel above is already showing, so the
       visitor is never left without a next step. */
    window.location.href = url;
  });

  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      var text = body ? body.textContent : "";
      var done = function () {
        if (!copied) return;
        copied.hidden = false;
        setTimeout(function () { copied.hidden = true; }, 2600);
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
      } else {
        fallback(text, done);
      }
    });
  }

  /* execCommand is deprecated but remains the only copy path on a page served
     over plain http, where navigator.clipboard is not exposed — which is
     exactly how this is viewed locally during development. */
  function fallback(text, done) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch (err) { /* nothing else to try */ }
    document.body.removeChild(ta);
  }
})();
