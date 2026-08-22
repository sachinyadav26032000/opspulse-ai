/* ==========================================================================
   Rio — the OpsPulse product expert
   --------------------------------------------------------------------------
   Rio answers anything a visitor wants to know about OpsPulse, and can teach
   the product from first principles to the commercial conversation. It is a
   knowledgeable assistant, but it is deliberately NOT a cloud LLM, and that is
   a feature rather than a limitation:

     - there is no backend on a static site, so a model call would have to ship
       an API key to the browser, where any visitor can read it and spend it;
     - `engine/llm.js` is a stub that throws on purpose, because a generated
       number is a fabricated number (see CLAUDE.md §4). A sales chatbot that
       improvises pricing or invents an integration is that same failure mode
       wearing a friendlier hat, and this product is sold on not doing it.

   So Rio runs a small natural-language layer on the visitor's own device: it
   normalises and tokenises the question, expands synonyms, stems, forgives a
   typo, and scores the result against a curated knowledge base — phrase intent
   first, then weighted keyword overlap, then a fuzzy pass for near misses.
   Everything it says is authored and verifiable; nothing is generated.

   Four things make it feel like a conversation rather than a lookup:

     1 · BREADTH. The knowledge base teaches the whole product — the problem,
         the nine detectors and their thresholds, confidence, costing, the
         ledger, every screen, the demo, pricing, security, the roadmap — so
         very few honest questions land outside it.
     2 · A COURSE. "Teach me" walks eight ordered lessons, start to end, with
         the visitor saying "next" to advance.
     3 · CONTEXT. "Why?", "tell me more", "so what" are resolved against the
         previous answer, so follow-ups work the way people actually ask them.
     4 · A GRACEFUL LADDER instead of a wall. A near miss offers the closest
         topics by name; a general-knowledge question gets told plainly that
         Rio is a product expert, not a general assistant; a question about
         source code, credentials or internals is declined on principle. Only
         then does it hand off to a human.

   WHAT RIO WILL NOT SAY is as deliberate as what it will. Everything the
   product publishes about itself — detector thresholds, the confidence
   formula, the refusal list — is fair game, because publishing those IS the
   pitch. Implementation, source code, repository layout, infrastructure,
   credentials and anything about a customer's data are not, and the guardrail
   intents at the end of the knowledge base decline them by name.

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

  /* ==================================================================
     THE KNOWLEDGE BASE
     ------------------------------------------------------------------
     Each entry is one thing a visitor might want to know.

       id      stable handle, used by the course and by the test harness.
       title   how the topic is named back to the visitor when Rio is not
               certain it understood ("the closest I have is <title>").
               Written to slot into that sentence, so it is a noun phrase.
       keys    matched against the normalised question. A multi-word key
               scores far higher than a single word, because "how much" is
               vastly more diagnostic of intent than "how".
       answer  authored copy. \n separates paragraphs, "• " starts a list
               item, and only <strong> and <em> are honoured as markup.
       more    the deeper cut, served when the visitor follows up with
               "why?", "tell me more", "go on". Optional: where it is absent
               the follow-up falls through to ordinary matching, which is a
               better outcome than padding every topic with filler.
       hidden  keep this topic out of the near-miss suggestions. Set on the
               guardrails and the conversational furniture — offering "the
               greeting" as a thing to ask about would be absurd.

     ORDER DOES NOT MATTER to the scorer; it reads best grouped by subject,
     so it is grouped by subject.
     ================================================================== */
  var INTENTS = [

    /* ---------- Orientation ---------- */
    {
      id: "what",
      title: "what OpsPulse is",
      keys: ["what is opspulse", "what do you do", "what is this", "in it for me", "what do i get", "what does it do", "what does opspulse", "tell me about the product", "tell me about opspulse", "about the product", "elevator pitch", "in a nutshell", "summarise", "summarize", "what is the product"],
      answer:
        "OpsPulse is <strong>renewal intelligence for mid-market SaaS</strong>.\n\n" +
        "It reads the signals your team already generates — support tickets, calls, QA reviews, product usage, billing — and tells you which renewals are in trouble while there is still time to act.\n\n" +
        "For each at-risk account you get three things: <em>which</em> account and when it renews, <em>why</em> it is at risk with the evidence attached, and <em>what to do next</em> as a named play with a named owner.\n\n" +
        "The thing it is not: a dashboard. A CX director opens it at 9am and the first thing on screen is \"here are your top three operational risks and what to do about them\". Everything else exists so they can challenge those three.",
      more:
        "The distinction that matters is <strong>decision engine</strong> versus <strong>reporting tool</strong>.\n\n" +
        "A dashboard hands you ninety charts and leaves the judgement to you, which means the judgement happens at 11pm before a QBR, badly. OpsPulse does the ranking itself, publishes the arithmetic behind the ranking, and then records what you decided so the next quarter can be forecast from evidence rather than optimism.\n\n" +
        "Say <strong>teach me</strong> and I will walk you through the whole thing in eight short lessons."
    },
    {
      id: "problem",
      title: "the problem it solves",
      keys: ["what problem", "why does this exist", "why build", "the problem", "pain point", "what is broken", "why do i need", "who cares", "why should i care"],
      answer:
        "Mid-market SaaS finds out an account is leaving <strong>on the renewal call</strong>. By then the decision was made weeks ago.\n\n" +
        "Four things cause that, and they compound:\n\n" +
        "• <strong>Fragmented data.</strong> The evidence exists — it is just spread across a ticketing tool, a QA sheet, a survey platform and a billing system that never speak.\n" +
        "• <strong>Health scores nobody trusts.</strong> A red dot with no arithmetic behind it cannot be argued with, so it gets ignored — and then turns out to have been right.\n" +
        "• <strong>CSMs stretched too thin.</strong> Nobody can read eighty accounts closely. They read the loud ones.\n" +
        "• <strong>No record of the save.</strong> When an account is rescued, nothing captures what was done, so it cannot be repeated or forecast.\n\n" +
        "OpsPulse attacks all four with the same mechanism: put the signals on one timeline, rank them by arithmetic, and keep the record."
    },
    {
      id: "how",
      title: "how the engine works",
      keys: ["how does it work", "how it works", "how does this work", "under the hood", "the process", "workflow", "mechanism", "pipeline", "end to end", "how do you do it", "the stages", "architecture"],
      answer:
        "Five stages, each constrained by the one before it:\n\n" +
        "<strong>1 · Fragmented data.</strong> Tickets, calls, QA reviews, usage and billing land on one account timeline.\n" +
        "<strong>2 · Detect.</strong> Nine statistical detectors compare a recent window against that account's own baseline.\n" +
        "<strong>3 · Understand.</strong> The change is decomposed into contributing factors that sum to the whole, and the largest is named — labelled a hypothesis, never a finding.\n" +
        "<strong>4 · Prioritise and act.</strong> Findings are ranked, then each carries a named play with a named owner.\n" +
        "<strong>5 · Revenue impact.</strong> The same signals are re-read at renewal to report whether it actually worked.\n\n" +
        "The load-bearing part: <strong>detection is arithmetic</strong>. The language layer only describes what the arithmetic already found. It cannot introduce a number that is not already in the data.",
      more:
        "Why that split is the whole design:\n\n" +
        "If a model decides <em>what</em> is wrong, you cannot audit the finding — you can only ask it again and hope for the same answer. If arithmetic decides what is wrong and language only narrates it, every claim reduces to a test you can re-run and a record you can open.\n\n" +
        "So no model is involved in detection, ranking or costing. That is enforced in code, not in a policy document."
    },
    {
      id: "layers",
      title: "the five product layers",
      keys: ["four layers", "five layers", "product overview", "detect understand prioritize act", "prioritise", "the layers", "components", "modules", "what are the parts"],
      answer:
        "Four layers produce the decision, and a fifth records it:\n\n" +
        "<strong>01 · Detect.</strong> Nine detectors over one account timeline, each comparing a recent window against your own baseline.\n" +
        "<strong>02 · Understand.</strong> Decomposition of the change into factors that sum to the whole, with the onset day correlated against your release and policy timeline.\n" +
        "<strong>03 · Prioritise.</strong> Ranked by severity, confidence, exposure and how soon the renewal lands — and deliberately made diverse, so the top three are three different problems.\n" +
        "<strong>04 · Act.</strong> A play with an owner, not an alert.\n" +
        "<strong>05 · The Renewal Decision Ledger.</strong> The layer that closes the loop: what was flagged, what you committed to, and what actually happened at renewal."
    },
    {
      id: "jobs",
      title: "who uses it and for what",
      keys: ["who uses", "which team", "customer success", "revops", "revenue operations", "support team", "cro", "founders", "job to be done", "use case", "use cases", "roles", "personas", "csm", "who is it for"],
      answer:
        "One renewal picture, four jobs:\n\n" +
        "• <strong>Customer Success.</strong> Which of my accounts is in trouble, why, and what do I do this week.\n" +
        "• <strong>Revenue Operations.</strong> Is the renewal forecast defensible when someone outside CS challenges it.\n" +
        "• <strong>Support &amp; Service.</strong> Which operational failure is actually costing revenue, as opposed to which one is loudest.\n" +
        "• <strong>Founders &amp; CROs.</strong> What is the top-three risk list this morning, and did last quarter's interventions work.\n\n" +
        "Every plan includes <strong>unlimited read-only viewers</strong> for exactly this reason: a renewal risk only gets acted on if the CSM, the RevOps lead and the CRO can all open the same evidence."
    },

    /* ---------- The engine, taught properly ---------- */
    {
      id: "detectors",
      title: "the nine detectors",
      keys: ["nine detectors", "9 detectors", "detectors", "what does it detect", "what patterns", "what does it look for", "signals it finds", "detection", "anomaly", "anomalies", "what can it find"],
      answer:
        "Nine, each with a declared bar it must clear:\n\n" +
        "• <strong>Escalation spike</strong> — two-proportion z-test on escalation rate, per category · z ≥ 2.5\n" +
        "• <strong>Emerging topic</strong> — volume lift plus a share-of-mix test · ≥ 1.35× and z ≥ 2.5\n" +
        "• <strong>SLA risk</strong> — two-proportion z-test on first-response breach rate · z ≥ 2.5\n" +
        "• <strong>Backlog risk</strong> — sustained queue growth as a slope · ≥ 3 tickets/day\n" +
        "• <strong>Coaching gap</strong> — QA point gap between cohorts, Welch t-test · ≥ 8 pts and t ≥ 2.5\n" +
        "• <strong>NPS drop</strong> — fall against baseline · ≥ 8 points\n" +
        "• <strong>CSAT drop</strong> — fall in mean stars, Welch t-test · ≥ 0.25 stars and t ≥ 2\n" +
        "• <strong>Churn risk</strong> — repeat escalations plus detractor NPS or low CSAT, above an ARR floor · ≥ $60k ARR, ≥ 5 accounts\n" +
        "• <strong>Compliance risk</strong> — open statutory data requests against their legal deadline · deadline-driven\n\n" +
        "No detector knows anything about how your data was produced. Each compares a recent window against your own operation's baseline.",
      more:
        "Two properties of that list are worth more than the list itself.\n\n" +
        "<strong>A global minimum sample of 40 recent records</strong> applies before anything is raised, however extreme the signal looks. Three angry tickets in a quiet week is not a pattern, and a system that reports it as one trains you to ignore it.\n\n" +
        "<strong>The thresholds are declared in one place</strong> rather than buried at their call sites, specifically so a reviewer can disagree with them in one sitting. They also separate the business dials you own — what counts as low adoption, how far ahead a renewal matters — from the statistical bars, which exist to hold the false-positive rate down. Two customers do not share a definition of \"low adoption\". They do share a definition of significance."
    },
    {
      id: "baseline",
      title: "what a baseline is",
      keys: ["baseline", "compared to what", "your own baseline", "benchmark", "normal", "what is normal", "seasonality", "history needed", "how much history"],
      answer:
        "A baseline is <strong>your own operation's recent normal</strong>, not an industry benchmark.\n\n" +
        "Every detector compares a recent window against the same account's, category's or cohort's prior behaviour. That is why the product needs roughly <strong>twelve months of history</strong> to be useful, and why it does not need to know anything about your industry: a refund escalation rate of 4% is meaningless as an absolute, and unmistakable as a 3.2× move against the 1.25% you were running last quarter.\n\n" +
        "It also means a quiet quarter produces an empty feed rather than invented risk. Nothing is graded on a curve."
    },
    {
      id: "thresholds",
      title: "the declared thresholds",
      keys: ["threshold", "thresholds", "how sensitive", "tuning", "false positive", "noise", "alert fatigue", "too many alerts", "z score", "significance", "statistically significant", "minimum sample"],
      answer:
        "Every bar is <strong>declared, in one visible place</strong>, rather than buried where a finding is raised.\n\n" +
        "The statistical bars — z ≥ 2.5, Welch t ≥ 2.5, a slope of ≥ 3 tickets/day — exist to hold the false-positive rate down, and they are ours to defend. The business dials — what counts as low adoption, how far ahead a renewal starts mattering, how long silence lasts before it means something — are yours to set, because two customers genuinely disagree about those.\n\n" +
        "Underneath all of them sits a <strong>minimum of 40 recent records</strong>. Below that, nothing is raised at all.\n\n" +
        "The point of publishing them is that a threshold you can see is a threshold you can argue with. A health score cannot be argued with, which is why nobody trusts one."
    },
    {
      id: "stats",
      title: "the statistics it uses",
      keys: ["what statistics", "statistical test", "z test", "t test", "welch", "regression", "ols", "slope", "maths", "math", "which tests", "statistical method", "p value"],
      answer:
        "Deliberately ordinary, well-understood tests — the kind a sceptical analyst can re-run in a spreadsheet:\n\n" +
        "• <strong>Two-proportion z-tests</strong> for rate changes: escalation rate, SLA breach rate.\n" +
        "• <strong>Welch's t-test</strong> for mean differences where the two groups have different variances: QA scores between cohorts, CSAT stars.\n" +
        "• <strong>OLS slope</strong> over the window for sustained growth: the backlog detector.\n" +
        "• <strong>Onset detection</strong> to find the day a change actually began, which is what makes correlating it against your release timeline meaningful.\n\n" +
        "Nothing exotic. The value is not in the sophistication of the test, it is in the fact that the test is stated, the threshold is stated, and the inputs are on the card."
    },
    {
      id: "rootcause",
      title: "how root cause is worked out",
      keys: ["root cause", "why did it happen", "cause", "hypothesis", "why is it a hypothesis", "work out what caused", "attribution", "decomposition", "what caused", "diagnosis", "explain the drop", "drivers", "contributing factors"],
      answer:
        "Root cause here means <strong>attribution by decomposition</strong>, not narration.\n\n" +
        "The observed change is split across a dimension — category, cohort, team, account — so the parts sum to the whole. The largest slice is named as the leading driver. Then the day the change began is correlated against operational events <em>in the same domain</em>: releases, policy changes, staffing.\n\n" +
        "Two things it refuses to do. It will not tell you a story that does not add up to the number, and it will not simply blame the most recent event. In the live demo two releases land a day apart precisely so you can watch it pick the <em>relevant</em> one rather than the <em>recent</em> one.\n\n" +
        "And the result is labelled a <strong>hypothesis</strong>, every time.",
      more:
        "Why \"hypothesis\" is not hedging:\n\n" +
        "Decomposition can prove that 62% of a rise sits in one category. It cannot prove <em>why</em> that category moved — a human who knows the account closes that gap. A system that says \"caused by\" when it means \"most of it is concentrated here, and a policy changed that week\" is overclaiming, and the first time it is caught doing that, every other finding it produces is discounted too.\n\n" +
        "So the label is the conservative one, permanently."
    },
    {
      id: "confidence",
      title: "the confidence score",
      keys: ["confidence", "how confident", "confidence score", "60%", "confidence floor", "how sure", "held for review", "scoring", "how accurate", "accuracy", "reliable", "trust the output", "certainty"],
      answer:
        "Confidence is <strong>published, not asserted</strong>. It is built from three visible components:\n\n" +
        "• <strong>45%</strong> statistical strength — how far outside the baseline the move actually is.\n" +
        "• <strong>30%</strong> share of the change the top driver explains.\n" +
        "• <strong>25%</strong> corroboration — whether independent signals agree.\n\n" +
        "Below <strong>60%</strong> an insight is marked <em>held for review</em> and is never auto-actioned. It goes to a human instead.\n\n" +
        "The number is not decoration: you can see which of the three components is dragging it down, which tells you what would raise it. A single significant move with no corroboration reads very differently from three signals pointing the same way, and the score says which one you are looking at.",
      more:
        "The floor is the part people underestimate.\n\n" +
        "Any system that surfaces findings will produce some that are weak. The question is what it does with them. Auto-actioning a 48%-confidence hypothesis is how a tool gets a reputation for crying wolf; hiding it entirely is how it misses the early one. Holding it for review does neither: it is on screen, it is labelled, and no play fires off the back of it.\n\n" +
        "The floor is configurable on the higher plans, because a team drowning in renewals may reasonably want a bar above 60%. Where exactly that line falls commercially is part of what we are still working out with design partners."
    },
    {
      id: "impact",
      title: "how dollar impact is calculated",
      keys: ["dollar impact", "revenue at risk", "revenue is at risk", "how much revenue", "how much money", "impact", "roi", "value at stake", "exposure", "arr at risk", "quantify", "business case", "how do you calculate", "the range", "why a range", "why is it a range", "range not a number", "range rather than"],
      answer:
        "Every exposure is a <strong>range with its arithmetic shown</strong>, never a single confident figure.\n\n" +
        "A card carries the inputs — accounts affected, ARR per account, the conversion band — and the range those inputs produce. The inputs are rounded to their display precision <em>first</em>, and the range computed from the rounded values, so the numbers printed on the card genuinely multiply out to the range printed on the card. You can check it with the calculator on your phone, and a test in the build re-multiplies them and fails if they do not reconcile.\n\n" +
        "The widest source of uncertainty is named out loud: the conversion band is a <strong>stated assumption</strong>, not a measurement, and the product says which is which.\n\n" +
        "A point estimate would be more persuasive and less true. That trade is refused on purpose.",
      more:
        "There is a second discipline attached to this one, and it is the more unusual of the two.\n\n" +
        "<strong>Compliance exposure carries no dollar figure at all</strong>, and is deliberately excluded from the revenue-at-risk total. It is reported as open statutory requests and days to deadline.\n\n" +
        "A fine probability would be the least defensible number on the page — it is a legal question, not a statistical one — and inventing it would undermine every number beside it. So it stays uncosted, permanently, and the system reports it as uncosted rather than quietly dropping it."
    },
    {
      id: "uncosted",
      title: "why compliance is never priced",
      keys: ["compliance risk", "uncosted", "no dollar figure", "why no dollar", "fine", "penalty", "gdpr deadline", "dsar", "statutory", "legal exposure", "regulatory"],
      answer:
        "Because a fabricated fine probability would be the least defensible number on the page.\n\n" +
        "Compliance risk is reported as <strong>open statutory data requests and days to their legal deadline</strong> — both of which are counted facts. It is never converted into dollars, and it is deliberately excluded from the revenue-at-risk rollup so it cannot inflate a total.\n\n" +
        "Whether a missed deadline costs you nothing or costs you a headline is a legal question about your jurisdiction, your regulator and your history. The engine does not know any of those, so it declines to guess. It returns the exposure marked as uncosted, with the reason attached — including through the agent tools, where the instructions tell the model not to estimate one either."
    },
    {
      id: "evidence",
      title: "evidence and provenance",
      keys: ["evidence", "provenance", "drill down", "drill-down", "audit trail", "traceable", "record id", "ticket id", "citation", "source of the number", "prove it", "where does the number come from", "where did this number come from", "number came from", "came from", "verify", "back it up"],
      answer:
        "<strong>Every number opens.</strong> Each figure on a card drills back to the records that produced it — the tickets, the reviews, the survey responses — so a claim is one click from the rows behind it.\n\n" +
        "And every retrieved quote carries the id of the record it came from. A passage that cannot be traced to a record <em>is not returned at all</em>: an unattributable quote is worse than no quote, because it is the one thing in the interface a reader cannot check.\n\n" +
        "This is also enforced at the boundary. Nothing reaches the interface as free text — everything is a validated object with its provenance attached — and when the self-check fails, the product reports the failure rather than swallowing it."
    },
    {
      id: "ledger",
      title: "the Renewal Decision Ledger",
      keys: ["ledger", "decision ledger", "what happens at renewal", "at renewal", "did it work", "if it worked", "know if it worked", "record of decisions", "closed loop", "close the loop", "outcome", "did it work", "track what we did", "history of decisions", "accountability", "impact verification"],
      answer:
        "A recommendation is not a decision. A <strong>decision</strong> is a human committing to a play on an account, on stated evidence, at a stated confidence.\n\n" +
        "The ledger records that commitment and <strong>snapshots the evidence as it stood at that moment</strong> — severity, confidence, the metric. Later engine passes cannot back-date any of it. Then the same signals are re-read on every pass, and the outcome is reported by the renewal date: cleared, improving, holding, or worse than when you started. It also flags it if you committed below the confidence floor.\n\n" +
        "That is what turns \"our health score said red\" into a renewal forecast a board will accept.",
      more:
        "The property an auditor actually wants is the ability to show the platform was <strong>wrong</strong>.\n\n" +
        "Because the snapshot is immutable, a decision that turned out badly stays visibly bad. Nothing quietly rewrites its own history to look prescient in hindsight. A tool that only remembers its wins is a tool you cannot forecast with — the numbers it gives you are selected, and you have no way of knowing by how much."
    },
    {
      id: "ranking",
      title: "how findings are ranked",
      keys: ["ranking", "ranked", "priority", "top 3", "top three", "why these three", "diversity", "ordering", "most important", "what comes first", "triage"],
      answer:
        "Findings are ranked by severity, confidence, exposure and how soon the renewal lands — and then the top three are made <strong>deliberately diverse</strong>.\n\n" +
        "That last step is not cosmetic. Ranked purely by priority, one big story takes two of the three slots — the same problem, told twice, in slightly different words. A director opening the product at 9am needs <em>three different problems</em>, because they have three different levers and a limited morning.\n\n" +
        "So the exec top three is diversity-aware by design. The full ranked feed is still there underneath, unfiltered, if you want to work down it."
    },
    {
      id: "health",
      title: "the health score",
      keys: ["health score", "health gauge", "overall score", "dimensions", "how healthy", "score out of 100", "gauge"],
      answer:
        "There is a health score, and it is the <em>least</em> important thing on the screen — deliberately.\n\n" +
        "It carries four risk dimensions, each with its drivers named, so it is a summary you can take apart rather than a dot you have to believe. It sits on the dashboard as orientation for someone who has been away for a week.\n\n" +
        "What it is not is the product. The industry's mistake was making the score the deliverable: a number nobody can decompose becomes a number nobody argues with, and then a number nobody acts on. Here the score exists to be challenged by the three findings printed above it."
    },
    {
      id: "refusals",
      title: "what the platform refuses to do",
      keys: ["refuse", "refusals", "will not do", "limitations", "what it cannot do", "constraints", "guardrails", "what are the limits", "downsides", "weaknesses"],
      answer:
        "A capability list tells you what a vendor wants to be judged on. This is the other list, and for a system that produces decisions it is the more informative one:\n\n" +
        "• <strong>It will not price a legal exposure.</strong> Compliance risk is reported in days to deadline, never in dollars.\n" +
        "• <strong>It will not answer beyond its data.</strong> Ask the Copilot something the engine has not computed and it says so, then lists what it can answer.\n" +
        "• <strong>It will not report a point estimate as certainty.</strong> Value at stake is a range, and the assumption inside it is labelled an assumption.\n" +
        "• <strong>It will not quietly rewrite its own history.</strong> Ledger snapshots cannot be back-dated, so a bad call stays visibly bad.\n" +
        "• <strong>It will not hide a failed self-check.</strong> If insight validation fails, the product prints every violation instead of swallowing it.\n\n" +
        "There is a Trust page on this site that lists all of this, and a live screen in the product where you can watch a refusal happen."
    },
    {
      id: "medians",
      title: "why it reports medians",
      keys: ["median", "medians", "average", "mean", "why median", "why not the average", "skew", "lognormal", "resolution time", "time to resolve", "bucketing", "closed date"],
      answer:
        "Two statistics decisions that most tools get wrong, and both are visible in the numbers here:\n\n" +
        "<strong>Resolution time is always a median.</strong> Time-to-resolve is heavily skewed — across a realistic dataset the mean sits near 49 hours while the median is nearer 3. Quoting the mean tells you about your worst tail, not your typical ticket, and it moves for reasons nobody can act on.\n\n" +
        "<strong>Outcome metrics bucket by the day a ticket closed</strong>, not the day it opened. Bucketing on creation looks natural and quietly flatters the recent end of every chart: of tickets opened yesterday, only the already-closed ones have an outcome — and those are the fast ones. Your last week always looks great, right up until it doesn't.\n\n" +
        "Neither is exciting. Both are the difference between a chart you can act on and a chart that lies gently."
    },

    /* ---------- The product surfaces ---------- */
    {
      id: "screens",
      title: "the screens in the product",
      keys: ["screens", "what screens", "dashboard", "decision feed", "risk radar", "navigation", "the ui", "interface", "what do i see", "sections", "tabs", "pages"],
      answer:
        "The decision engine has five screens:\n\n" +
        "• <strong>Dashboard</strong> — the top three risks, the health gauge, the KPI strip, ninety days of charts.\n" +
        "• <strong>Decision Feed</strong> — the full ranked list of findings, each with evidence, cause, play and owner.\n" +
        "• <strong>Risk Radar</strong> — the account view: who renews when, and what is wrong with them before they do.\n" +
        "• <strong>Executive Copilot</strong> — ask the book a question, get a grounded answer that links into the drill-down.\n" +
        "• <strong>Data Upload</strong> — drop a CSV and watch the same detectors run against your rows.\n\n" +
        "Alongside it sits <strong>NorthDesk</strong>, a simulated service desk: ticket queue, escalation board, QA reviews, NPS inbox, agent roster. That is the <em>source system</em>, and it is there so you can see where every number came from."
    },
    {
      id: "splitscreen",
      title: "the side-by-side demo",
      keys: ["split screen", "side by side", "ops floor", "northdesk", "service desk", "source system", "two apps", "both screens", "live demo", "simulation", "same store"],
      answer:
        "The <strong>Live Ops Floor</strong> puts the source system and the decision engine side by side, and it is the fastest way to understand the product.\n\n" +
        "They are not two apps that synchronise. They are two views over <em>one store</em> — a ticket arriving in NorthDesk on the left is already the object OpsPulse is counting on the right. There is nothing to keep in sync, and therefore nothing that can drift.\n\n" +
        "Watch it for thirty seconds: tickets stream into the queue, the ingest ticker moves with them, and the detectors re-run over the whole dataset every few seconds. Open it in several tabs and every tab shows the same operation, down to the individual ticket.\n\n" +
        "No signup, nothing to install."
    },
    {
      id: "copilot",
      title: "the Executive Copilot",
      keys: ["copilot", "executive copilot", "ask a question in the product", "natural language query", "chat in the product", "query the data", "ask the book"],
      answer:
        "The <strong>Executive Copilot</strong> lets you ask the renewal book a question and get an answer built from the engine's computed insights.\n\n" +
        "Every number in every answer is traceable to a record, and each answer links straight into the relevant drill-down. When it does not have a grounded answer, it says so and lists what it <em>can</em> answer — it does not generate something plausible to fill the silence.\n\n" +
        "It is templated language over structured findings rather than a language model, for the same reason I am: the grounding layer is the part that matters, and a model that can invent a number is not an improvement on one that cannot. Swapping a model in later means feeding it these same insight objects, with the grounding intact.\n\n" +
        "It is on the Enterprise plan in the product's own entitlement model."
    },
    {
      id: "upload",
      title: "uploading your own data",
      keys: ["upload", "csv", "import", "support xlsx", "excel file", "my own data", "try on my data", "export", "excel", "xlsx", "spreadsheet", "bring my data", "data upload", "60 second", "test with my data"],
      answer:
        "Drop in a CSV and the detectors run against <strong>your rows</strong> — the feed changes because of your file, in about a minute.\n\n" +
        "Column matching accepts the standard Kaggle support-ticket headers, the internal names and common Zendesk/Freshdesk variants, and the screen shows you exactly which of your columns mapped to which field, so a wrong guess is visible rather than silent.\n\n" +
        "Two honest limitations:\n\n" +
        "• <strong>.xlsx is not supported</strong>, and the interface says so plainly rather than failing quietly. Export as CSV and it ingests fully.\n" +
        "• It runs <strong>entirely in your browser</strong>. Nothing is uploaded to a server and nothing is stored — which is a privacy property, not a limitation, but it does mean closing the tab loses it."
    },
    {
      id: "analytics",
      title: "the analytics and date ranges",
      keys: ["analytics", "charts", "graphs", "date range", "time range", "custom range", "7 days", "30 days", "90 days", "trend", "visualisation", "visualization"],
      answer:
        "Presets are <strong>7 / 30 / 90 days</strong>, and alongside them is a custom window: two date fields, clamped to the dataset, that recompute every chart over exactly that span.\n\n" +
        "The presets answer \"how have the last N days gone\". The custom window answers \"what happened around the refund policy change\", which is the question people actually open the screen with. Pick the dates back-to-front and it corrects them silently instead of scolding you.\n\n" +
        "Charts are hand-drawn SVG with no chart library: one y-axis always, a legend whenever there are two or more series, hover tooltips throughout, and <strong>a data table under every chart</strong> — because a chart you cannot read the numbers off is a picture, not evidence."
    },
    {
      id: "mcp",
      title: "the agent (MCP) tools",
      keys: ["mcp", "agent", "api", "api access", "tools for llm", "claude desktop", "integrate with an agent", "programmatic", "automation", "can an ai use it", "model context protocol"],
      answer:
        "The same engine is exposed as <strong>seven read-only tools an agent can call</strong>, so the questions stop being a fixed list:\n\n" +
        "• <strong>describe_operation</strong> — window, record counts, release timeline, declared thresholds\n" +
        "• <strong>get_executive_brief</strong> — the diversity-aware top three and the narrative\n" +
        "• <strong>list_insights</strong> — the full ranked feed\n" +
        "• <strong>explain_insight</strong> — evidence, decomposition, confidence parts, impact arithmetic\n" +
        "• <strong>search_evidence</strong> — search over ticket text, NPS verbatims and QA notes\n" +
        "• <strong>get_metric_series</strong> — daily inflow, backlog, throughput\n" +
        "• <strong>get_health</strong> — the health score and its dimensions, with drivers\n\n" +
        "<strong>All seven are read-only.</strong> No reseed, no resolve, no write of any kind: an agent inspecting an operation should not be able to change it.",
      more:
        "The division of labour is the point, and the credibility rules are carried into the tool payloads rather than left behind at the UI.\n\n" +
        "<strong>explain_insight</strong> returns the formula, the rounded inputs and the basis lines <em>in the same payload</em> as the range — so a model physically cannot quote the range without its derivation. <strong>Compliance exposure</strong> comes back marked uncosted, with instructions telling the model not to estimate one. <strong>get_metric_series</strong> returns the series the product already computed rather than re-slicing the data, because a second aggregation is exactly how a tool answer starts disagreeing with the chart on screen.\n\n" +
        "Detection stays arithmetic. The model chooses which finding matters and says it in English."
    },
    {
      id: "assurance",
      title: "the self-check and data quality",
      keys: ["assurance", "self check", "self-check", "check your own", "checks itself", "check its own", "validation", "contract valid", "data quality", "quality checks", "how do you know the data is good", "bad data", "missing data", "coverage"],
      answer:
        "The product checks itself and <strong>shows you the result either way</strong>.\n\n" +
        "Every insight is validated against a contract before it can reach a screen — the fields, the provenance, the arithmetic. If validation fails, the product reports the failure and prints every violation rather than swallowing it and rendering a card with a hole in it.\n\n" +
        "Alongside that sits a data-quality view: how your columns mapped on ingest, how many records of each type arrived, whether the contract validated, and which detectors actually had enough data to run. A detector that could not run says so — that is a very different statement from \"nothing found\", and conflating the two is how a tool gives false comfort."
    },
    {
      id: "simulated",
      title: "the demo data",
      keys: ["real data", "fake data", "simulated", "is this real", "is the data real", "data real", "sample data", "demo data", "made up data", "whose data", "northwind", "test data", "synthetic"],
      answer:
        "Everything on this site runs on <strong>simulated data</strong>, and I would rather say that plainly than let you assume otherwise. There is no customer data in it.\n\n" +
        "It is ninety days for a fictional SaaS company: roughly 10,000 support tickets, 2,400 accounts, 62 agents, 500 escalations, 1,000 NPS responses and 100 QA reviews, generated to the schema of a real public support-ticket dataset — which is why a genuine export drops straight into the upload screen.\n\n" +
        "Synthetic is also the <em>correct</em> choice for a demonstration. Several specific patterns are planted in that data, and the engine is never told about them: it has to find them statistically, the same way it would in yours. That makes the demo a test you can check rather than a story you have to take on trust.",
      more:
        "The planted patterns are worth knowing about if you are evaluating the demo, because they are how you audit it:\n\n" +
        "• a <strong>refund escalation spike</strong> running several times its own baseline after a policy change, with the blast radius pinned to an exact count of affected accounts — so \"231 customers\" is a counted fact, not a caption;\n" +
        "• a <strong>new-hire QA decline</strong>, one cohort scoring well below tenured agents;\n" +
        "• an <strong>onboarding contact surge</strong> after a self-serve release;\n" +
        "• a <strong>backlog that grows</strong> because inflow rises while throughput does not.\n\n" +
        "A fifth is not planted at all: <strong>NPS falls</strong> as a consequence of the other four, and its detractor comments carry those drivers. So \"why did NPS drop?\" has an answer that is arithmetic rather than narration.\n\n" +
        "Two events also land a day apart on purpose, so you can check that root-cause picks the <em>relevant</em> one rather than the <em>recent</em> one."
    },
    {
      id: "tiers_in_app",
      title: "the tier switcher in the demo",
      keys: ["essential", "growth tier", "tier switcher", "locked", "padlock", "entitlement", "feature gating", "why is this locked", "upgrade prompt", "plan in the demo"],
      answer:
        "The live product has a <strong>tier switcher</strong> so you can watch entitlements move. Flip down and panels lock; flip back and they open.\n\n" +
        "Locked features are <em>rendered as locked</em>, never removed — each padlock names which tier opens it and what it would tell you. Hiding a feature you do not pay for makes a product look thin; showing it locked makes it look priced.\n\n" +
        "One thing to be aware of, so it does not confuse you: the tier names inside the demo and the list prices attached to them are a <strong>modelling input for the cost view</strong>, not a price list. The cost model needs a number to multiply, so it has one. We have not published commercial pricing at all yet — ask me about pricing and I will tell you exactly where that stands.\n\n" +
        "The ceilings are also <strong>soft</strong>. Exceeding one flags a conversation at renewal; it never blocks the product. The ceiling is measured in accounts under management, so a customer who hits it has grown their book — which is the outcome the product exists to produce."
    },
    {
      id: "sync",
      title: "why every tab agrees",
      keys: ["multiple tabs", "two tabs", "tabs", "second tab", "another tab", "two windows", "open it twice", "two of us open", "sync", "synchronise", "synchronize", "same numbers", "different tab", "browser tabs", "consistency"],
      answer:
        "Open the apps in as many tabs as you like and they all show the <strong>same operation</strong>, down to the individual ticket.\n\n" +
        "One tab runs the simulation and broadcasts the records it creates; every other tab applies them. A tab opened later asks for a snapshot and catches up. Pausing, reseeding or uploading a CSV works from any tab.\n\n" +
        "That is a deliberate choice over the cheaper option of letting each tab replay the same seeded sequence. Replaying sends less data, but it makes every tab's correctness depend on every tab walking an identical code path — one dropped message and they diverge silently and permanently. Shipping the records means a tab's state is a function of what it actually received, which is inspectable.\n\n" +
        "It sounds like a detail. It is the difference between a demo that survives being opened twice and one that quietly contradicts itself in front of a prospect."
    },

    /* ---------- Commercial ---------- */
    {
      id: "pricing",
      title: "pricing",
      keys: ["pricing", "price", "cost", "how much", "expensive", "budget", "per seat", "plans", "tiers", "afford", "quote", "fee", "subscription", "what do i pay", "list price", "price list", "how much per month"],
      answer:
        "Straight answer: <strong>we are not publishing list prices yet.</strong> Pricing discovery with the first design partners is still running, and a number I gave you today would be a guess in the same typeface as the engine's arithmetic.\n\n" +
        "What <em>is</em> decided is the shape. Priced on the <strong>renewal book, never per seat</strong>. Every plan includes unlimited read-only viewers, because a renewal risk only gets acted on if the CSM, the RevOps lead and the CRO can all open it without someone buying them a licence first.\n\n" +
        "The two axes are <strong>signal sources</strong> and <strong>ledger retention</strong> — how much the engine has to reason over, and how long the decision record has to stay queryable. Those are the two things that actually cost money to run.\n\n" +
        "If you need a figure for a budget conversation, say <strong>schedule a demo</strong> and you will get our current thinking, the reasoning under it and an honest statement of how firm it is. That is a conversation with a founder, not a number from me.",
      more:
        "The two axes are <strong>signal sources</strong> and <strong>ledger retention</strong>, and both are honest about what actually costs money to run.\n\n" +
        "A signal source is one connected system: a ticketing platform, a telephony feed, a QA tool, a product-analytics stream, a billing system. More sources means more for the engine to reason over. Longer retention means keeping a decision record alive and queryable for years.\n\n" +
        "What is deliberately <em>not</em> an axis is seats. Charging per seat would price the product against its own mechanism of action — the whole value is that the CRO can open the same evidence the CSM is looking at."
    },
    {
      id: "contract",
      title: "contract terms",
      keys: ["contract", "is there a contract", "sign a contract", "any contract", "commitment", "lock in", "lock-in", "cancel", "notice period", "annual", "monthly", "terms", "minimum term", "refund policy", "invoice", "billing"],
      answer:
        "<strong>Design partners</strong>: scope and terms are agreed per partner on the first call, so I am not going to state a standard one here. What I can tell you is that either side can walk away, and we would just ask for the honest reason why.\n\n" +
        "<strong>Ongoing plans</strong>: monthly, no minimum term, and no published list price yet while pricing discovery is running. What varies is how long the decision record is retained, because that is the thing that actually costs money to run.\n\n" +
        "Your data stays exportable throughout. A product whose value is a defensible record should not hold that record hostage."
    },
    {
      id: "partner",
      title: "the design partner programme",
      keys: ["design partner", "partner programme", "partner program", "pilot", "beta", "early access", "founding customer", "trial", "free", "join", "apply", "how do i sign up"],
      answer:
        "We are building this with <strong>ten mid-market SaaS teams</strong>. Not a waitlist, and not a discount scheme.\n\n" +
        "<strong>You get</strong>: detectors tuned to your renewal motion, findings on your own book from the first week, and direct access to the founders themselves rather than a support queue.\n\n" +
        "<strong>We ask</strong>: an export or a read-only connection, an hour a fortnight, and honest reactions — especially when a finding is wrong. A detector nobody argues with is a detector nobody uses.\n\n" +
        "<strong>Fit</strong>: $3M–$30M ARR, a renewal book someone owns by name, and roughly twelve months of history in your tools.\n\n" +
        "<strong>Terms</strong>: agreed per partner on the first call. We are not publishing a standard price for the programme while pricing discovery is still running, and I would rather tell you that than quote you something I would have to walk back.\n\n" +
        "First step is that thirty-minute call. If the fit is not obvious to both sides in that half hour, we will say so."
    },
    {
      id: "external",
      title: "external signals",
      keys: ["external signal", "external data", "acquisition", "acquired", "merger", "m&a", "funding round", "raised money", "down round", "insolvency", "bankrupt", "bankruptcy", "going under", "administration", "credit event", "champion left", "champion leaves", "stakeholder change", "changed jobs", "new vp", "layoffs", "redundancies", "outside signals", "third party data", "news about my customers", "company events"],
      answer:
        "The signal your own systems cannot contain: what is happening <em>to</em> the customer. Four types, and they are in the product today.\n\n" +
        "• <strong>Acquisition or merger</strong> — the acquired customer inherits the acquirer's vendor stack, decided in a procurement review your champion is not in.\n" +
        "• <strong>Financial distress</strong> — restructuring, a freeze on discretionary software spend. By the time it is a late invoice the outcome is fixed.\n" +
        "• <strong>Stakeholder change</strong> — the person who chose you leaves. Lowest confidence of the four, and scored that way.\n" +
        "• <strong>Funding</strong> — the one that runs the other way, flagged as a seat-expansion opportunity rather than a risk.\n\n" +
        "Open the live product on a plan that carries External Signals and the panel is there: accounts ranked most recently detected first, each event with its type, its confidence and its source.\n\n" +
        "Two honest limits, and ask me for more if you want them: the feed behind it is not licensed yet, and an event does not yet move the risk score.",
      more:
        "Taking those two limits properly, because they are the difference between what runs and what I would be overselling.\n\n" +
        "<strong>The records are sample fixtures, and they say so.</strong> Every seeded event renders a <em>sample</em> badge and carries no source link at all. That is deliberate: a fabricated URL pointing at a real news domain is a citation that does not exist, and it is the thing that ends a demo the moment somebody clicks it. Connecting a real feed — Crunchbase, Tracxn, ZoomInfo — is a licensing and procurement decision rather than an engineering one, and the schema is built so that wiring is a swap. When it lands, the badge disappears on its own.\n\n" +
        "<strong>Entity resolution is the hard half of that swap</strong>, not the connector. Deciding that a filing about \"Northwind Group\" concerns your account \"Northwind Ltd\" is an inference with a confidence attached, not a string comparison, and presenting a fuzzy name match as fact would put a fabricated event into a renewal forecast.\n\n" +
        "<strong>And fusion is a roadmap item.</strong> Today an external event surfaces against the account; it does not change the renewal risk score. When it does, it will change the <em>prior</em> on an internal risk rather than becoming a second score sitting next to the first — two numbers that can disagree about the same account is the health-score failure mode with an extra step."
    },
    {
      /* The boundary topic. It exists because every phrasing below used to land
         somewhere plausible and wrong: "do you replace Zendesk" got the
         integrations answer, and "will you fix our SLAs" got the glossary
         definition of an SLA. Both read as evasion to the one prospect who most
         needs a straight no — and a deal that dies in month three because we let
         a replacement assumption stand is more expensive than the one we lose
         today by saying it plainly.

         Keys are whole phrases about replacing, fixing, cleaning or lacking a
         system. Nothing here is a bare product name: "zendesk" on its own stays
         with `data`, where someone asking which tools we read belongs. */
      id: "scope",
      title: "what we do not do",
      keys: ["replace zendesk", "replace salesforce", "replace our helpdesk", "replacement for", "replace our",
             "get rid of zendesk", "get rid of salesforce", "rip out", "instead of zendesk", "instead of salesforce",
             "do you replace", "does it replace", "still need zendesk", "still need salesforce", "keep zendesk",
             "fix our sla", "fix our slas", "fix my sla", "improve our slas", "set our slas", "define our slas",
             "clean our crm", "clean our data", "fix our data", "data cleanup", "data hygiene", "migrate our data",
             "no ticketing system", "do not have slas", "dont have slas", "no slas", "we have no systems",
             "what do you not do", "what does it not do", "what is out of scope", "limitations"],
      answer:
        "The honest boundary, because assuming otherwise gets expensive in month three:\n\n" +
        "<strong>We do not replace your systems.</strong> Zendesk, Salesforce, your QA tool and your survey platform all stay exactly where they are. OpsPulse is a layer that reads across them and tells you which renewal is moving. If you rip one out, we lose a source.\n\n" +
        "<strong>We do not fix your SLAs.</strong> We will tell you which breaches are costing you a renewal and which are merely noisy. Setting the targets, staffing the queue and changing the process is your operation, not our product.\n\n" +
        "<strong>We do not clean your CRM.</strong> We join to it. If your ARR and renewal dates are wrong in the CRM, they are wrong in our output too — and we would rather show you the join and let you argue with it than quietly repair your book and call the result intelligence.\n\n" +
        "<strong>And if you have no systems to read, you are not our customer.</strong> No ticketing platform, or no defined SLAs, and there is no baseline for anything here to work against. We will tell you that on the first call rather than sell you a pilot that cannot succeed.",
      more:
        "Two things follow from that boundary, and both are product decisions rather than modesty.\n\n" +
        "<strong>We are a read layer, so we are additive rather than a migration.</strong> There is no data to move, no workflow to retrain and nothing to switch off, which is why a first look can be a CSV rather than a project. The flip side is that we inherit your data quality: a renewal date nobody maintains produces a renewal risk nobody should trust, and the product will show you the join it made rather than hide it.\n\n" +
        "<strong>And the qualification is real.</strong> Roughly twelve months of history in at least a ticketing system is the floor. Below that the engine still runs, but its first weeks are calibration rather than insight — and I would rather say so now than let you find out after you have signed."
    },
    {
      id: "setup",
      title: "setup and time to value",
      keys: ["how long", "setup", "set up", "onboarding", "implementation", "time to value", "get started", "deploy", "install", "how quickly", "ramp", "go live", "first value"],
      answer:
        "Start with <strong>CSV exports</strong>: no integration work, and you see real findings on your own accounts the same day. A helpdesk export alone gives you support-shaped findings; add a CRM export and those findings acquire ARR, a renewal date and a named owner, which is the difference between a statistic and a decision.\n\n" +
        "A read-only connection to your ticketing system is the next step, and it is the one that makes findings arrive without anyone remembering to re-export. Native connectors are on the roadmap; during the design partner programme we build the one you need.\n\n" +
        "There is nothing to install. It runs in the browser.\n\n" +
        "The honest constraint is not the setup, it is the <strong>history</strong>: baselines need roughly twelve months behind them to mean anything. With less than that the product still runs, but its first few weeks are calibration rather than insight, and I would rather tell you that up front."
    },
    {
      id: "data",
      title: "the data it needs",
      keys: ["what data", "integrations", "integrate", "connect", "sources", "zendesk", "salesforce", "hubspot", "intercom", "freshdesk", "jira", "slack", "connectors", "what do you need from", "plug in", "signal source", "which systems", "gainsight data"],
      answer:
        "A <strong>signal source</strong> is one connected system. Typically:\n\n" +
        "• <strong>Ticketing</strong> — Zendesk, Freshdesk, Intercom\n" +
        "• <strong>Telephony</strong> — call records and transcripts. The one on this list the build does not read yet: there is no call data in it, so the contact-centre panel renders locked on every plan rather than filled with numbers nobody measured\n" +
        "• <strong>QA</strong> — review scores and notes\n" +
        "• <strong>Surveys</strong> — NPS and CSAT with verbatims\n" +
        "• <strong>Product usage</strong> — seats, logins, feature events\n" +
        "• <strong>Billing / CRM</strong> — contract dates and ARR\n" +
        "• <strong>External signals</strong> — acquisition, distress, stakeholder change and funding on the accounts themselves, which is the one source that is not a system you own\n\n" +
        "You need roughly <strong>twelve months of history</strong> for a baseline to mean anything. To start, CSV exports are enough — the upload reads six shapes (tickets, QA, NPS, CRM/account, billing, product usage). Event files append; a CRM, billing or usage file <strong>joins onto the accounts already loaded</strong>, on account id first and company name second, and never invents an account that was not there.\n\n" +
        "You do not need all six. Three sources is a real deployment; the engine reports which detectors could not run rather than pretending the ones it did run cover everything."
    },
    {
      id: "security",
      title: "security and data handling",
      keys: ["secure", "security", "safe", "privacy", "gdpr", "soc 2", "soc2", "compliance certification", "residency", "encryption", "pii", "confidential", "iso 27001", "data protection", "on premise", "on-prem", "self host", "where is data stored", "who can see", "do you store", "store my data", "keep my data", "retention of my data"],
      answer:
        "Honest answer, because this is exactly the kind of question a vendor should not fudge:\n\n" +
        "<strong>Today</strong>: this is a functional MVP. Everything on this site runs on simulated data — there is no customer data in it, and the CSV upload runs entirely in your browser without sending anything to a server.\n\n" +
        "<strong>For design partners</strong>: read-only access, scoped to what the detectors need, and we will sign whatever your security team requires before any data moves.\n\n" +
        "<strong>On the roadmap</strong>: SSO, RBAC and configurable retention, then data residency, private deployment and an immutable access log for regulated operations. Which of those sit together on which plan is part of what pricing discovery decides, so I am not going to draw the line for you today. <strong>SOC 2 comes with productisation, and we will not claim it before it is real.</strong>\n\n" +
        "If your security review needs a document we do not have yet, the useful answer is a call with the CTO rather than a badge on a landing page."
    },
    {
      id: "different",
      title: "how it differs from a health score",
      keys: ["different from", "how is this different", "versus", "vs", "compare", "competitor", "competitors", "gainsight", "vitally", "churnzero", "totango", "catalyst", "planhat", "health score", "why not just", "already have", "better than", "alternative", "why you"],
      answer:
        "Most customer-success tools give you a <strong>health score</strong>: a red/amber/green dot with no arithmetic behind it. It cannot be argued with, so it gets ignored — and then it turns out to have been right.\n\n" +
        "Three differences:\n\n" +
        "<strong>Every number opens.</strong> Each figure drills back to the records that produced it, and every retrieved quote carries its record id.\n" +
        "<strong>Cause is labelled a hypothesis, not a finding.</strong> Below 60% confidence nothing is auto-actioned; it is held for a human.\n" +
        "<strong>It remembers what you decided.</strong> The ledger snapshots the evidence as it stood, then reports the outcome at renewal — including when the account left anyway.\n\n" +
        "We are not trying to replace your CS platform's workflow. We are trying to replace the part of it nobody believes.",
      more:
        "The sharper version of the comparison is about <em>what the tool is for</em>.\n\n" +
        "A CS platform is a system of record for the relationship: playbooks, tasks, timelines, ownership. It is genuinely good at that, and ripping it out to install this would be a bad trade.\n\n" +
        "What it is not built to do is <strong>defend a number under challenge</strong>. When the CFO asks why the renewal forecast moved, \"the health score went amber\" is not an answer. This is the layer that produces one — which is why it is priced as an addition to a renewal book rather than as a seat-based replacement for a CRM."
    },
    {
      id: "build_it",
      title: "building it yourself",
      keys: ["build it ourselves", "build our own", "in house", "in-house", "why not build", "diy", "our data team", "we have analysts", "sql", "just use a dashboard", "looker", "tableau", "power bi"],
      answer:
        "You could, and some teams should. The honest version of the trade:\n\n" +
        "The detectors are not the hard part. Two-proportion z-tests and a Welch t are a competent analyst's afternoon. <strong>The hard parts are the ones that only show up in month four</strong>: the decomposition that has to sum to the whole, the confidence floor nobody is allowed to override, the rounding discipline that makes printed inputs multiply out to the printed range, the immutable snapshot so a bad call cannot be quietly rewritten, and the refusal to cost a legal exposure when a stakeholder is asking you to.\n\n" +
        "Each one is small. Together they are the difference between a report people argue with and a report people trust.\n\n" +
        "The other cost is maintenance: a dashboard built in a sprint becomes someone's second job forever. If you have a data team with spare capacity and a strong opinion about statistical hygiene, build it. If your renewal book is being forecast on vibes this quarter, that is a slow way to fix it."
    },
    {
      id: "roadmap",
      title: "the roadmap",
      keys: ["roadmap", "what is next", "coming soon", "future", "release plan", "when will", "timeline", "launch", "phases", "production ready", "when is it ready", "maturity", "stack", "tech stack", "what technology"],
      answer:
        "<strong>Now</strong>: problem validation with renewal owners — sharpening which signals actually predict a non-renewal.\n" +
        "<strong>In progress</strong>: the working engine you can open on this site — statistical detection, decomposed reasoning, exposure as a range.\n" +
        "<strong>Next</strong>: design partner pilots with ten mid-market teams, detectors tuned per renewal motion.\n" +
        "<strong>Then</strong>: native connectors, a scalable data pipeline, and launch.\n\n" +
        "Six phases, roughly twelve months to production, each building one stage of the same closed loop. There is a full technical roadmap on this site if you want the engineering view — including the intended stack for the production build, which is written down publicly rather than hinted at.\n\n" +
        "What you can open today is the first phase, already live. That is deliberate: a roadmap where nothing is running yet is a wish list."
    },
    {
      id: "team",
      title: "the team behind it",
      keys: ["who built", "who made", "who is behind", "team", "founders", "behind this", "the company", "about you the company", "sachin", "sudharshan", "venkatesh", "funding", "investors", "how many people", "how big is the company", "where are you based"],
      answer:
        "Three founders.\n\n" +
        "<strong>Sudharshan — Founder &amp; CEO.</strong> Fifteen years across customer operations, customer experience and enterprise SaaS, more recently executive search.\n\n" +
        "<strong>Sachin — Co-founder &amp; CTO.</strong> Enterprise AI, architecture and engineering. Owns the decision engine: the detectors, the confidence floor, and the insight contract that stops anything reaching a screen before it can be traced back to a record.\n\n" +
        "<strong>Venkatesh — Co-founder &amp; CBO.</strong> Go-to-market, revenue and partnerships. Owns how the product reaches the operations leaders it is built for, the partner and investor network, and expansion beyond the first market.\n\n" +
        "Small on purpose. You will not be handed to an account manager, and the person who answers your hardest technical question is the person who wrote the thing."
    },
    {
      id: "demo",
      title: "seeing it for yourself",
      keys: ["demo", "see it for myself", "try it", "test it", "play with", "can i see a demo", "can i see it", "show me the product", "walkthrough", "sandbox", "book a call", "schedule a call", "meeting", "screenshot", "video"],
      answer:
        "Three ways, and the first takes about a minute:\n\n" +
        "<strong>Run it on your own export.</strong> Open the Ops Floor, go to Data Upload, drop in a CSV of tickets, QA reviews or NPS responses. Your rows are parsed, mapped onto the account timeline and the nine detectors re-run against them, so the feed changes because of your data. It happens in your browser — nothing is uploaded and nothing is stored.\n\n" +
        "<strong>Drive the simulated operation.</strong> A source system on the left, the decision engine on the right, both reading one store so they cannot disagree. No signup, nothing to install.\n\n" +
        "<strong>Talk to us.</strong> Thirty minutes, screen shared, your questions rather than our script.\n\n" +
        "Say <strong>schedule a demo</strong> and I will take you to the form."
    },
    {
      id: "contact",
      title: "talking to a human",
      keys: ["talk to a human", "human", "contact", "speak to", "get in touch", "reach you", "email address", "call you", "sales", "real person", "someone"],
      answer:
        "Happy to hand you over. The founders answer everything themselves.\n\n" +
        "Use the <strong>Schedule a demo</strong> form on this page and it reaches them directly — thirty minutes, screen shared, your questions rather than our script.\n\n" +
        "Say <strong>schedule a demo</strong> and I will scroll you to it."
    },

    /* ---------- The awkward questions, answered rather than dodged ---------- */
    {
      id: "ai",
      title: "whether AI invents the numbers",
      keys: ["llm", "gpt", "chatgpt", "claude", "hallucinate", "hallucination", "make up", "made up", "invent", "fabricate", "generative", "is this ai", "which model", "does it use ai", "machine learning", "prompt", "ai washing", "just a wrapper", "openai"],
      answer:
        "Deliberately narrow, and this is the core design decision of the product.\n\n" +
        "<strong>Detection, ranking and costing are arithmetic.</strong> No model is involved. A pattern is found because a recent window sits far enough outside a declared baseline — not because something predicted it.\n\n" +
        "<strong>Language only explains.</strong> The narrative layer describes findings that already exist as structured objects. It cannot introduce a number that is not already in the data.\n\n" +
        "That split is enforced in code rather than in a policy document. A generated number is a fabricated number — including in this chat window, which is why I match your question against authored answers instead of improvising with a model.\n\n" +
        "Where a model genuinely helps is choosing which finding matters and saying it well. That is what the agent tools are for.",
      more:
        "The uncomfortable question underneath this one is usually \"so is the AI label marketing?\"\n\n" +
        "Fair challenge. Here is the test: ask any AI product to show you the arithmetic behind a number it just gave you. If it can, the number was computed and the model narrated it. If it cannot, the number <em>is</em> the narration.\n\n" +
        "Every figure in this product opens onto its own derivation, and a legal exposure comes back explicitly uncosted rather than confidently estimated. That is a harder thing to build than a prompt, and it is the reason the word survives on the page."
    },
    {
      id: "wrong",
      title: "what happens when it is wrong",
      keys: ["what if it is wrong", "wrong", "mistake", "miss something", "false alarm", "inaccurate", "fails", "error", "bad call", "blame", "missed a churn", "what if it misses"],
      answer:
        "It will be wrong sometimes, and the product is built so you can <strong>prove</strong> it was.\n\n" +
        "When you commit to a play, the ledger snapshots the risk, the confidence and the account's metrics <em>as they stood at that moment</em>. The evidence is never back-dated. At renewal the same signals are re-read and the outcome is reported: cleared, improving, holding, or worse than when you started.\n\n" +
        "Being able to show the platform was wrong is the property an auditor is actually looking for. A tool that only remembers its wins is a tool you cannot forecast with.\n\n" +
        "The two failure modes are treated differently, deliberately. A <strong>false positive</strong> costs a CSM an hour and is held below the confidence floor rather than actioned. A <strong>miss</strong> is the expensive one, which is why detectors run on every pass over the whole book rather than only on accounts someone already suspected."
    },
    {
      id: "scale",
      title: "whether it fits your size",
      keys: ["right for", "fit", "too small", "too big", "company size", "how many customers", "b2c", "enterprise size", "startup", "smb", "mid market", "mid-market", "is this for me", "suitable", "employees", "arr", "how many accounts", "book size"],
      answer:
        "Built for <strong>mid-market SaaS</strong>, roughly <strong>$3M–$30M ARR</strong>.\n\n" +
        "The shape matters more than the size: a renewal book someone owns by name, CSMs carrying more accounts than they can read closely, and about twelve months of history in your tools.\n\n" +
        "If you are smaller than that, a spreadsheet genuinely is fine and we will tell you so. If you are much larger the detectors still work, but you likely need the Enterprise conversation about residency, custom thresholds and model review.\n\n" +
        "The one shape that does not fit is high-volume B2C churn. This is built for books where an individual account is worth knowing by name."
    },
    {
      id: "adoption",
      title: "getting a team to actually use it",
      keys: ["will my team use it", "will my team", "my team use", "adoption", "change management", "another tool", "another dashboard", "nobody opens", "nobody uses it", "training", "learning curve", "who maintains", "extra work", "workflow fit", "yet another dashboard", "shelfware", "nobody will use"],
      answer:
        "The honest risk with any tool like this is not accuracy, it is <strong>a third tab nobody opens</strong>.\n\n" +
        "Three things are designed against that:\n\n" +
        "• <strong>The top of the screen is three decisions, not ninety charts.</strong> A morning read is thirty seconds, not a project.\n" +
        "• <strong>Every finding carries a named owner and a named play</strong>, so it lands as work rather than as information.\n" +
        "• <strong>Unlimited read-only viewers on every plan</strong>, so the finding travels to whoever needs to see it without a procurement conversation.\n\n" +
        "The failure mode we watch for in design partners is a feed nobody argues with. Silence is not agreement — it means the findings are not landing, and that is a product problem rather than a training problem."
    },

    /* ---------- Glossary ---------- */
    {
      id: "glossary",
      title: "the vocabulary",
      keys: ["what does arr mean", "what is nps", "what is csat", "what is sla", "what is churn", "what is an escalation", "blast radius", "renewal book", "detractor", "define", "glossary", "terminology", "jargon", "what does that mean", "qa review"],
      answer:
        "The terms that come up most:\n\n" +
        "• <strong>ARR</strong> — annual recurring revenue. The yearly value of a contract.\n" +
        "• <strong>Renewal book</strong> — the set of contracts coming up for renewal that someone owns by name.\n" +
        "• <strong>NPS</strong> — Net Promoter Score, −100 to +100. A <em>detractor</em> is a respondent scoring 0–6.\n" +
        "• <strong>CSAT</strong> — satisfaction, usually stars on a closed ticket.\n" +
        "• <strong>SLA</strong> — the response or resolution time you promised. A breach is missing it.\n" +
        "• <strong>Escalation</strong> — a ticket pushed beyond first-line support.\n" +
        "• <strong>QA review</strong> — a scored audit of how an agent handled a contact.\n" +
        "• <strong>Blast radius</strong> — how many distinct accounts a problem actually touched. Counted, never estimated.\n" +
        "• <strong>Signal source</strong> — one connected system feeding the engine.\n\n" +
        "Ask me about any one of them and I will go deeper."
    },

    /* ---------- Conversational furniture ---------- */
    {
      id: "identity",
      title: "what I am",
      hidden: true,
      keys: ["who are you", "what are you", "your name", "what is your name", "are you a bot", "are you human", "are you real", "are you a robot", "rio", "what can you do", "are you an ai", "are you chatgpt", "what model are you", "are you a person"],
      answer:
        "I am <strong>Rio</strong>, the OpsPulse product expert. Think of me as the product's own specialist on call.\n\n" +
        "I run a small natural-language layer right here in your browser: I read your question, strip the filler, forgive a typo or two, work out what you actually meant, and answer from authored, verifiable copy. I am not a cloud LLM, and that is deliberate — OpsPulse refuses to generate numbers it cannot trace, so its assistant refuses to generate answers it cannot stand behind.\n\n" +
        "What that buys you: I will never invent a price, a customer, an integration or a certification. What it costs you: if you ask me something genuinely outside the product, I will say so rather than improvise.\n\n" +
        "Ask me anything about OpsPulse — or say <strong>teach me</strong> and I will take you through the whole product from the beginning."
    },
    {
      id: "help",
      title: "what you can ask me",
      hidden: true,
      keys: ["what can i ask", "help", "what do you know", "topics", "what should i ask", "options", "menu", "guide me", "where do i start", "i dont know what to ask", "what now"],
      answer:
        "Ask in your own words — full questions work better than keywords. The ground I cover:\n\n" +
        "• <strong>The product</strong> — what it is, the problem, the five layers, every screen.\n" +
        "• <strong>The engine</strong> — the nine detectors, baselines, thresholds, the statistics, root cause, confidence, ranking.\n" +
        "• <strong>The numbers</strong> — how impact is costed, why it is a range, what stays deliberately uncosted, how to open the evidence.\n" +
        "• <strong>The ledger</strong> — decisions, snapshots, and what happened at renewal.\n" +
        "• <strong>Trying it</strong> — the live demo, uploading your own CSV, the agent tools.\n" +
        "• <strong>Commercials</strong> — pricing, contracts, the design partner programme, setup time, security, the roadmap, the team.\n\n" +
        "Or say <strong>teach me</strong> and I will walk the whole thing in eight short lessons, start to end."
    },
    {
      id: "greeting",
      title: "an introduction",
      hidden: true,
      keys: ["hi", "hello", "hey", "good morning", "good afternoon", "good evening", "yo", "howdy", "greetings", "hiya", "sup", "namaste"],
      answer:
        "Hello. I am <strong>Rio</strong>, the OpsPulse product expert.\n\n" +
        "Ask me anything: what the product does, how the engine reaches a verdict, what it costs, how it handles your data, or what happens when it gets something wrong.\n\n" +
        "If you would rather be walked through it properly, say <strong>teach me</strong> and I will start from the beginning."
    },
    {
      id: "thanks",
      title: "a send-off",
      hidden: true,
      keys: ["thanks", "thank you", "cheers", "appreciate", "helpful", "great", "perfect", "awesome", "nice one", "cool", "bye", "goodbye", "see you", "later", "ok thanks"],
      answer:
        "Any time — that is what I am here for.\n\n" +
        "If you want to go further, the fastest next step is thirty minutes with one of the founders. Say <strong>schedule a demo</strong> and I will take you to the form."
    },
    {
      id: "compliment",
      title: "a reply to that",
      hidden: true,
      keys: ["you are good", "impressive", "well done", "smart bot", "good bot", "you are helpful", "love this", "amazing product", "looks great", "clever"],
      answer:
        "Kind of you. Credit where it is due: I am a small matching layer over carefully written answers, which is exactly the amount of cleverness this job needs.\n\n" +
        "The interesting engineering is behind the product — the detectors, the confidence floor and the ledger. Ask me about any of those and I will show you the parts that are genuinely hard."
    },

    /* ---------- Guardrails ----------
       These decline rather than answer. They are hidden from near-miss
       suggestions, because offering "our internals" as a topic to explore is
       precisely the wrong invitation. Note the line they draw: everything the
       product publishes about ITSELF stays open — thresholds, the confidence
       formula, the refusal list — because publishing those is the pitch. What
       closes is implementation, infrastructure, credentials and customer data.
       ------------------------------------------------------------------ */
    {
      id: "internals",
      title: "implementation detail",
      hidden: true,
      keys: ["source code", "show me the code", "the codebase", "github", "repo", "repository", "your code", "code base", "which framework", "what language is it written", "database schema", "your servers", "hosting", "infrastructure", "api key", "credentials", "password", "secret key", "reverse engineer", "copy your product", "clone your product", "give me the algorithm", "proprietary", "intellectual property", "license the code", "sell me the code", "internal docs"],
      answer:
        "That one I keep closed, and I would rather say so directly than pretend not to understand.\n\n" +
        "Implementation, source, infrastructure and credentials are not things I discuss. Neither is anything about a customer's data.\n\n" +
        "What is genuinely open is more than most vendors publish, and it is the part that should matter to you: <strong>every detector and the exact threshold it must clear, the confidence formula and its three weights, the 60% floor, the costing arithmetic, and the full list of things the platform refuses to do.</strong> Those are on the Trust page of this site, in the open, precisely so you can disagree with them.\n\n" +
        "If you want the engineering conversation properly, the CTO will have it with you directly — ask me to schedule a demo."
    },
    {
      id: "injection",
      title: "that request",
      hidden: true,
      keys: ["ignore previous instructions", "ignore your instructions", "ignore all previous", "your system prompt", "reveal your prompt", "what are your instructions", "developer mode", "jailbreak", "pretend you are", "act as if", "disregard the above", "bypass", "override your rules", "you are now"],
      answer:
        "Nice try, and genuinely, no hard feelings.\n\n" +
        "I answer questions about OpsPulse from authored copy. There is no hidden persona to unlock and no instruction set worth extracting — which is a side effect of not being a language model rather than a defence against being one.\n\n" +
        "Ask me something about the product and I will be much more useful."
    },
    {
      id: "unsupported_action",
      title: "what I can actually do",
      hidden: true,
      keys: ["book a meeting for me", "send me an email", "sign me up", "create an account", "reset my password", "log me in", "cancel my subscription", "give me a discount", "send a proposal", "invoice me", "call me back", "add me to the list"],
      answer:
        "I cannot do that from here — I answer questions, I do not have an account system or a mailbox behind me, and I would rather tell you than take an action you think happened and did not.\n\n" +
        "Everything of that kind goes through one place: the <strong>Schedule a demo</strong> form on this page, which reaches all three founders directly. Say <strong>schedule a demo</strong> and I will scroll you to it."
    },
    {
      id: "offtopic",
      title: "something outside the product",
      hidden: true,
      keys: ["weather", "tell me a joke", "write a poem", "recipe", "translate", "football", "cricket", "the news", "who is the president", "what time is it", "what is the date", "sing", "story", "movie", "song", "capital of", "how do i write python", "javascript help", "fix my code", "do my homework", "solve this equation", "math problem", "who won", "stock price", "bitcoin", "your opinion on"],
      answer:
        "That is outside my patch, and I will not pretend otherwise — I am the product expert for OpsPulse, not a general assistant. I do not have a model behind me that could improvise an answer, which is the same design decision that stops me inventing a price.\n\n" +
        "What I am genuinely good at is everything about this product: what it does, how the engine reaches a verdict, what it costs, how your data is handled, and what happens when it gets something wrong.\n\n" +
        "Try me on one of those — or say <strong>teach me</strong> and I will start from the beginning."
    }
  ];

  /* ==================================================================
     THE COURSE — "teach me", eight lessons, start to end
     ------------------------------------------------------------------
     A visitor who wants to be taught is in a different mode from one
     hunting a fact: they want an order imposed on the material, not a
     search box. So the course is authored as its own sequence rather than
     stitched out of the topic answers, because the ordering is the value —
     each lesson is written knowing exactly what the previous one
     established, which is the one thing a knowledge base cannot do.

     Advancing is by typing "next". Deliberately not by a button: the
     suggested-question rail is offered once, with the opening line, and
     re-introducing a chip mid-conversation would walk that back.
     ================================================================== */
  var COURSE = [
    {
      title: "Lesson 1 of 8 · The problem",
      body:
        "Mid-market SaaS companies find out an account is leaving <strong>on the renewal call</strong>. The decision was made weeks earlier, and the evidence was sitting in their own systems the whole time.\n\n" +
        "It is not a data problem, it is a <em>reading</em> problem. The signals exist — tickets, calls, QA reviews, survey verbatims, usage — but they live in four tools that never speak, and the person who would notice carries eighty accounts.\n\n" +
        "The industry's answer was the health score: one number per account, red/amber/green. It failed for a specific reason worth holding on to — <strong>a number nobody can decompose is a number nobody argues with, and a number nobody argues with is a number nobody acts on.</strong>\n\n" +
        "Everything in this product follows from taking that failure seriously."
    },
    {
      title: "Lesson 2 of 8 · The shape of the answer",
      body:
        "OpsPulse is a <strong>decision engine</strong>, not a dashboard. The distinction is concrete: a dashboard hands you the charts and leaves the judgement to you; a decision engine does the ranking itself and shows you its working.\n\n" +
        "Five stages, each constrained by the one before it:\n\n" +
        "<strong>1 · Data.</strong> Every signal lands on one account timeline.\n" +
        "<strong>2 · Detect.</strong> Nine statistical detectors compare a recent window against your own baseline.\n" +
        "<strong>3 · Understand.</strong> The change is decomposed into factors that sum to the whole.\n" +
        "<strong>4 · Act.</strong> Findings are ranked, each with a named play and a named owner.\n" +
        "<strong>5 · Verify.</strong> The same signals are re-read at renewal to report whether it worked.\n\n" +
        "Hold on to stage 5. Most tools stop at 4, and that is why nobody can tell you whether last quarter's interventions did anything."
    },
    {
      title: "Lesson 3 of 8 · Detection is arithmetic",
      body:
        "This is the load-bearing lesson. <strong>Nothing is predicted. Things are measured.</strong>\n\n" +
        "Nine detectors each compare a recent window against that account's, category's or cohort's own prior behaviour, and each has a stated bar: escalation spikes and SLA breaches on two-proportion z-tests at z ≥ 2.5, QA cohort gaps on a Welch t-test at ≥ 8 points, backlog growth as a slope of ≥ 3 tickets a day, NPS on a fall of ≥ 8 points, and so on. Underneath all of them, a <strong>minimum of 40 recent records</strong> before anything at all is raised.\n\n" +
        "Two consequences fall out of that, and both are the point:\n\n" +
        "• A quiet week produces an <strong>empty feed</strong> rather than invented findings.\n" +
        "• Every finding is <strong>a test you can re-run</strong>. The threshold is published, the inputs are on the card.\n\n" +
        "No model is involved in any of this. A model that decides what is wrong cannot be audited — you can only ask it again and hope."
    },
    {
      title: "Lesson 4 of 8 · Reading a finding",
      body:
        "A finding is not a sentence, it is a <strong>structure</strong>, and every part of it opens.\n\n" +
        "The headline states what moved and by how much. Under it sit the records that produced the number — the actual tickets, reviews and survey responses — one click away. Quotes carry the id of the record they came from, and <strong>a passage that cannot be traced to a record is not shown at all</strong>: an unattributable quote is worse than no quote, because it is the one thing on screen a reader cannot check.\n\n" +
        "Counts are counted, not estimated. When the product says a problem touched 231 accounts, that is a distinct-account count you can drill into and list — a fact, not a caption.\n\n" +
        "Nothing reaches the screen as free text. Every insight is validated against a contract first, and if that validation fails, the product prints the violations rather than rendering a card with a hole in it."
    },
    {
      title: "Lesson 5 of 8 · Cause, and how sure we are",
      body:
        "Detection says <em>what</em> changed. This stage asks <em>why</em> — and it is where most tools start making things up.\n\n" +
        "The method is <strong>decomposition</strong>: split the observed change across a dimension so the parts sum to the whole, name the largest slice, then correlate the day the change began against operational events in the same domain — releases, policy changes, staffing. It will not tell you a story that does not add up to the number.\n\n" +
        "The result is labelled a <strong>hypothesis</strong>, permanently, because decomposition can prove where a change is concentrated but not why that area moved. A human who knows the account closes that gap.\n\n" +
        "Attached to it is a confidence score with its parts visible: <strong>45%</strong> statistical strength, <strong>30%</strong> how much the top driver explains, <strong>25%</strong> corroboration from independent signals. Below <strong>60%</strong> it is held for review and never auto-actioned — and you can see which component is dragging it down, which tells you what would raise it."
    },
    {
      title: "Lesson 6 of 8 · What it is worth",
      body:
        "Now the number an executive actually asks for, and the two disciplines that make it survivable.\n\n" +
        "<strong>Impact is always a range, with its arithmetic on the card.</strong> The inputs are rounded to display precision first and the range computed from the rounded values, so the printed inputs genuinely multiply out to the printed range — you can check it on your phone. The widest uncertainty is named out loud: the conversion band is a <em>stated assumption</em>, not a measurement, and the card says which is which. A point estimate would be more persuasive and less true.\n\n" +
        "<strong>And some exposures carry no dollar figure at all.</strong> Compliance risk is reported as open statutory requests and days to deadline, is never converted to money, and is excluded from the revenue-at-risk total. A fabricated fine probability would be the least defensible number on the page — it is a legal question, not a statistical one.\n\n" +
        "That refusal costs a bigger headline number. It buys the credibility of every number beside it."
    },
    {
      title: "Lesson 7 of 8 · Deciding, and being held to it",
      body:
        "A recommendation is not a decision. A <strong>decision</strong> is a human committing to a play on an account, on stated evidence, at a stated confidence — and that is what the Renewal Decision Ledger records.\n\n" +
        "At the moment of commitment it <strong>snapshots the evidence as it stood</strong>: severity, confidence, the metric. Later engine passes cannot back-date any of it. If you committed below the confidence floor, the row says so.\n\n" +
        "Then the same signals are re-read on every pass, and the outcome is reported by the renewal date: cleared, improving, holding, or worse than when you started — including the accounts that churned anyway.\n\n" +
        "The property that makes this worth building is an odd one to sell: it means the platform <strong>can be shown to have been wrong</strong>. A tool that only remembers its wins is a tool you cannot forecast with. This is what turns \"our health score said red\" into a renewal forecast a board will accept."
    },
    {
      title: "Lesson 8 of 8 · Seeing it for yourself",
      body:
        "That is the whole loop: signals in, detection by arithmetic, cause as a hypothesis with published confidence, exposure as a range, a decision on the record, and the outcome measured at renewal.\n\n" +
        "Three ways to check any of it rather than take my word:\n\n" +
        "• <strong>The live demo.</strong> Source system on the left, decision engine on the right, one shared store so they cannot disagree. Nothing to install.\n" +
        "• <strong>Your own export.</strong> Drop a CSV into Data Upload and the same nine detectors run against your rows, in your browser, with nothing uploaded anywhere.\n" +
        "• <strong>The Trust page.</strong> Every detector's threshold, the confidence weights, and the full list of things the platform refuses to do — published so you can disagree with them.\n\n" +
        "Commercially, the honest state of it: priced on the <strong>renewal book and never per seat</strong>, on two axes — signal sources and ledger retention. <strong>No list price published yet</strong>, because pricing discovery with the first design partners is still running and I will not invent one. Partner terms are agreed per partner on the first call.\n\n" +
        "That is the course. Ask me anything from it in more depth, or say <strong>schedule a demo</strong> for thirty minutes with a founder."
    }
  ];

  var OPENING = {
    answer:
      "Hi, I am <strong>Rio</strong> 👋, the product expert for OpsPulse. Ask me anything — what it does, how the engine reaches a verdict, pricing, integrations, security, what happens when it gets something wrong.\n\n" +
      "Ask in your own words; I read full questions, not just keywords. I run on the product's own honesty rule, so I never invent an answer: if I do not know, I say so and hand you to a human.\n\n" +
      "New to it? Say <strong>teach me</strong> and I will take you through the whole product in eight short lessons.",
    /* The chips are an entry ramp for a visitor who has not yet decided what to
       ask, and they are deliberately shown ONCE. Re-offering a fresh set after
       every answer turns a conversation into a menu — it implies those three
       are the questions Rio can handle, when the whole point of the language
       layer is that it reads a real question typed in the visitor's own words.
       It also costs two permanent rows of panel height on a phone, where the
       answer itself needs the room. Once the visitor has asked anything, the
       rail goes for the rest of the session and the composer is the only way
       on. */
    chips: ["Teach me OpsPulse", "How is this different from a health score?", "What does it cost?", "What is the design partner programme?"]
  };

  /* ==================================================================
     THE NATURAL-LANGUAGE LAYER
     ------------------------------------------------------------------
     Small, explainable, on-device. It does the things an NLP front end
     does — lowercase and depunctuate, drop filler, expand synonyms, stem,
     forgive a typo — and scores meaning three ways:

       1 · phrase intent   a multi-word key found verbatim is the strongest
                           signal ("how much" ≫ a stray "how").
       2 · keyword overlap distinctive words shared with a topic, exact
                           first, then stemmed, then fuzzy, each worth less
                           than the last.
       3 · the ladder      what happens when nothing clears the bar, which
                           matters more than the scoring does. See reply().
     ================================================================== */

  /* Words that appear in almost every question and so carry no intent. Kept
     out of the vocabulary on both sides — the visitor's tokens and the topic's
     — so matching turns on the words that actually distinguish one subject
     from another. */
  var STOPWORDS = {
    the:1, a:1, an:1, and:1, or:1, of:1, to:1, in:1, on:1, at:1, for:1, with:1,
    is:1, are:1, was:1, be:1, been:1, do:1, does:1, did:1, can:1, could:1,
    would:1, should:1, will:1, i:1, you:1, we:1, they:1, it:1, this:1,
    that:1, my:1, your:1, our:1, me:1, us:1, as:1, if:1, so:1, but:1, from:1,
    about:1, into:1, up:1, out:1, please:1, just:1, tell:1, give:1, some:1,
    any:1, there:1, here:1, use:1, using:1, get:1, got:1, make:1, made:1,
    need:1, want:1, know:1, see:1, thing:1, things:1, really:1, actually:1,
    guys:1, ok:1, okay:1, yeah:1, well:1, like:1, much:1, many:1,
    then:1, though:1, anyway:1, basically:1, exactly:1, again:1, else:1,
    even:1, still:1, sort:1, kind:1,
    /* Typed without the apostrophe, these arrive as content words and score
       against whichever topic happens to use one in a key. They are question
       words wearing a disguise, so they join the question words above. */
    whats:1, hows:1, whys:1, whos:1, wheres:1, whens:1, whichs:1, dont:1, doesnt:1,
    /* The question words earn their place on this list the hard way. Left in
       the vocabulary, a bare "how" in "how many tabs can I open" scores a free
       exact hit against every "how does it work" key and drags the question
       onto the wrong topic. They cost nothing to drop, because MULTI-WORD KEYS
       ARE MATCHED AGAINST THE RAW NORMALISED SENTENCE, which still contains
       them — "how much" and "who built" keep working exactly as before. */
    how:1, what:1, why:1, when:1, where:1, who:1, whom:1, which:1, whose:1
  };

  /* One-way expansion of the VISITOR's vocabulary into the knowledge base's.
     A visitor says "churn"; the topics say "renewal". A visitor says "dear";
     the topics say "price". Rather than bloat every key list with every
     synonym — which makes the lists unreadable and quietly inflates scores —
     the visitor's tokens are expanded once, here, at read time.

     Expansion ADDS tokens rather than replacing them, because the original
     word is often the better match somewhere else in the base. */
  var SYNONYMS = {
    churn: ["renewal", "risk"], churning: ["renewal", "risk"], attrition: ["renewal", "churn"],
    leaving: ["churn", "renewal"], cancel: ["churn", "contract"], retention: ["renewal", "ledger"],
    dear: ["price"], cheap: ["price"], pricey: ["price"], costly: ["price"], charge: ["price"],
    pay: ["price"], payment: ["price"], money: ["price"], spend: ["price"], licence: ["price"],
    license: ["price"], quote: ["price"], discount: ["price"], deal: ["price"],
    hook: ["integrate"], hooks: ["integrate"], sync: ["integrate"], feed: ["source"],
    system: ["source"], tool: ["source"], tools: ["source"], stack: ["source"],
    accurate: ["confidence", "accuracy"], correct: ["accuracy"], right: ["accuracy"],
    proof: ["evidence"], proven: ["evidence"], backing: ["evidence"], cite: ["evidence"],
    citation: ["evidence"], receipts: ["evidence"], audit: ["ledger", "evidence"],
    detect: ["detector"], detecting: ["detector"], find: ["detector"], finds: ["detector"],
    spot: ["detector"], catch: ["detector"], flag: ["detector"], alert: ["detector"],
    dashboard: ["different"], report: ["different"], reporting: ["different"],
    scoring: ["health", "confidence"], score: ["health", "confidence"],
    teach: ["teach"], learn: ["teach"], tutorial: ["teach"], course: ["teach"],
    onboard: ["setup"], implement: ["setup"], rollout: ["setup"], migrate: ["setup"],
    gdpr: ["security", "compliance"], hipaa: ["security"], breach: ["security"],
    hack: ["security"], leak: ["security"], encrypt: ["security"],
    startup: ["scale"], smb: ["scale"], enterprise: ["scale"],
    demo: ["demo"], trial: ["partner"], poc: ["partner"], pilot: ["partner"],
    founder: ["team"], ceo: ["team"], cto: ["team"], cbo: ["team"], company: ["team"],
    llm: ["ai"], gpt: ["ai"], model: ["ai"], ml: ["ai"], neural: ["ai"],
    bug: ["wrong"], broken: ["wrong"], fails: ["wrong"], failure: ["wrong"],
    slow: ["performance"], fast: ["performance"], speed: ["performance"]
  };

  /* Crude, deliberately conservative stemmer. It exists so "detectors",
     "detected" and "detecting" all reach the same term, and it is applied to
     BOTH sides so the two vocabularies stay comparable. It is not linguistics
     — it is three suffix rules with length guards, chosen because the failure
     mode of over-stemming (collapsing genuinely different words) is worse here
     than the failure mode of under-stemming (a missed match that the fuzzy
     pass usually catches anyway). */
  function stem(t) {
    if (t.length > 5 && t.slice(-3) === "ing") return t.slice(0, -3);
    if (t.length > 4 && t.slice(-2) === "ed") return t.slice(0, -2);
    if (t.length > 3 && t.slice(-1) === "s" && t.slice(-2) !== "ss") return t.slice(0, -1);
    return t;
  }

  function tokenise(s) {
    var raw = String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/);
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var t = raw[i];
      if (t && t.length > 1 && !STOPWORDS[t]) out.push(t);
    }
    return out;
  }

  /* The visitor's tokens, plus whatever those tokens imply. */
  function expand(tokens) {
    var out = tokens.slice();
    for (var i = 0; i < tokens.length; i++) {
      var syn = SYNONYMS[tokens[i]];
      if (syn) for (var j = 0; j < syn.length; j++) if (out.indexOf(syn[j]) === -1) out.push(syn[j]);
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
     matching genuinely different words. */
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

  /* Precompute, once, each topic's phrase list and its distinctive keyword
     vocabulary — exact and stemmed. Deriving the vocabulary from the same keys
     the phrases come from means there is still one place to edit a topic's
     triggers. */
  INTENTS.forEach(function (intent) {
    var phrases = [];
    var terms = {};
    var stems = {};
    intent.keys.forEach(function (key) {
      var words = normalise(key).trim().split(" ");
      if (words.length > 1) phrases.push(" " + words.join(" ") + " ");
      tokenise(key).forEach(function (t) { terms[t] = 1; stems[stem(t)] = 1; });
    });
    intent._phrases = phrases;
    intent._termMap = terms;              /* exact lookup, the strongest tier */
    intent._terms = Object.keys(terms);   /* iterated only by the fuzzy pass */
    intent._stems = stems;
  });

  /* ── Inverse document frequency ────────────────────────────────────────
     How many topics claim each word. This is the fix for the failure mode
     that dominates a hand-built knowledge base: generic words leaking into
     every vocabulary and then deciding the match.

     "open" appears in the evidence topic (open the number), the partner topic
     (open now) and a couple more. On a flat score, "how many tabs can I open"
     ties on that single word and lands on whichever topic happens to sit
     earlier in the array — an ordering artefact, which is the worst kind of
     bug because it moves when you add a topic.

     So a word's weight falls as more topics claim it. A word unique to one
     topic is worth full marks; a word in five is worth a token gesture. It is
     ordinary IDF, computed once at load over a few hundred terms, and it means
     new topics can be added without re-tuning the ones already there. */
  var DF = {};
  INTENTS.forEach(function (intent) {
    intent._terms.forEach(function (t) { DF[t] = (DF[t] || 0) + 1; });
  });

  function idf(term) {
    var df = DF[term] || 1;
    if (df <= 2) return 1;
    if (df <= 4) return 0.6;
    return 0.3;
  }

  /* Precomputed per topic so the scorer does a lookup rather than a branch. */
  INTENTS.forEach(function (intent) {
    intent._weight = {};
    intent._terms.forEach(function (t) { intent._weight[t] = idf(t); });
    /* A stem inherits the best weight of any term that reduces to it, because
       "detector" and "detectors" are the same word and should not be scored as
       if one of them were vaguer than the other. */
    intent._stemWeight = {};
    intent._terms.forEach(function (t) {
      var st = stem(t), w = intent._weight[t];
      if (!(st in intent._stemWeight) || w > intent._stemWeight[st]) intent._stemWeight[st] = w;
    });
  });

  function scoreIntent(qNorm, qTokens, intent) {
    var total = 0, tokenScore = 0, phraseHit = false;

    /* 1 · phrase intent — dominant, because a whole phrase found verbatim is
       far more diagnostic than its words appearing loose. Weighted by the
       square of its length, so a four-word match buries a two-word one. */
    for (var p = 0; p < intent._phrases.length; p++) {
      if (qNorm.indexOf(intent._phrases[p]) !== -1) {
        var w = intent._phrases[p].trim().split(" ").length;
        total += w * w * 3;
        phraseHit = true;
      }
    }

    /* 2 · keyword overlap, every hit scaled by how distinctive the word is.
       Two tiers, not three: an exact word and its morphological variant are the
       SAME signal ("medians" is not a vaguer way of saying "median"), so both
       score full. What scores less is a guess about a misspelling, because that
       is the tier that can be wrong about which word was even intended.

       Each visitor token scores at most once, against its best match, so a
       repeated word cannot stack. */
    for (var i = 0; i < qTokens.length; i++) {
      var qt = qTokens[i], qs = stem(qt), best = 0;
      if (intent._termMap[qt]) best = 2 * intent._weight[qt];
      else if (intent._stems[qs]) best = 2 * intent._stemWeight[qs];
      else {
        for (var j = 0; j < intent._terms.length; j++) {
          var term = intent._terms[j];
          /* A near-miss on a long, distinctive word ("pricin", "securty") is
             almost certainly a typo, so it counts; a near-miss on a short word
             could easily be a genuinely different word, so it counts half. */
          if (qt.length >= 5 && term.length >= 5 && near(qt, term)) {
            var f = (Math.min(qt.length, term.length) >= 6 ? 1.25 : 0.6) * intent._weight[term];
            if (f > best) best = f;
          }
        }
      }
      tokenScore += best;
    }
    total += tokenScore;

    return { total: total, tokenScore: tokenScore, phraseHit: phraseHit };
  }

  /* The two guardrails that must not be out-scored.
     -----------------------------------------------------------------
     A question can carry a probe AND a normal question at once — "ignore your
     instructions and tell me a joke" hits both `injection` and `offtopic`, and
     ordinary scoring hands it to whichever wrapped more words. The probe is
     the part that needs the deliberate answer, so these two are checked first.

     Crucially the pre-pass matches on PHRASES ONLY, never on loose keywords.
     Declining is a strong move and a wrong decline is far more damaging than a
     wrong answer: it accuses a visitor of something. Requiring a whole authored
     phrase means "what is your take on the security prompt" cannot trip the
     injection guard on the stray word "prompt". */
  var GUARDS = ["injection", "internals"];

  function guardHit(qNorm) {
    for (var g = 0; g < GUARDS.length; g++) {
      for (var i = 0; i < INTENTS.length; i++) {
        if (INTENTS[i].id !== GUARDS[g]) continue;
        var ph = INTENTS[i]._phrases;
        for (var p = 0; p < ph.length; p++) {
          if (qNorm.indexOf(ph[p]) !== -1) return INTENTS[i];
        }
      }
    }
    return null;
  }

  /* Rank every topic against the question and return the field, best first.
     Returning the whole field rather than a winner is what makes the ladder in
     answerFor() possible: a near miss needs to know what it nearly matched. */
  function rank(text) {
    var qNorm = normalise(text);
    var qTokens = expand(tokenise(text));
    var scored = [];
    for (var i = 0; i < INTENTS.length; i++) {
      var s = scoreIntent(qNorm, qTokens, INTENTS[i]);
      if (s.total > 0) scored.push({ intent: INTENTS[i], s: s });
    }
    scored.sort(function (a, b) { return b.s.total - a.s.total; });
    return scored;
  }

  /* The acceptance bar: answer on a real phrase hit, or on enough keyword
     weight (one distinctive exact word plus something, or two softer signals).
     A lone fuzzy guess is not enough — below the bar Rio would rather offer the
     nearest topics by name than answer the wrong question confidently. */
  function accepted(s) {
    return s.phraseHit || s.tokenScore >= 2;
  }

  /* ------------------------------------------------------------------
     Conversation state. Three small pieces, and each earns its place.
     ------------------------------------------------------------------ */
  var lastIntent = null;    /* what "tell me more" and "why?" attach to */
  var courseStep = -1;      /* -1 = not in the course; otherwise the next lesson */
  var askedCount = 0;       /* only used to stop repeating the same nudge */

  /* Bare follow-ups. These carry no subject of their own — their subject is
     whatever was just said — so they are matched separately, BEFORE the
     scorer runs. Sending "why?" through keyword matching would score it
     against nothing and drop a perfectly ordinary conversational turn into the
     fallback. */
  var FOLLOWUP = /^(why|why is that|why though|how|how so|how come|and|so|ok so|really|and then|tell me more|more|more detail|go on|go deeper|explain|explain that|elaborate|expand|example|for example|such as|prove it|says who|source|and\?|meaning|what do you mean|i dont understand|i don t understand|dont understand|unclear|confused)\??$/;
  var ADVANCE = /^(next|next lesson|continue|carry on|go on|keep going|next one|ok next|yes|yep|sure|please|ok)\??$/;
  var TEACH = /(teach me|from scratch|from the beginning|start from the|explain everything|full tour|guided tour|take me through (it|the product|everything|opspulse)|walk me through (it|the product|everything|opspulse)|show me everything|the course|tutorial|onboard me|explain the whole|whole product)/;
  var STOP_COURSE = /^(stop|quit|exit|enough|no thanks|cancel|end|stop the course|skip)\??$/;

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
    '<div class="cw-panel" id="cwPanel" role="dialog" aria-label="' + BOT_NAME + ', the OpsPulse product expert" hidden>' +
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
    /* Rio's own turns carry the little mark, so a long thread still reads at a
       glance as a conversation with a named assistant rather than an anonymous
       stack of grey boxes. The visitor's turns do not. */
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

  /* Answers are authored with \n for paragraph breaks and a small, fixed set of
     inline tags. Escaping first and then re-allowing only <strong> and <em>
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
       enumerates detectors or plans reads as a list rather than a stack of
       loose paragraphs. Everything else stays a paragraph. */
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

  /* Retire the suggestions for good — see the note on OPENING. Emptying the
     rail removes it from the layout as well as from view, because
     `.cw-chips:empty` is display:none; leaving the element in place keeps the
     panel's flex column exactly as it was rather than rebuilding it. */
  function clearChips() {
    chipBar.innerHTML = "";
  }

  /* A short delay before the reply so the exchange reads as a conversation
     rather than an instant lookup — skipped entirely when the visitor has asked
     for reduced motion, along with the animated dots. */
  function say(text) {
    var typing = bubble("bot", '<span class="cw-typing"><i></i><i></i><i></i></span>');
    var wait = reduceMotion.matches ? 0 : 380;
    setTimeout(function () {
      typing.remove();
      bubble("bot", render(text));
      log.scrollTop = log.scrollHeight;
    }, wait);
  }

  /* ==================================================================
     THE LADDER
     ------------------------------------------------------------------
     What Rio does when it is NOT confident is the part that decides
     whether the widget feels intelligent or feels like a search box that
     failed. In order:

       1 · a confident match          → answer it
       2 · a second strong candidate  → answer, then name the other topic
       3 · a near miss                → name the closest topics; do not guess
       4 · nothing at all             → say so plainly, hand to a human

     Steps 2 and 3 are why rank() returns the whole field. A visitor who
     asked a slightly-off question does not want "I don't know" — they want
     "I think you might mean X", which is the same courtesy a human expert
     extends without thinking about it.
     ================================================================== */
  function byId(id) {
    for (var i = 0; i < INTENTS.length; i++) if (INTENTS[i].id === id) return INTENTS[i];
    return null;
  }

  /* The single routing decision, shared by the answer path and by the test
     seam below. Returns the topic Rio is confident about, or null to hand the
     caller down to the ladder. Keeping it in one function is what stops the
     harness from asserting a route the visitor never actually takes. */
  function resolve(text) {
    var guard = guardHit(normalise(text));
    if (guard) return guard;

    var field = rank(text);
    if (field[0] && accepted(field[0].s)) return field[0].intent;

    /* Last resort before the ladder: a question made entirely of function
       words — "so what does this actually do", "and what is it then" — has no
       content token for the scorer to work with and matched no phrase. That is
       not a failure to understand. It is the most general question there is,
       and it has a most general answer.

       This has to sit AFTER scoring, not before it: "who are you" is also made
       entirely of function words, and it matches an authored phrase. Checked
       first, it would answer every visitor's opening question with the product
       overview instead of the introduction they asked for. */
    if (!tokenise(text).length) return byId("what");
    return null;
  }

  function answerFor(text) {
    var hit = resolve(text);
    var field = rank(text);

    if (hit) {
      lastIntent = hit;
      var body = hit.answer;
      var top = field[0];

      /* A genuinely two-part question — "what does it cost and how long does
         setup take" — scores two topics highly. Answering the first and
         silently dropping the second is the most annoying thing a bot does, so
         name the other one rather than pretending it was not asked. */
      var second = field[1];
      if (top && second && !second.intent.hidden && !hit.hidden && top.intent === hit &&
          second.s.total >= top.s.total * 0.6 && second.s.total >= 4) {
        body += "\n\nYou also touched on <strong>" + second.intent.title + "</strong> — ask me and I will take that next.";
      }
      return body;
    }

    /* A near miss: something scored, nothing convincingly. Name the closest
       one or two topics rather than guessing at the answer. */
    var candidates = [];
    for (var i = 0; i < field.length && candidates.length < 2; i++) {
      if (!field[i].intent.hidden && field[i].s.total >= 2) candidates.push(field[i].intent.title);
    }
    if (candidates.length) {
      var list = candidates.length === 1
        ? "<strong>" + candidates[0] + "</strong>"
        : "<strong>" + candidates[0] + "</strong> or <strong>" + candidates[1] + "</strong>";
      return "I am not confident I understood that one, and I would rather check than answer the wrong question.\n\n" +
        "The closest ground I have is " + list + ". If that is what you meant, ask me directly and I will go properly into it. If it is not, try rephrasing — I read full sentences better than keywords.";
    }

    /* Nothing at all. The refusal is the most on-brand behaviour in the widget:
       the product's own confidence floor, applied to its own marketing. */
    return "That one is outside what I can answer with confidence, and I would rather tell you than guess. OpsPulse refuses to invent numbers, so I refuse to invent answers.\n\n" +
      "I cover the product itself — the engine, the detectors, the evidence, the ledger, pricing, security, the roadmap and the team. Say <strong>help</strong> and I will list what I know, or <strong>teach me</strong> and I will walk the whole thing from the beginning.\n\n" +
      "If your question needs a person, the founders answer personally: use the <strong>Schedule a demo</strong> form on this page and it reaches them directly.";
  }

  /* One lesson, plus the instruction for how to get the next one. The nudge is
     part of the lesson text rather than a button, so the course cannot
     re-introduce the suggestion rail the opening line retires. */
  function teach() {
    var lesson = COURSE[courseStep];
    var body = "<strong>" + lesson.title + "</strong>\n\n" + lesson.body;
    courseStep++;
    if (courseStep < COURSE.length) {
      body += "\n\nSay <strong>next</strong> for lesson " + (courseStep + 1) + ", or ask me anything about what I just covered.";
    } else {
      courseStep = -1;
    }
    return body;
  }

  function respond(q) {
    /* Course control comes first: while the visitor is being taught, "next"
       means the next lesson and nothing else. Outside the course "next" is an
       ordinary word that belongs to the roadmap topic, which is why this is
       gated on courseStep rather than matched globally. */
    if (courseStep >= 0) {
      if (ADVANCE.test(q.toLowerCase().trim())) return teach();
      if (STOP_COURSE.test(q.toLowerCase().trim())) {
        courseStep = -1;
        return "Stopped there — no need to sit through the rest.\n\nAsk me anything directly instead, or say <strong>teach me</strong> again if you want to pick the course back up from the beginning.";
      }
    }
    if (TEACH.test(q.toLowerCase())) { courseStep = 0; return teach(); }

    /* A bare follow-up has no subject of its own; its subject is the previous
       answer. Where the topic has a deeper cut, serve it. Where it does not,
       fall through to ordinary matching rather than padding — a topic with
       nothing more to say should admit it. */
    if (FOLLOWUP.test(q.toLowerCase().trim()) && lastIntent) {
      if (lastIntent.more) return lastIntent.more;
      return "I have given you what I hold on <strong>" + lastIntent.title + "</strong> — I would be padding if I went further, and padding is how a bot starts inventing.\n\n" +
        "Ask me something specific about it and I will answer that, or say <strong>teach me</strong> for the guided walk-through.";
    }

    return answerFor(q);
  }

  function submit(text) {
    var q = String(text || "").trim();
    if (!q) return;
    askedCount++;

    /* The visitor has now asked something, so the openers have done their job.
       Retiring them here rather than when the answer lands means the rail does
       not sit there through the typing indicator, still inviting a click on a
       question that is already being answered. */
    clearChips();

    /* "Schedule a demo" is navigation rather than a question — send the visitor
       to the thing itself instead of describing it back to them. */
    if (/^schedule a demo$/i.test(q) || /^(take me to |open |go to )?(the )?(demo|contact) form$/i.test(q)) {
      bubble("me", render(q));
      var target = document.getElementById("contact");
      if (target) {
        say("Taking you to the form now. It goes straight to the founders.");
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
    say(respond(q));
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
    ask: function (q) { if (panel.hidden) open(); submit(q); },

    /* A deliberate test seam. `tools/chatcheck.mjs` drives a corpus of a few
       hundred real-world phrasings through the matcher and asserts each lands
       on the right topic — which needs the topic id, not the rendered prose.
       Asserting on rendered text instead would make every copy edit break the
       harness, and a harness that breaks on copy edits is a harness people
       delete. It exposes nothing private: the whole knowledge base ships in
       this file and is readable by anyone who opens it. */
    match: function (q) {
      var hit = resolve(String(q || ""));
      return hit ? hit.id : null;
    },
    topics: function () { return INTENTS.map(function (i) { return i.id; }); }
  };
  /* Rio is the assistant's public name, so the rest of the page can open it or
     ask it a question under that name too. Same object, friendlier alias.
     `RioAI` was the name before the rename and is kept pointing at the same
     object, because a stale caller failing silently is worse than one extra
     line here. */
  window.Rio = window.OpsPulseChat;
  window.RioAI = window.OpsPulseChat;
})();
