/* ==========================================================================
   Decision sizing — applied BEFORE ranking, on purpose.
   --------------------------------------------------------------------------
   Ranking on total ARR rewards unfocused decisions. Churn risk swept 59
   accounts for $1,283K and outranked silent decline's 6 accounts for $578K —
   not because it was more valuable, but because it was less specific. Breadth
   was being paid a premium.

   So the cut comes first. Every ARR-bearing decision is reduced to the
   accounts a human will actually work this week, its exposure is restated as
   what THOSE accounts carry, and only then does it compete. A decision is then
   ranked on what acting on it is worth, which is the only version of the
   question anyone actually asks.

   Nothing is discarded: the full matched set stays in `_meta.sizing` and the
   accounts remain in the feed and the workspace. The cut is declared, not
   hidden — see `note`.
   ========================================================================== */

export const DECISION_SIZE = 6;

/**
 * True when a decision is revenue-shaped.
 *
 * SEMANTIC, not structural. The previous test was "which file emitted this",
 * which tagged churn_risk as support-ops despite it naming accounts, carrying
 * the largest ARR exposure in the feed and being owned by VP Customer Success.
 * A decision is revenue-shaped when it puts named accounts and their ARR at
 * stake — queue depth, contact volume and QA scores do not, however urgent.
 */
export function isRevenueShaped(insight) {
  const m = insight?._meta;
  if (!m) return false;
  const arr = m.evidence?.arr_at_risk;
  return typeof arr === 'number' && arr > 0;
}

/**
 * Cut an insight to its actionable set and restate its economics accordingly.
 * Mutates the insight. No-op for decisions that carry no ARR exposure.
 */
export function applyDecisionSizing(insight, size = DECISION_SIZE) {
  const m = insight._meta;
  if (!m || !isRevenueShaped(insight)) return insight;

  // exposure.js has already ranked and cut these to the top `size` by ARR.
  const shown = m.exposed_accounts || m.accounts || [];
  if (!shown.length) return insight;

  const fullArr = m.evidence.arr_at_risk;
  const sizedArr = shown.reduce((s, a) => s + (a.arr_usd || 0), 0);
  if (!(sizedArr > 0) || !(fullArr > 0)) return insight;

  const matched = m.affected_accounts ?? shown.length;
  const ratio = Math.min(1, sizedArr / fullArr);

  /* Restate the money — INCLUDING the shown arithmetic.
     Rescaling expected_impact alone left _meta.impact describing the full ARR,
     so the card published $95K-$171K while the drill-down's formula multiplied
     out to $181K-$325K. The repo's first credibility rule is that the printed
     inputs genuinely produce the printed range; scaling one without the other
     breaks exactly that. The ARR input is scaled, then low/high are recomputed
     FROM the inputs so the two cannot drift again. */
  const im = insight._meta.impact;
  if (im && im.low != null && Array.isArray(im.inputs) && Array.isArray(im.range_factor)) {
    for (const inp of im.inputs) {
      // the input carrying the ARR is the one that tracks the full exposure
      if (typeof inp.value === 'number' && Math.abs(inp.value - fullArr) <= Math.max(1, fullArr * 0.001)) {
        inp.value = Math.round(inp.value * ratio);
        if (inp.display) inp.display = money(inp.value);
      }
    }
    const product = im.inputs.reduce((s, x) => s * x.value, 1);
    im.low = Math.round(product * im.range_factor[0]);
    im.high = Math.round(product * im.range_factor[1]);
    im.formula_full = im.formula;
    im.formula = `${money(product)} × ${im.range_factor.map((f) => Math.round(f * 100) + '%').join('–')} (scoped to ${shown.length} of ${matched} accounts)`;
    im.scoped_by_sizing = true;
  }

  const ei = insight.expected_impact;
  if (ei && ei.range_low_usd != null) {
    if (im && im.low != null) {
      // Publish exactly what the shown arithmetic produces.
      ei.range_low_usd = im.low;
      ei.range_high_usd = im.high;
    } else {
      ei.range_low_usd = Math.round(ei.range_low_usd * ratio);
      ei.range_high_usd = Math.round(ei.range_high_usd * ratio);
    }
    ei.revenue_at_risk_usd = Math.round((ei.range_low_usd + ei.range_high_usd) / 2);
  }

  const cut = Math.max(0, matched - shown.length);

  /* The book-ends come from the detector when it recorded them, NOT from
     `fullArr`. The revenue detectors set evidence.arr_at_risk to the SHOWN
     ARR — their economics are already scoped, which is why `ratio` is 1 for
     them — so deriving cut_arr as fullArr − sizedArr yields zero and prints
     "the remaining 17 hold $0". That read as correct for as long as every
     revenue detector matched exactly the six accounts it showed; the moment
     one matched more, the note started stating a falsehood. prioritise()
     already sums the true totals, so prefer them. */
  const prior = m.sizing || {};
  const totalArr = prior.total_arr ?? fullArr;
  const cutArr = prior.cut_arr ?? Math.max(0, fullArr - sizedArr);

  m.sizing = {
    matched,
    shown: shown.length,
    cut,
    total_arr: totalArr,
    shown_arr: sizedArr,
    cut_arr: cutArr,
    ratio,
    basis: 'revenue exposure, descending',
    note: cut
      ? `${matched} accounts matched. This decision is scoped to the ${shown.length} largest by ARR (${money(sizedArr)}); the remaining ${cut} hold ${money(cutArr)} and stay in the feed.`
      : `${matched} accounts matched — all in scope.`,
  };

  // The headline must describe what the decision is scoped to, not what the
  // detector swept, or the drill-down will contradict the card.
  m.evidence.arr_at_risk_full = fullArr;
  m.evidence.arr_at_risk_scoped = sizedArr;
  m.scoped_accounts = shown.length;

  /* Restate the headline to the scope. "Churn risk — 62 accounts" beside a
     $285K figure derived from 6 of them, opening onto a drill-down listing 6,
     is three different answers to the same question on one card. */
  if (cut > 0) {
    m.title_full = m.title;
    m.title = m.title.replace(/—\s*\d[\d,]*\s+accounts?/i, `— top ${shown.length} of ${matched} accounts`);
    if (m.title === m.title_full) m.title = `${m.title_full} — top ${shown.length} of ${matched}`;
    m.metric_label_full = m.metric_label;
    m.metric_label = `${money(sizedArr)} ARR across ${shown.length} accounts`;
  }

  return insight;
}

function money(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1000) return '$' + Math.round(n / 1000) + 'K';
  return '$' + Math.round(n);
}
