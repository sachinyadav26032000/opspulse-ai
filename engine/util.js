'use strict';
/* ==========================================================================
   OpsPulse Decision Engine — shared utilities
   Pure functions. No side effects. Node + deterministic.
   ========================================================================== */

/** Seeded PRNG (mulberry32) — deterministic runs for reproducible briefs. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Small deterministic string hash → short hex (for stable ids). */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).slice(0, 4);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, d = 0) => { const p = Math.pow(10, d); return Math.round(v * p) / p; };
const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);
function std(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(sum(a.map((v) => (v - m) ** 2)) / (a.length - 1));
}

/**
 * Seasonality-aware detrend: remove the weekly (7-day) day-of-week effect
 * so a normal Monday spike doesn't read as an anomaly.
 * Returns a new series of residuals (value - weekday_mean + global_mean).
 */
function seasonalDetrend(series) {
  const g = mean(series.map((p) => p.value));
  const byDow = {};
  series.forEach((p) => { (byDow[p.t % 7] = byDow[p.t % 7] || []).push(p.value); });
  const dowMean = {};
  Object.keys(byDow).forEach((k) => { dowMean[k] = mean(byDow[k]); });
  return series.map((p) => ({ t: p.t, value: p.value - (dowMean[p.t % 7] - g) }));
}

/**
 * Rolling z-score of the trailing `window` observations vs the prior baseline.
 * Seasonality-adjusted. This is the core of the (deliberately statistical,
 * non-LLM) anomaly detector.
 */
function rollingZ(series, window = 3) {
  const adj = seasonalDetrend(series).map((p) => p.value);
  if (adj.length < window + 4) return { z: 0, observed: 0, baselineMean: 0, baselineStd: 0, direction: 'flat' };
  const observedArr = adj.slice(-window);
  const baseline = adj.slice(0, -window);
  const observed = mean(observedArr);
  const bMean = mean(baseline);
  const bStd = std(baseline) || 1e-9;
  const z = (observed - bMean) / bStd;
  return {
    z: round(z, 2),
    observed: round(observed, 2),
    baselineMean: round(bMean, 2),
    baselineStd: round(bStd, 2),
    direction: z > 0 ? 'up' : z < 0 ? 'down' : 'flat',
  };
}

/** Fixed-precision percent-change helper for narratives. */
function pctChange(from, to) { return from === 0 ? 0 : round(((to - from) / Math.abs(from)) * 100, 0); }

module.exports = { mulberry32, hash, clamp, round, sum, mean, std, seasonalDetrend, rollingZ, pctChange };
