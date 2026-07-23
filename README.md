# OpsPulse AI — Prototype

**The intelligence layer for customer operations.**

OpsPulse AI is an *AI Operations Copilot* for customer support & success teams. It
unifies operational signals — tickets, call transcripts, QA reviews and feedback —
into a single prioritized **decision feed**, detecting churn risk, SLA breaches and
coaching gaps *before* they escalate.

This repository is a **fully self-contained, dependency-free prototype**: pure
HTML / CSS / vanilla JS. No build step, no frameworks, no external runtime
dependencies. Just open `index.html`.

---

## ✨ What's inside

| Page | File | Description |
|------|------|-------------|
| **Landing site** | `index.html` | Investor-grade marketing page — problem, solution, product modules, use case, pricing, roadmap, vision. |
| **Ops Copilot Dashboard** | `app.html` | A working product demo: prioritized decision feed, root-cause drill-down, live-ticking signals, and a charts-heavy Analytics view. |

### Dashboard highlights
- **Decision Feed** — AI-scored risk cards with High / Medium / Resolved filters and live search.
- **Insight Explorer** — click any risk for root-cause analysis, contributing signals, and recommended actions (Assign / Coach / Escalate / Fix).
- **Live simulation** — streaming ingest ticker, ticking source counters, animated org-health gauge and KPI sparklines.
- **Analytics view** — 10 hand-rendered SVG charts (trend, stacked area, donut, histogram, sentiment heatmap, QA radar, leaderboard) with crosshair tooltips, 7d/30d/90d range switching, and accessible table toggles. Zero chart libraries.

---

## 🚀 Run it locally

**Option A — just open it**

```
Open index.html in your browser.
```

**Option B — serve it (recommended)**

```bash
# Python 3
python -m http.server 5500
# then visit http://localhost:5500/index.html
```

```bash
# or Node
npx serve .
```

---

## 🗂 Project structure

```
.
├── index.html          # Marketing / landing page
├── app.html            # Ops Copilot dashboard (live demo)
└── assets/
    ├── styles.css      # Shared design system
    ├── app.css         # Dashboard + analytics styles
    ├── app.js          # Dashboard engine + mock data
    ├── analytics.js    # Charts-heavy analytics view (SVG)
    └── landing.js      # Landing-page interactions
```

---

## 🎨 Notes

- **Design:** dark, "signal/pulse" themed SaaS aesthetic; a cyan→emerald brand gradient.
- **Charts:** built to the accessibility method — validated colorblind-safe categorical palette for multi-series charts, brand colors for single-series, no dual-axis, legends + direct labels throughout.
- **All data shown is simulated.** This is a prototype for demonstration.

---

*© 2026 OpsPulse AI · Prototype.*
