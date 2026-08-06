/* ==========================================================================
   Rio — the OpsPulse product assistant
   --------------------------------------------------------------------------
   Rio is the product's own expert in a chat window: ask it anything about
   OpsPulse and it answers with the same rigour the product applies to a
   renewal. It is a knowledgeable assistant, but it is deliberately NOT a
   cloud LLM, and that is a feature, not a limitation:

     - there is no backend and no API key on a static site, so a model call
       would have to ship a credential to the browser;
     - `engine/llm.js` is a stub that throws on purpose, because a generated
       number is a fabricated number (see CLAUDE.md §4). A sales chatbot that
       improvises pricing or invents an integration is the same failure mode
       wearing a friendlier hat.

   So Rio runs a small, on-device natural-language layer instead: it
   normalises and tokenises the question, strips filler words, tolerates
   typos, and scores it against a curated knowledge base — phrase intent
   first, then weighted keyword overlap, then a fuzzy fallback for near
   misses. Everything it says is authored and verifiable; nothing is
   generated. When a question falls outside what it genuinely knows it says
   so and hands off to a human — that refusal is the most on-brand behaviour
   in the widget, the product's own confidence floor applied to its own
   marketing.

   Injected entirely from JS so every page gets the widget with one <script>
   tag and no duplicated markup.
   ========================================================================== */
