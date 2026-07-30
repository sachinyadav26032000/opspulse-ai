/* ==========================================================================
   OpsPulse — site assistant
   --------------------------------------------------------------------------
   A scripted assistant that answers what a prospective customer actually asks
   before booking a call. It is deliberately NOT an LLM:

     - there is no backend and no API key on a static site, so a model call
       would have to ship a credential to the browser;
     - `engine/llm.js` is a stub that throws on purpose, because a generated
       number is a fabricated number (see CLAUDE.md §4). A sales chatbot that
       improvises pricing or invents an integration is the same failure mode
       wearing a friendlier hat.

   So: intent matching over a fixed answer set, and an honest "I don't know
   that one" that hands off to a human. That refusal is the most on-brand
   behaviour in the widget — it is the product's own confidence floor, applied
   to its own marketing.

   Injected entirely from JS so every page gets the widget with one <script>
   tag and no duplicated markup.
   ========================================================================== */
(function () {
  "use strict";

  /* ------------------------------------------------------------------
     The one place the contact address is written down. The form in
     index.html reads the same constant, so changing it here changes it
     everywhere the site offers to get in touch.
     ------------------------------------------------------------------ */
  var CONTACT_EMAIL = "infohireloop@gmail.com";
  window.OPSPULSE_CONTACT_EMAIL = CONTACT_EMAIL;

  /* ------------------------------------------------------------------
     Answer set.

     `keys` are matched against the normalised question. A multi-word key
     scores higher than a single word because "how much" is far more
     diagnostic of intent than "how". `weight` lets a rare, unambiguous
     term (e.g. "soc 2") outrank a common one that happens to appear in
     several answers ("data").
     ------------------------------------------------------------------ */
  var INTENTS = [
    {
      id: "what",
      keys: ["what is opspulse", "what do you do", "what is this", "what does it do", "tell me about", "what are you", "explain", "overview"],
      answer:
        "OpsPulse is <strong>renewal intelligence for mid-market SaaS</strong>.\n\n" +
        "It reads the signals your team already generates — support tickets, calls, QA reviews, product usage, billing — and tells you which renewals are in trouble while there is still time to act.\n\n" +
        "For each at-risk account you get three things: <em>which</em> account and when it renews, <em>why</em> it is at risk with the evidence attached, and <em>what to do next</em>.",
      chips: ["How does it work?", "How is this different from a health score?", "What data do you need?"]
    },
    {
      id: "how",
      keys: ["how does it work", "how it works", "how does this work", "under the hood", "technically", "what is the process", "workflow", "mechanism"],
      answer:
        "Five stages, each constrained by the one before it:\n\n" +
        "<strong>1 · Fragmented data</strong> — tickets, calls, QA, usage and billing land on one account timeline.\n" +
        "<strong>2 · AI analysis</strong> — nine statistical detectors compare a recent window against that account's own baseline.\n" +
        "<strong>3 · Reason</strong> — the decline is decomposed into contributing factors that sum to 100%, labelled a hypothesis.\n" +
        "<strong>4 · Action</strong> — a named play with a named owner.\n" +
        "<strong>5 · Revenue impact</strong> — the same signals are re-read at renewal to report whether it worked.\n\n" +
        "The important part: <strong>detection is arithmetic</strong>. The language layer only describes what the arithmetic already found.",
      chips: ["Does it use AI to make up numbers?", "How accurate is it?", "Can I see a demo?"]
    },
    {
      id: "different",
      keys: ["different from", "how is this different", "versus", "vs ", "compare", "competitor", "gainsight", "vitally", "churnzero", "totango", "catalyst", "planhat", "health score", "why not just", "already have", "better than", "alternative"],
      answer:
        "Most customer-success tools give you a <strong>health score</strong> — a red/amber/green dot with no arithmetic behind it. It cannot be argued with, so it gets ignored, and then it turns out to have been right.\n\n" +
        "Three differences:\n\n" +
        "<strong>Every number opens.</strong> Each figure drills back to the records that produced it. Every retrieved quote carries its record id.\n" +
        "<strong>Cause is labelled a hypothesis, not a finding.</strong> Below 60% confidence nothing is auto-actioned — it is held for a human.\n" +
        "<strong>It remembers what you decided.</strong> A ledger snapshots the evidence as it stood, then reports the outcome at renewal — including when the account left anyway.",
      chips: ["What is the decision ledger?", "How accurate is it?", "What does it cost?"]
    },
    {
      id: "data",
      keys: ["what data", "integrations", "integrate", "connect", "sources", "zendesk", "salesforce", "hubspot", "intercom", "freshdesk", "jira", "slack", "connectors", "api", "what do you need from", "plug in", "csv", "import"],
      answer:
        "A <strong>signal source</strong> is one connected system. Typically:\n\n" +
        "• <strong>Ticketing</strong> — Zendesk, Freshdesk, Intercom\n" +
        "• <strong>Telephony</strong> — call records and transcripts\n" +
        "• <strong>QA</strong> — review scores and notes\n" +
        "• <strong>Surveys</strong> — NPS and CSAT with verbatims\n" +
        "• <strong>Product usage</strong> — seats, logins, feature events\n" +
        "• <strong>Billing / CRM</strong> — contract dates and ARR\n\n" +
        "You need roughly <strong>twelve months of history</strong> for a baseline to mean anything. To start, a CSV export is enough — you can drop one into the live demo right now and watch the same detectors run against your data.",
      chips: ["How long does setup take?", "Is my data safe?", "Can I see a demo?"]
    },
    {
      id: "setup",
      keys: ["how long", "setup", "set up", "onboarding", "implementation", "time to value", "get started", "deploy", "install", "how quickly", "ramp"],
      answer:
        "Start with a <strong>CSV export</strong> — no integration work, and you see real findings on your own accounts the same day.\n\n" +
        "A read-only connection to your ticketing system is the next step. Native connectors are on the roadmap; during the design partner programme we build the one you need.\n\n" +
        "There is nothing to install. The product runs in the browser.",
      chips: ["What is the design partner programme?", "What data do you need?", "What does it cost?"]
    },
    {
      id: "pricing",
      keys: ["pricing", "price", "cost", "how much", "expensive", "budget", "per seat", "plans", "tiers", "afford", "quote", "fee", "subscription"],
      answer:
        "Priced on the renewal book, <strong>never per seat</strong> — every plan includes unlimited read-only viewers, because a renewal risk only gets acted on if the CSM, the RevOps lead and the CRO can all open it.\n\n" +
        "<strong>Retain — $1,800/mo</strong> · 3 signal sources, all 9 detectors, 12-month ledger retention\n" +
        "<strong>Forecast — $4,500/mo</strong> · unlimited sources, predictive scoring, 3-year retention, SSO &amp; RBAC\n" +
        "<strong>Enterprise — custom</strong> · residency, private deployment, custom detectors\n\n" +
        "<strong>Design partners pay nothing</strong> for the duration of the partnership.",
      chips: ["What is the design partner programme?", "Is there a contract?", "Schedule a demo"]
    },
    {
      id: "partner",
      keys: ["design partner", "partner programme", "partner program", "pilot", "beta", "early access", "founding customer", "trial", "free"],
      answer:
        "We are building this with <strong>ten mid-market SaaS teams</strong>. Not a waitlist and not a discount scheme.\n\n" +
        "<strong>You get</strong> — the product free through the partnership, detectors tuned to your renewal motion, and direct access to the two people who build it.\n" +
        "<strong>We ask</strong> — an export or read-only connection, an hour a fortnight, and honest reactions. Especially when a finding is wrong: a detector nobody argues with is a detector nobody uses.\n" +
        "<strong>Fit</strong> — $3M–$30M ARR, a renewal book someone owns by name, ~12 months of history in your tools.\n\n" +
        "First step is a thirty-minute call. If the fit is not obvious to both sides in that half hour, we will say so.",
      chips: ["Schedule a demo", "Who is behind this?", "What data do you need?"]
    },
    {
      id: "demo",
      keys: ["demo", "see it", "try it", "test", "play with", "show me", "walkthrough", "walk through", "live", "sandbox", "book a call", "schedule"],
      answer:
        "Two ways, both immediate:\n\n" +
        "<strong>Drive it yourself</strong> — the live demo runs a real detection engine over a simulated operation. A source system on the left, the decision engine on the right, both reading one store so they cannot disagree. No signup, nothing to install, all data simulated.\n\n" +
        "<strong>Talk to us</strong> — thirty minutes, screen shared, your questions rather than our script.",
      chips: ["Schedule a demo", "What is the design partner programme?", "What does it cost?"]
    },
    {
      id: "security",
      keys: ["secure", "security", "safe", "privacy", "gdpr", "soc 2", "soc2", "compliance", "residency", "encryption", "pii", "confidential", "iso 27001", "data protection", "on premise", "on-prem", "self host"],
      answer:
        "Honest answer, because this is exactly the kind of question a vendor should not fudge:\n\n" +
        "<strong>Today</strong> — this is a prototype. Everything you can see on this site runs on <strong>simulated data</strong>. There is no customer data in it.\n\n" +
        "<strong>For design partners</strong> — read-only access, scoped to what the detectors need, and we will sign whatever your security team requires before any data moves.\n\n" +
        "<strong>On the roadmap</strong> — SSO, RBAC and configurable retention are in the Forecast plan; data residency and private deployment are Enterprise. SOC 2 comes with productisation, and we will not claim it before it is real.",
      chips: ["What data do you need?", "Who is behind this?", "Talk to a human"]
    },
    {
      id: "ai",
      keys: ["llm", "gpt", "chatgpt", "claude", "hallucin", "make up", "made up", "invent", "fabricat", "generative", "is this ai", "which model", "does it use ai", "machine learning", "prompt"],
      answer:
        "Deliberately narrow, and this is the core design decision of the product.\n\n" +
        "<strong>Detection, ranking and costing are arithmetic.</strong> No model is involved. A pattern is found because a recent window sits far enough outside a declared baseline, not because something predicted it.\n\n" +
        "<strong>Language only explains.</strong> The narrative layer describes findings that already exist as structured objects. It cannot introduce a number that is not already in the data.\n\n" +
        "That split is enforced in code, not policy. A generated number is a fabricated number — including in this chat window, which is why I am scripted rather than a model.",
      chips: ["How accurate is it?", "What if it is wrong?", "How does it work?"]
    },
    {
      id: "accuracy",
      keys: ["accurate", "accuracy", "confidence", "how do i know", "reliable", "trust", "false positive", "precision", "proof", "evidence", "verify", "certain", "sure"],
      answer:
        "Confidence is <strong>published, not asserted</strong>: 45% statistical strength + 30% explained-by-top-driver + 25% corroboration across signals.\n\n" +
        "Below <strong>60%</strong> an insight is marked held-for-review and never auto-actioned. Nothing is raised at all until it clears a declared threshold you can argue with, and a minimum of 40 recent records exist — so a quiet quarter produces an empty feed rather than invented risk.\n\n" +
        "Root cause is always labelled a <strong>hypothesis</strong>. The system never claims confirmed cause; the CSM who knows the account closes that gap.",
      chips: ["What if it is wrong?", "What is the decision ledger?", "Does it use AI to make up numbers?"]
    },
    {
      id: "wrong",
      keys: ["what if it is wrong", "wrong", "mistake", "miss", "false alarm", "inaccurate", "fails", "error", "bad call", "blame"],
      answer:
        "It will be wrong sometimes, and the product is built so you can <strong>prove</strong> it was.\n\n" +
        "When you commit to a play, the ledger snapshots the risk, the confidence and the account's metrics <em>as they stood at that moment</em>. The evidence is never back-dated. At renewal the same signals are re-read and the outcome is reported — cleared, improving, holding, or worse than when you started.\n\n" +
        "Being able to show the platform was wrong is the property an auditor is actually looking for. A tool that only remembers its wins is a tool you cannot forecast with.",
      chips: ["What is the decision ledger?", "How accurate is it?", "Schedule a demo"]
    },
    {
      id: "ledger",
      keys: ["ledger", "decision ledger", "audit", "record", "history", "track", "outcome", "closed loop", "close the loop"],
      answer:
        "A recommendation is not a decision. A <strong>decision</strong> is a human committing to a play on an account, on stated evidence, at a stated confidence.\n\n" +
        "The ledger records that commitment, then re-reads the same signals on every pass and reports what happened by the renewal date. It flags it if you committed below the confidence floor.\n\n" +
        "That is what turns \"our health score said red\" into a renewal forecast a board will accept.",
      chips: ["What if it is wrong?", "How does it work?", "Can I see a demo?"]
    },
    {
      id: "fit",
      keys: ["right for", "fit", "too small", "too big", "company size", "how many customers", "b2c", "enterprise", "startup", "smb", "mid market", "mid-market", "is this for me", "who is it for", "suitable", "employees", "arr"],
      answer:
        "Built for <strong>mid-market SaaS</strong>, roughly <strong>$3M–$30M ARR</strong>.\n\n" +
        "The shape that matters more than the size: a renewal book someone owns by name, CSMs carrying more accounts than they can read closely, and about twelve months of history in your tools.\n\n" +
        "If you are smaller than that a spreadsheet genuinely is fine, and we will tell you so. If you are much larger the detectors still work, but you likely need the Enterprise conversation about residency and custom thresholds.",
      chips: ["What is the design partner programme?", "What does it cost?", "Schedule a demo"]
    },
    {
      id: "team",
      keys: ["who are you", "who built", "team", "founders", "behind this", "company", "about you", "sachin", "sudharshan", "funding", "investors", "how many people"],
      answer:
        "Two founders.\n\n" +
        "<strong>Sudharshan — Founder &amp; CEO.</strong> Fifteen years across customer operations, customer experience and enterprise SaaS, more recently executive search.\n\n" +
        "<strong>Sachin — Co-founder &amp; CTO.</strong> Enterprise AI, architecture and engineering. Owns the decision engine — the detectors, the confidence floor, and the insight contract that stops anything reaching a screen before it can be traced back to a record.\n\n" +
        "Small on purpose. You will not be handed to an account manager.",
      chips: ["What is the design partner programme?", "Talk to a human", "Can I see a demo?"]
    },
    {
      id: "contract",
      keys: ["contract", "commitment", "lock in", "lock-in", "cancel", "notice period", "annual", "monthly", "terms", "minimum term", "refund"],
      answer:
        "<strong>Design partners</strong> — no contract and no cost. Either side can walk away; we would just ask for the honest reason why.\n\n" +
        "<strong>Paid plans</strong> — monthly, no minimum term. What varies by plan is how long the decision record is retained, because that is what actually costs money to run.\n\n" +
        "Your data stays exportable throughout.",
      chips: ["What does it cost?", "What is the design partner programme?", "Talk to a human"]
    },
    {
      id: "roadmap",
      keys: ["roadmap", "what is next", "coming", "future", "plans", "release", "when will", "timeline", "launch"],
      answer:
        "<strong>Now</strong> — problem validation with renewal owners, sharpening which signals actually predict a non-renewal.\n" +
        "<strong>In progress</strong> — the working engine you can open on this site: statistical detection, decomposed reasoning, exposure as a range.\n" +
        "<strong>Next</strong> — design partner pilots with ten mid-market teams, detectors tuned per renewal motion.\n" +
        "<strong>Then</strong> — native connectors, scalable architecture, launch.\n\n" +
        "There is a full technical roadmap on the site if you want the engineering view.",
      chips: ["What is the design partner programme?", "Can I see a demo?", "Talk to a human"]
    },
    {
      id: "contact",
      keys: ["talk to a human", "human", "contact", "speak to", "get in touch", "reach you", "email", "call", "sales", "someone", "person", "real person"],
      answer:
        "Happy to hand you over — both founders answer everything themselves.\n\n" +
        "Use the <strong>Schedule a demo</strong> form on this page and it reaches us directly. Thirty minutes, screen shared, your questions rather than our script.",
      chips: ["Schedule a demo", "What is the design partner programme?"]
    },
    {
      id: "greeting",
      keys: ["hi", "hello", "hey", "good morning", "good afternoon", "good evening", "yo", "howdy", "greetings"],
      answer:
        "Hello — ask me anything about OpsPulse.\n\nI am a scripted assistant, so I know the product well and nothing else. If I do not have an answer I will say so rather than improvise one.",
      chips: ["What is OpsPulse?", "What does it cost?", "Can I see a demo?"]
    },
    {
      id: "thanks",
      keys: ["thanks", "thank you", "cheers", "appreciate", "helpful", "great", "perfect", "bye", "goodbye", "later"],
      answer: "Any time. If you want to go further, the fastest next step is thirty minutes with one of the founders.",
      chips: ["Schedule a demo", "What is the design partner programme?"]
    }
  ];

  var OPENING = {
    answer:
      "Hello — I can answer questions about OpsPulse: what it does, how it works, pricing, the design partner programme, and what happens to your data.\n\n" +
      "I am scripted rather than an AI model, so if I do not know something I will say so and point you at a human.",
    chips: ["What is OpsPulse?", "How is this different from a health score?", "What does it cost?", "What is the design partner programme?"]
  };

  var FALLBACK_CHIPS = ["What is OpsPulse?", "How does it work?", "What does it cost?", "Talk to a human"];

  /* ------------------------------------------------------------------
     Matching
     ------------------------------------------------------------------ */
  function normalise(s) {
    return " " + String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim() + " ";
  }

  /* A phrase key scores by its word count, so "how much" (2) beats a stray
     "how" (1). Without that weighting almost every question would match
     whichever intent happened to list the most common English words. */
  function score(q, intent) {
    var total = 0;
    for (var i = 0; i < intent.keys.length; i++) {
      var k = normalise(intent.keys[i]).trim();
      if (!k) continue;
      if (q.indexOf(" " + k + " ") !== -1 || q.indexOf(" " + k) !== -1) {
        var words = k.split(" ").length;
        total += words * words;
      }
    }
    return total;
  }

  function findAnswer(text) {
    var q = normalise(text);
    if (q.trim().length < 2) return null;

    var best = null, bestScore = 0;
    for (var i = 0; i < INTENTS.length; i++) {
      var s = score(q, INTENTS[i]);
      if (s > bestScore) { bestScore = s; best = INTENTS[i]; }
    }
    /* A single one-word hit is usually coincidence — "data" appears in half
       the answer set. Require either a multi-word phrase or two separate
       single-word hits before claiming to understand the question. */
    return bestScore >= 2 ? best : null;
  }

  /* ------------------------------------------------------------------
     Markup — built in JS so a page only has to include the script.
     ------------------------------------------------------------------ */
  var root = document.createElement("div");
  root.className = "cw";
  root.innerHTML =
    '<button type="button" class="cw-launch" id="cwLaunch" aria-expanded="false" aria-controls="cwPanel">' +
      '<span class="cw-launch-ico" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>' +
      '</span>' +
      '<span class="cw-launch-x" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>' +
      '</span>' +
      '<span class="cw-launch-label">Ask about OpsPulse</span>' +
    '</button>' +
    '<div class="cw-panel" id="cwPanel" role="dialog" aria-label="Ask about OpsPulse" hidden>' +
      '<div class="cw-head">' +
        '<span class="cw-avatar" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none"><path d="M2 12h4l2.2-6 3.4 12 2.6-8 1.6 4H22" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</span>' +
        '<div class="cw-head-txt">' +
          '<strong>OpsPulse assistant</strong>' +
          '<small>Scripted, not an AI model — it says when it does not know</small>' +
        '</div>' +
        '<button type="button" class="cw-close" id="cwClose" aria-label="Close the assistant">' +
          '<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="cw-log" id="cwLog" role="log" aria-live="polite" aria-relevant="additions"></div>' +
      '<div class="cw-chips" id="cwChips"></div>' +
      '<form class="cw-input" id="cwForm">' +
        '<label class="cw-sr" for="cwText">Ask a question about OpsPulse</label>' +
        '<input id="cwText" type="text" autocomplete="off" placeholder="Ask a question…" />' +
        '<button type="submit" class="cw-send" aria-label="Send">' +
          '<svg viewBox="0 0 24 24" fill="none"><path d="M4 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</button>' +
      '</form>' +
    '</div>';
  document.body.appendChild(root);

  var launch = root.querySelector("#cwLaunch");
  var panel = root.querySelector("#cwPanel");
  var closeBtn = root.querySelector("#cwClose");
  var log = root.querySelector("#cwLog");
  var chipBar = root.querySelector("#cwChips");
  var form = root.querySelector("#cwForm");
  var input = root.querySelector("#cwText");

  var reduceMotion = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };

  /* ------------------------------------------------------------------
     Rendering
     ------------------------------------------------------------------ */
  function bubble(who, html) {
    var row = document.createElement("div");
    row.className = "cw-msg cw-" + who;
    var b = document.createElement("div");
    b.className = "cw-bubble";
    b.innerHTML = html;
    row.appendChild(b);
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    return row;
  }

  /* Answers are authored with \n for paragraph breaks and a small, fixed set
     of inline tags. Escaping first and then re-allowing only <strong> and <em>
     means an answer string can never introduce markup we did not intend — and
     user input never reaches innerHTML at all except through this path. */
  function render(text) {
    var esc = String(text)
      .replace(/&(?!(amp|lt|gt|quot|#\d+);)/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    esc = esc
      .replace(/&lt;strong&gt;/g, "<strong>").replace(/&lt;\/strong&gt;/g, "</strong>")
      .replace(/&lt;em&gt;/g, "<em>").replace(/&lt;\/em&gt;/g, "</em>");
    return esc.split("\n").map(function (line) {
      return line.trim() ? "<p>" + line + "</p>" : "";
    }).join("");
  }

  function setChips(list) {
    chipBar.innerHTML = "";
    (list || []).forEach(function (label) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cw-chip";
      b.textContent = label;
      b.addEventListener("click", function () { submit(label); });
      chipBar.appendChild(b);
    });
  }

  /* A short delay before the reply so the exchange reads as a conversation
     rather than an instant lookup — skipped entirely when the visitor has
     asked for reduced motion, along with the animated dots. */
  function reply(intent) {
    var typing = bubble("bot", '<span class="cw-typing"><i></i><i></i><i></i></span>');
    var wait = reduceMotion.matches ? 0 : 380;
    setTimeout(function () {
      typing.remove();
      if (intent) {
        bubble("bot", render(intent.answer));
        setChips(intent.chips);
      } else {
        bubble("bot", render(
          "I do not have a scripted answer for that one, and I would rather say so than improvise — the product refuses to invent numbers, so its chatbot should not invent answers.\n\n" +
          "Both founders reply personally. Use the <strong>Schedule a demo</strong> form on this page and it reaches them directly."
        ));
        setChips(FALLBACK_CHIPS);
      }
      log.scrollTop = log.scrollHeight;
    }, wait);
  }

  function submit(text) {
    var q = String(text || "").trim();
    if (!q) return;

    /* Two chips are navigation rather than questions — send the visitor to the
       thing itself instead of describing it back to them. */
    if (/^schedule a demo$/i.test(q)) {
      bubble("me", render(q));
      var target = document.getElementById("contact");
      if (target) {
        reply({ answer: "Taking you to the form now — it goes straight to both founders.", chips: ["What is the design partner programme?", "What does it cost?"] });
        setTimeout(function () {
          target.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });
          var name = document.getElementById("cfName");
          if (name) setTimeout(function () { name.focus(); }, reduceMotion.matches ? 0 : 700);
        }, 500);
      } else {
        window.location.href = "index.html#contact";
      }
      return;
    }

    bubble("me", render(q));
    reply(findAnswer(q));
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var v = input.value;
    input.value = "";
    submit(v);
  });

  /* ------------------------------------------------------------------
     Open / close, with focus handled explicitly. A hand-rolled floating
     widget gets none of a <dialog>'s behaviour for free.
     ------------------------------------------------------------------ */
  var started = false;

  function open() {
    panel.hidden = false;
    launch.setAttribute("aria-expanded", "true");
    root.classList.add("cw-open");
    if (!started) {
      started = true;
      bubble("bot", render(OPENING.answer));
      setChips(OPENING.chips);
    }
    /* Wait a frame so the panel is laid out before focus moves into it,
       otherwise some browsers scroll the page to a zero-height element. */
    window.requestAnimationFrame(function () { input.focus(); });
  }

  /* Focus always returns to the launcher rather than to whatever was focused
     before opening. The launcher is a permanent fixture the widget lives
     inside, not a transient trigger — and restoring an arbitrary previous
     element strands a keyboard user on <body> whenever the panel was opened
     from anywhere other than a focused control. */
  function close() {
    panel.hidden = true;
    launch.setAttribute("aria-expanded", "false");
    root.classList.remove("cw-open");
    launch.focus();
  }

  launch.addEventListener("click", function () {
    if (panel.hidden) open(); else close();
  });
  closeBtn.addEventListener("click", close);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !panel.hidden) { e.preventDefault(); close(); }
  });

  /* Any "Schedule a demo" chip inside the widget scrolls to the form; this
     exposes the same entry point to the rest of the page. */
  window.OpsPulseChat = {
    open: open,
    close: close,
    ask: function (q) { if (panel.hidden) open(); submit(q); }
  };
})();
