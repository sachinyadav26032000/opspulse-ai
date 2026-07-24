/* ==========================================================================
   Seeded PRNG + sampling helpers.
   --------------------------------------------------------------------------
   Everything in the base dataset is generated from a single integer seed, so
   the same 90 days of history rebuilds byte-identically in every tab, on every
   reload, in Node and in the browser. That is what lets us persist a seed
   instead of 11,600 records (localStorage would blow its ~5MB quota).
   ========================================================================== */

/** mulberry32 — small, fast, good enough distribution for synthetic ops data. */
export function makeRng(seed) {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /** integer in [lo, hi] inclusive */
  rnd.int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  /** float in [lo, hi) */
  rnd.range = (lo, hi) => lo + rnd() * (hi - lo);
  /** uniform pick */
  rnd.pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  /** true with probability p */
  rnd.chance = (p) => rnd() < p;

  /** weighted pick — weights is {key: weight} or [[key, weight], …] */
  rnd.weighted = (weights) => {
    const pairs = Array.isArray(weights) ? weights : Object.entries(weights);
    let total = 0;
    for (const [, w] of pairs) total += w;
    let r = rnd() * total;
    for (const [k, w] of pairs) {
      r -= w;
      if (r <= 0) return k;
    }
    return pairs[pairs.length - 1][0];
  };

  /** Box–Muller normal */
  rnd.normal = (mean = 0, sd = 1) => {
    let u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  /** normal, clamped — for scores that live on a bounded scale */
  rnd.normalClamped = (mean, sd, lo, hi) =>
    Math.max(lo, Math.min(hi, rnd.normal(mean, sd)));

  /** lognormal — the right shape for handle time / resolution time */
  rnd.logNormal = (median, sigma) => median * Math.exp(rnd.normal(0, sigma));

  /** in-place Fisher–Yates */
  rnd.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  /** n distinct items from arr */
  rnd.sample = (arr, n) => rnd.shuffle(arr.slice()).slice(0, n);

  return rnd;
}

/**
 * Largest-remainder allocation: split `total` into buckets proportional to
 * `weights`, guaranteeing the parts sum EXACTLY to total. Used so "10,000
 * tickets" is really 10,000 and not 9,997.
 */
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const exact = weights.map((w) => (w / sum) * total);
  const base = exact.map(Math.floor);
  let remaining = total - base.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; remaining > 0; k++, remaining--) base[order[k % order.length].i]++;
  return base;
}
