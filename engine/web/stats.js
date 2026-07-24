/* ==========================================================================
   Statistics — the part of the engine that is allowed to decide something.
   --------------------------------------------------------------------------
   Detection is statistical. Language models (or, offline, templates) only ever
   EXPLAIN what these functions already found. Nothing here consults a model,
   and nothing downstream may invent a number that did not come from here.
   ========================================================================== */

export const sum = (a) => a.reduce((x, y) => x + y, 0);
export const mean = (a) => (a.length ? sum(a) / a.length : 0);

export function sd(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(sum(a.map((v) => (v - m) ** 2)) / (a.length - 1));
}

export function quantile(a, q) {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export const median = (a) => quantile(a, 0.5);

/** Two-proportion z-test — the workhorse for "is this rate really different?" */
export function propZ(x1, n1, x0, n0) {
  if (!n1 || !n0) return { z: 0, p1: 0, p0: 0, se: 0 };
  const p1 = x1 / n1, p0 = x0 / n0;
  const p = (x1 + x0) / (n1 + n0);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n0));
  return { z: se ? (p1 - p0) / se : 0, p1, p0, se };
}

/** Welch's t — unequal variances, which is always the case with real cohorts. */
export function welchT(a, b) {
  if (a.length < 2 || b.length < 2) return { t: 0, diff: 0, ma: mean(a), mb: mean(b) };
  const ma = mean(a), mb = mean(b);
  const va = sd(a) ** 2 / a.length, vb = sd(b) ** 2 / b.length;
  const se = Math.sqrt(va + vb);
  return { t: se ? (ma - mb) / se : 0, diff: ma - mb, ma, mb, se };
}

/** z of a single observation against a baseline series. */
export function zAgainst(series, value) {
  const m = mean(series), s = sd(series);
  return { z: s ? (value - m) / s : 0, mean: m, sd: s };
}

/** Ordinary least squares slope over an index series (units: y per day). */
export function slope(ys) {
  const n = ys.length;
  if (n < 2) return 0;
  const xs = ys.map((_, i) => i);
  const mx = mean(xs), my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den ? num / den : 0;
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26) — for p-values on z. */
export function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (1.330274429 * t ** 4 - 1.821255978 * t ** 3 + 1.781477937 * t ** 2 - 0.356563782 * t + 0.319381530);
  return z > 0 ? 1 - p : p;
}
export const pValue = (z) => 2 * (1 - normCdf(Math.abs(z)));

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const pct = (v) => Math.round(v * 1000) / 10;
export const safeDiv = (a, b) => (b ? a / b : 0);

/**
 * Onset day: the first day in `window` where the metric clears baseline+kσ and
 * STAYS clear for `sustain` days. This is what we correlate releases against —
 * a single spiky day is noise, a sustained shift has a cause.
 */
export function onsetDay(series, baselineMean, baselineSd, { k = 1.5, sustain = 2, from = 0 } = {}) {
  const thr = baselineMean + k * (baselineSd || baselineMean * 0.15 || 1);
  for (let i = from; i <= series.length - sustain; i++) {
    let ok = true;
    for (let j = 0; j < sustain; j++) if (series[i + j] < thr) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}