(function () {
  "use strict";

  /* The assistant's name, written down once so the header, launcher, opening
     line and the public API alias all stay in step. */
  var BOT_NAME = "Rio";

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
      keys: ["what is opspulse", "what do you do", "what is this", "what does it do", "tell me about", "what does opspulse", "explain", "overview"],
      answer:
        "OpsPulse is <strong>renewal intelligence for mid-market SaaS</strong>.\n\n" +
        "It reads the signals your team already generates across support tickets, calls, QA reviews, product usage and billing, then tells you which renewals are in trouble while there is still time to act.\n\n" +
        "For each at-risk account you get three things: <em>which</em> account and when it renews, <em>why</em> it is at risk with the evidence attached, and <em>what to do next</em>.",
      chips: ["How does it work?", "How is this different from a health score?", "What data do you need?"]
    },
    {
      id: "how",
      keys: ["how does it work", "how it works", "how does this work", "under the hood", "technically", "what is the process", "workflow", "mechanism"],
      answer:
        "Five stages, each constrained by the one before it:\n\n" +
        "<strong>1 · Fragmented data</strong>: tickets, calls, QA, usage and billing land on one account timeline.\n" +
        "<strong>2 · AI analysis</strong>: nine statistical detectors compare a recent window against that account's own baseline.\n" +
        "<strong>3 · Reason</strong>: the decline is decomposed into contributing factors that sum to 100%, labelled a hypothesis.\n" +
        "<strong>4 · Action</strong>: a named play with a named owner.\n" +
        "<strong>5 · Revenue impact</strong>: the same signals are re-read at renewal to report whether it worked.\n\n" +
        "The important part: <strong>detection is arithmetic</strong>. The language layer only describes what the arithmetic already found.",
      chips: ["Does it use AI to make up numbers?", "How accurate is it?", "Can I see a demo?"]
    },
    {
      id: "different",
      keys: ["different from", "how is this different", "versus", "vs ", "compare", "competitor", "gainsight", "vitally", "churnzero", "totango", "catalyst", "planhat", "health score", "why not just", "already have", "better than", "alternative"],
      answer:
        "Most customer-success tools give you a <strong>health score</strong>: a red/amber/green dot with no arithmetic behind it. It cannot be argued with, so it gets ignored, and then it turns out to have been right.\n\n" +
        "Three differences:\n\n" +
        "<strong>Every number opens.</strong> Each figure drills back to the records that produced it. Every retrieved quote carries its record id.\n" +
        "<strong>Cause is labelled a hypothesis, not a finding.</strong> Below 60% confidence nothing is auto-actioned. It is held for a human.\n" +
        "<strong>It remembers what you decided.</strong> A ledger snapshots the evidence as it stood, then reports the outcome at renewal, including when the account left anyway.",
      chips: ["What is the decision ledger?", "How accurate is it?", "What does it cost?"]
    },
    {
      id: "data",
      keys: ["what data", "integrations", "integrate", "connect", "sources", "zendesk", "salesforce", "hubspot", "intercom", "freshdesk", "jira", "slack", "connectors", "api", "what do you need from", "plug in", "csv", "import"],
      answer:
        "A <strong>signal source</strong> is one connected system. Typically:\n\n" +
        "• <strong>Ticketing</strong>: Zendesk, Freshdesk, Intercom\n" +
        "• <strong>Telephony</strong>: call records and transcripts\n" +
        "• <strong>QA</strong>: review scores and notes\n" +
        "• <strong>Surveys</strong>: NPS and CSAT with verbatims\n" +
        "• <strong>Product usage</strong>: seats, logins, feature events\n" +
        "• <strong>Billing / CRM</strong>: contract dates and ARR\n\n" +
        "You need roughly <strong>twelve months of history</strong> for a baseline to mean anything. To start, a CSV export is enough. You can drop one into the live demo right now and watch the same detectors run against your data.",
      chips: ["How long does setup take?", "Is my data safe?", "Can I see a demo?"]
    },
    {
      id: "setup",
      keys: ["how long", "setup", "set up", "onboarding", "implementation", "time to value", "get started", "deploy", "install", "how quickly", "ramp"],
      answer:
        "Start with a <strong>CSV export</strong>: no integration work, and you see real findings on your own accounts the same day.\n\n" +
        "A read-only connection to your ticketing system is the next step. Native connectors are on the roadmap; during the design partner programme we build the one you need.\n\n" +
        "There is nothing to install. The product runs in the browser.",
      chips: ["What is the design partner programme?", "What data do you need?", "What does it cost?"]
    },
    {
      id: "pricing",
      keys: ["pricing", "price", "cost", "how much", "expensive", "budget", "per seat", "plans", "tiers", "afford", "quote", "fee", "subscription"],
      answer:
        "Priced on the renewal book, <strong>never per seat</strong>. Every plan includes unlimited read-only viewers, because a renewal risk only gets acted on if the CSM, the RevOps lead and the CRO can all open it.\n\n" +
        "<strong>Retain · $1,800/mo</strong> · 3 signal sources, all 9 detectors, 12-month ledger retention\n" +
        "<strong>Forecast · $4,500/mo</strong> · unlimited sources, predictive scoring, 3-year retention, SSO &amp; RBAC\n" +
        "<strong>Enterprise · custom</strong> · residency, private deployment, custom detectors\n\n" +
        "<strong>Design partners pay nothing</strong> for the duration of the partnership.",
      chips: ["What is the design partner programme?", "Is there a contract?", "Schedule a demo"]
    },
    {
      id: "partner",
      keys: ["design partner", "partner programme", "partner program", "pilot", "beta", "early access", "founding customer", "trial", "free"],
      answer:
        "We are building this with <strong>ten mid-market SaaS teams</strong>. Not a waitlist and not a discount scheme.\n\n" +
        "<strong>You get</strong>: the product free through the partnership, detectors tuned to your renewal motion, and direct access to the two people who build it.\n" +
        "<strong>We ask</strong>: an export or read-only connection, an hour a fortnight, and honest reactions. Especially when a finding is wrong: a detector nobody argues with is a detector nobody uses.\n" +
        "<strong>Fit</strong>: $3M–$30M ARR, a renewal book someone owns by name, ~12 months of history in your tools.\n\n" +
        "First step is a thirty-minute call. If the fit is not obvious to both sides in that half hour, we will say so.",
      chips: ["Schedule a demo", "Who is behind this?", "What data do you need?"]
    },
    {
      id: "demo",
      keys: ["demo", "see it", "try it", "test", "play with", "show me", "walkthrough", "walk through", "live", "sandbox", "book a call", "schedule", "upload", "my own data", "try on my data"],
      answer:
        "Three ways, and the first one takes about a minute:\n\n" +
        "<strong>Run it on your own export</strong>: open the Ops Floor, go to Data Upload and drop in a CSV of tickets, QA reviews or NPS responses. Your rows are parsed, mapped onto the account timeline and the nine detectors re-run against them, so the decision feed changes because of your data. It all happens in your browser: nothing is uploaded to a server and nothing is stored.\n\n" +
        "<strong>Drive the simulated operation</strong>: a source system on the left, the decision engine on the right, both reading one store so they cannot disagree. No signup, nothing to install.\n\n" +
        "<strong>Talk to us</strong>: thirty minutes, screen shared, your questions rather than our script.",
      chips: ["Schedule a demo", "What data do you need?", "Is my data safe?"]
    },
    {
      id: "security",
      keys: ["secure", "security", "safe", "privacy", "gdpr", "soc 2", "soc2", "compliance", "residency", "encryption", "pii", "confidential", "iso 27001", "data protection", "on premise", "on-prem", "self host"],
      answer:
        "Honest answer, because this is exactly the kind of question a vendor should not fudge:\n\n" +
        "<strong>Today</strong>: this is a prototype. Everything you can see on this site runs on <strong>simulated data</strong>. There is no customer data in it.\n\n" +
        "<strong>For design partners</strong>: read-only access, scoped to what the detectors need, and we will sign whatever your security team requires before any data moves.\n\n" +
        "<strong>On the roadmap</strong>: SSO, RBAC and configurable retention are in the Forecast plan; data residency and private deployment are Enterprise. SOC 2 comes with productisation, and we will not claim it before it is real.",
      chips: ["What data do you need?", "Who is behind this?", "Talk to a human"]
    },
    {
      id: "ai",
      keys: ["llm", "gpt", "chatgpt", "claude", "hallucin", "make up", "made up", "invent", "fabricat", "generative", "is this ai", "which model", "does it use ai", "machine learning", "prompt"],
      answer:
        "Deliberately narrow, and this is the core design decision of the product.\n\n" +
        "<strong>Detection, ranking and costing are arithmetic.</strong> No model is involved. A pattern is found because a recent window sits far enough outside a declared baseline, not because something predicted it.\n\n" +
        "<strong>Language only explains.</strong> The narrative layer describes findings that already exist as structured objects. It cannot introduce a number that is not already in the data.\n\n" +
        "That split is enforced in code, not policy. A generated number is a fabricated number, including in this chat window, which is why I, Rio, match your question against authored answers rather than improvising with a model.",
      chips: ["How accurate is it?", "What if it is wrong?", "How does it work?"]
    },
    {
      id: "accuracy",
      keys: ["accurate", "accuracy", "confidence", "how do i know", "reliable", "trust", "false positive", "precision", "proof", "evidence", "verify", "certain", "sure"],
      answer:
        "Confidence is <strong>published, not asserted</strong>: 45% statistical strength + 30% explained-by-top-driver + 25% corroboration across signals.\n\n" +
        "Below <strong>60%</strong> an insight is marked held-for-review and never auto-actioned. Nothing is raised at all until it clears a declared threshold you can argue with, and a minimum of 40 recent records exist, so a quiet quarter produces an empty feed rather than invented risk.\n\n" +
        "Root cause is always labelled a <strong>hypothesis</strong>. The system never claims confirmed cause; the CSM who knows the account closes that gap.",
      chips: ["What if it is wrong?", "What is the decision ledger?", "Does it use AI to make up numbers?"]
    },
    {
      id: "wrong",
      keys: ["what if it is wrong", "wrong", "mistake", "miss", "false alarm", "inaccurate", "fails", "error", "bad call", "blame"],
      answer:
        "It will be wrong sometimes, and the product is built so you can <strong>prove</strong> it was.\n\n" +
        "When you commit to a play, the ledger snapshots the risk, the confidence and the account's metrics <em>as they stood at that moment</em>. The evidence is never back-dated. At renewal the same signals are re-read and the outcome is reported: cleared, improving, holding, or worse than when you started.\n\n" +
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
      keys: ["who built", "who made", "who is behind", "team", "founders", "behind this", "the company", "about you", "sachin", "sudharshan", "funding", "investors", "how many people"],
      answer:
        "Two founders.\n\n" +
        "<strong>Sudharshan, Founder &amp; CEO.</strong> Fifteen years across customer operations, customer experience and enterprise SaaS, more recently executive search.\n\n" +
        "<strong>Sachin, Co-founder &amp; CTO.</strong> Enterprise AI, architecture and engineering. Owns the decision engine: the detectors, the confidence floor, and the insight contract that stops anything reaching a screen before it can be traced back to a record.\n\n" +
        "Small on purpose. You will not be handed to an account manager.",
      chips: ["What is the design partner programme?", "Talk to a human", "Can I see a demo?"]
    },
    {
      id: "contract",
      keys: ["contract", "commitment", "lock in", "lock-in", "cancel", "notice period", "annual", "monthly", "terms", "minimum term", "refund"],
      answer:
        "<strong>Design partners</strong>: no contract and no cost. Either side can walk away; we would just ask for the honest reason why.\n\n" +
        "<strong>Paid plans</strong>: monthly, no minimum term. What varies by plan is how long the decision record is retained, because that is what actually costs money to run.\n\n" +
        "Your data stays exportable throughout.",
      chips: ["What does it cost?", "What is the design partner programme?", "Talk to a human"]
    },
    {
      id: "roadmap",
      keys: ["roadmap", "what is next", "coming", "future", "plans", "release", "when will", "timeline", "launch"],
      answer:
        "<strong>Now</strong>: problem validation with renewal owners, sharpening which signals actually predict a non-renewal.\n" +
        "<strong>In progress</strong>: the working engine you can open on this site: statistical detection, decomposed reasoning, exposure as a range.\n" +
        "<strong>Next</strong>: design partner pilots with ten mid-market teams, detectors tuned per renewal motion.\n" +
        "<strong>Then</strong>: native connectors, scalable architecture, launch.\n\n" +
        "There is a full technical roadmap on the site if you want the engineering view.",
      chips: ["What is the design partner programme?", "Can I see a demo?", "Talk to a human"]
    },
    {
      id: "contact",
      keys: ["talk to a human", "human", "contact", "speak to", "get in touch", "reach you", "email", "call", "sales", "someone", "person", "real person"],
      answer:
        "Happy to hand you over. Both founders answer everything themselves.\n\n" +
        "Use the <strong>Schedule a demo</strong> form on this page and it reaches us directly. Thirty minutes, screen shared, your questions rather than our script.",
      chips: ["Schedule a demo", "What is the design partner programme?"]
    },
    {
      id: "identity",
      keys: ["who are you", "what are you", "your name", "what is your name", "are you a bot", "are you human", "are you real", "are you a robot", "rio", "rioai", "rio ai", "what can you do", "how do you work", "are you an ai", "are you chatgpt", "what model are you"],
      answer:
        "I am <strong>Rio</strong>, the OpsPulse product assistant. Think of me as the product's own expert on call.\n\n" +
        "Under the hood I run a small natural-language layer right here in your browser: I normalise your question, strip the filler words, forgive a typo or two, and match what you actually mean against a curated knowledge base of everything OpsPulse, then I answer from authored, verifiable copy.\n\n" +
        "I am not a cloud LLM, and that is deliberate: OpsPulse refuses to generate numbers it cannot trace, so its assistant refuses to generate answers it cannot stand behind. Ask me anything about the product.",
      chips: ["What is OpsPulse?", "How does it work?", "Does it use AI to make up numbers?"]
    },
    {
      id: "greeting",
      keys: ["hi", "hello", "hey", "good morning", "good afternoon", "good evening", "yo", "howdy", "greetings", "hiya", "sup"],
      answer:
        "Hi, I am <strong>Rio</strong>, the OpsPulse product expert. Ask me anything: what it does, how the engine reaches a verdict, pricing, integrations, security, or the design partner programme.\n\n" +
        "I read your question with a small on-device language model rather than a cloud LLM, so every answer is authored and verifiable, and if I genuinely do not know something, I will say so and point you at a human instead of guessing.",
      chips: ["What is OpsPulse?", "How does it work?", "What does it cost?"]
    },
    {
      id: "thanks",
      keys: ["thanks", "thank you", "cheers", "appreciate", "helpful", "great", "perfect", "awesome", "nice", "cool", "bye", "goodbye", "later"],
      answer: "Any time. That is what I am here for. If you want to go further, the fastest next step is thirty minutes with one of the founders.",
      chips: ["Schedule a demo", "What is the design partner programme?"]
    }
  ];

  var OPENING = {
    answer:
      "Hi, I am <strong>Rio</strong> 👋, the product expert for OpsPulse. I can walk you through what it does, how the decision engine reaches a verdict, pricing, integrations, security, and the design partner programme.\n\n" +
      "Ask in your own words. I understand full questions, not just keywords. And because I run on the product's own honesty rule, I never invent an answer: if I do not know, I will say so and hand you to a human.",
    chips: ["What is OpsPulse?", "How is this different from a health score?", "What does it cost?", "What is the design partner programme?"]
  };

  var FALLBACK_CHIPS = ["What is OpsPulse?", "How does it work?", "What does it cost?", "Talk to a human"];

  /* ==================================================================
     The natural-language layer
     ------------------------------------------------------------------
     This is what lets Rio read a real question rather than demand an
     exact keyword. It is intentionally small and explainable — no model,
     no network — but it does the things an NLP front end does: it lowers
     and strips punctuation, drops filler words that carry no intent,
     forgives a typo, and scores meaning three ways:

       1 · phrase intent   — a multi-word key found verbatim is the
                             strongest signal ("how much" ≫ a stray "how").
       2 · keyword overlap  — distinctive words shared with an intent, each
                             weighted so a rare, diagnostic term ("soc 2")
                             counts for more than a common one.
       3 · fuzzy fallback   — a near-miss token ("pricin", "intergrate") is
                             still counted, at a discount, so a slip of the
                             finger does not drop the visitor to a dead end.

     The acceptance bar stays deliberately high: below it Rio says it
     does not know rather than answer the wrong question confidently. That
     is the product's confidence floor, applied to its own chat window.
     ================================================================== */

  /* Words that appear in almost every question and so carry no intent. Kept
     out of the keyword vocabulary on both sides — the visitor's tokens and
     the intent's — so matching turns on the words that actually distinguish
     one topic from another. */
  var STOPWORDS = {
    the:1, a:1, an:1, and:1, or:1, of:1, to:1, in:1, on:1, at:1, for:1, with:1,
    is:1, are:1, was:1, be:1, been:1, do:1, does:1, did:1, can:1, could:1,
    would:1, should:1, will:1, i:1, you:1, we:1, they:1, it:1, this:1,
    that:1, my:1, your:1, our:1, me:1, us:1, as:1, if:1, so:1, but:1, from:1,
    about:1, into:1, up:1, out:1, please:1, just:1, tell:1, give:1, some:1,
    any:1, there:1, here:1, use:1, using:1, get:1, got:1, make:1, made:1,
    need:1, want:1, know:1, see:1, thing:1, things:1, really:1, actually:1
  };

  function tokenise(s) {
    var raw = String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var t = raw[i];
      if (t && t.length > 1 && !STOPWORDS[t]) out.push(t);
    }
    return out;
  }

  /* Padded, single-spaced form so a multi-word phrase can be found on word
     boundaries with a plain indexOf. */
  function normalise(s) {
    return " " + String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim() + " ";
  }

  /* Are two tokens within one edit (insert / delete / substitute)? A cheap
     bounded check — enough to catch a single fat-fingered character without
     matching genuinely different words. Only run on longer tokens, where an
     accidental slip is far more likely than a real different short word. */
  function near(a, b) {
    if (a === b) return true;
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    var i = 0, j = 0, edits = 0;
    while (i < la && j < lb) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (la > lb) i++;             /* deletion from a */
      else if (lb > la) j++;        /* insertion into a */
      else { i++; j++; }            /* substitution */
    }
    if (i < la || j < lb) edits++;  /* trailing extra character */
    return edits <= 1;
  }

  /* Precompute, once, each intent's phrase list and its distinctive keyword
     vocabulary. Deriving the vocabulary from the same keys the phrases come
     from means there is still one place to edit an intent's triggers. */
  INTENTS.forEach(function (intent) {
    var phrases = [];
    var terms = {};
    intent.keys.forEach(function (key) {
      var words = normalise(key).trim().split(" ");
      if (words.length > 1) phrases.push(" " + words.join(" ") + " ");
      tokenise(key).forEach(function (t) { terms[t] = 1; });
    });
    intent._phrases = phrases;
    intent._terms = Object.keys(terms);
  });

  function scoreIntent(qNorm, qTokens, intent) {
    var total = 0, tokenScore = 0, phraseHit = false;

    /* 1 · phrase intent — dominant, because a whole phrase found verbatim is
       far more diagnostic than the words that make it up appearing loose. */
    for (var p = 0; p < intent._phrases.length; p++) {
      if (qNorm.indexOf(intent._phrases[p]) !== -1) {
        var w = intent._phrases[p].trim().split(" ").length;
        total += w * w * 3;
        phraseHit = true;
      }
    }

    /* 2 & 3 · keyword overlap, exact then fuzzy. Each visitor token scores at
       most once, against its best match, so a repeated word cannot stack. */
    for (var i = 0; i < qTokens.length; i++) {
      var qt = qTokens[i], best = 0;
      for (var j = 0; j < intent._terms.length; j++) {
        var term = intent._terms[j];
        if (qt === term) { best = 2; break; }
        /* A near-miss on a long, distinctive word ("pricin", "securty") is
           almost certainly a typo, so it counts full; a near-miss on a short
           word could easily be a genuinely different word, so it counts half. */
        if (best < 2 && qt.length >= 5 && term.length >= 5 && near(qt, term)) {
          best = Math.min(qt.length, term.length) >= 6 ? 2 : 1;
        }
      }
      tokenScore += best;
    }
    total += tokenScore;

    return { total: total, tokenScore: tokenScore, phraseHit: phraseHit };
  }

  function findAnswer(text) {
    var qNorm = normalise(text);
    if (qNorm.trim().length < 2) return null;
    var qTokens = tokenise(text);

    var best = null, bestScore = 0, bestS = null;
    for (var i = 0; i < INTENTS.length; i++) {
      var s = scoreIntent(qNorm, qTokens, INTENTS[i]);
      if (s.total > bestScore) { bestScore = s.total; best = INTENTS[i]; bestS = s; }
    }

    /* Confidence floor: answer only on a real phrase hit or on enough keyword
       weight (one distinctive exact word, or two softer signals). A lone
       fuzzy guess is not enough — below the bar Rio says it does not know
       rather than answer the wrong question. */
    if (bestS && (bestS.phraseHit || bestS.tokenScore >= 2)) return best;
    return null;
  }

  /* ------------------------------------------------------------------
     Markup — built in JS so a page only has to include the script.
     ------------------------------------------------------------------ */
  var root = document.createElement("div");
  root.className = "cw cw-new";
  /* A shield with an inner spark — a small "product superhero" mark that
     still reads as a single glyph at 20px. Reused in the launcher and the
     panel header so the two are visibly the same character. */
  var RIO_MARK =
    '<svg viewBox="0 0 24 24" fill="none">' +
      '<path d="M12 2.5 20 5.2v6.1c0 4.6-3.2 8-8 10.2-4.8-2.2-8-5.6-8-10.2V5.2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
      '<path d="M12.8 7.3 9 12.7h2.7l-.6 4 3.9-5.5h-2.7Z" fill="currentColor"/>' +
    '</svg>';

  root.innerHTML =
    '<button type="button" class="cw-launch" id="cwLaunch" aria-expanded="false" aria-controls="cwPanel">' +
      '<span class="cw-launch-ico" aria-hidden="true">' + RIO_MARK + '</span>' +
      '<span class="cw-launch-x" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>' +
      '</span>' +
      '<span class="cw-launch-label">Ask ' + BOT_NAME + '</span>' +
      /* Purely decorative attention dot, dropped for good the first time the
         panel is opened — a badge that reappears would be a lie about unread
         messages, since nothing arrives unprompted. */
      '<span class="cw-ping" aria-hidden="true"></span>' +
    '</button>' +
    '<div class="cw-panel" id="cwPanel" role="dialog" aria-label="' + BOT_NAME + ', the OpsPulse product assistant" hidden>' +
      '<div class="cw-head">' +
        '<span class="cw-avatar" aria-hidden="true">' + RIO_MARK + '</span>' +
        '<div class="cw-head-txt">' +
          '<strong>' + BOT_NAME + '</strong>' +
          '<small><span class="cw-dot" aria-hidden="true"></span>OpsPulse product expert · always honest</small>' +
        '</div>' +
        '<button type="button" class="cw-close" id="cwClose" aria-label="Close ' + BOT_NAME + '">' +
          '<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="cw-log" id="cwLog" role="log" aria-live="polite" aria-relevant="additions"></div>' +
      '<div class="cw-chips" id="cwChips"></div>' +
      '<form class="cw-input" id="cwForm">' +
        '<label class="cw-sr" for="cwText">Ask ' + BOT_NAME + ' a question about OpsPulse</label>' +
        '<input id="cwText" type="text" autocomplete="off" placeholder="Ask ' + BOT_NAME + ' anything…" />' +
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
    /* Rio's own turns carry the little mark, so a long thread still
       reads at a glance as a conversation with a named assistant rather than
       an anonymous stack of grey boxes. The visitor's turns do not. */
    if (who === "bot") {
      var ava = document.createElement("span");
      ava.className = "cw-msg-ava";
      ava.setAttribute("aria-hidden", "true");
      ava.innerHTML = RIO_MARK;
      row.appendChild(ava);
    }
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

    /* Consecutive "• " lines become a real bullet list, so an answer that
       enumerates signal sources or plans reads as a list rather than a stack
       of loose paragraphs. Everything else stays a paragraph. */
    var out = [], list = null;
    esc.split("\n").forEach(function (line) {
      var t = line.trim();
      if (!t) return;
      var bullet = t.indexOf("•") === 0;
      if (bullet) {
        if (!list) list = [];
        list.push("<li>" + t.replace(/^•\s*/, "") + "</li>");
      } else {
        if (list) { out.push('<ul class="cw-list">' + list.join("") + "</ul>"); list = null; }
        out.push("<p>" + t + "</p>");
      }
    });
    if (list) out.push('<ul class="cw-list">' + list.join("") + "</ul>");
    return out.join("");
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
          "That one is outside what I can answer with confidence, and I would rather tell you than guess. OpsPulse refuses to invent numbers, so Rio refuses to invent answers.\n\n" +
          "Both founders reply personally, though. Use the <strong>Schedule a demo</strong> form on this page and your question reaches them directly."
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
        reply({ answer: "Taking you to the form now. It goes straight to both founders.", chips: ["What is the design partner programme?", "What does it cost?"] });
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
    root.classList.remove("cw-new");
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
  /* Rio is the assistant's public name, so the rest of the page can open it
     or ask it a question under that name too. Same object, friendlier alias.
     `RioAI` was the name before the rename and is kept pointing at the same
     object, because a stale caller failing silently is worse than one extra
     line here. */
  window.Rio = window.OpsPulseChat;
  window.RioAI = window.OpsPulseChat;
})();
