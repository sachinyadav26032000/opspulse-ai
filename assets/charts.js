/* ==========================================================================
   Chart primitives — hand-rendered SVG, no chart library.
   --------------------------------------------------------------------------
   Built to the accessibility method:
     · categorical palette assigned in FIXED slot order, never cycled, and
       validated (all six checks pass) against this app's dark surface #0e1425
     · one y-axis, always — no dual-axis chart exists in this codebase
     · thin marks, 4px rounded data-ends, 2px surface gaps between fills,
       recessive grid and axes
     · a legend whenever there are ≥2 series, plus selective direct labels
     · every chart carries a hover layer and a "Show data" table, so identity
       and value are never carried by colour alone
   ========================================================================== */

/* Validated dark steps. Run:
   node scripts/validate_palette.js "#3987e5,#d95926,#199e70,#c98500,#d55181" --mode dark --surface "#0e1425"
   → all checks pass (worst adjacent CVD ΔE 8.4, normal-vision 19.3, contrast ≥3:1) */
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'];
export const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' };
export const SEQ = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
export const INK = { primary: '#eaf0ff', secondary: '#aeb9d6', muted: '#737f9e', grid: 'rgba(255,255,255,.07)', axis: 'rgba(255,255,255,.16)', surface: '#0e1425' };

const W = 720;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

/* ── Shared tooltip ──────────────────────────────────────────────────────── */
let tip;
function tooltip() {
  if (!tip) { tip = el('div', 'viz-tip'); tip.hidden = true; document.body.appendChild(tip); }
  return tip;
}
function showTip(html, x, y) {
  const t = tooltip();
  t.innerHTML = html; t.hidden = false;
  const r = t.getBoundingClientRect();
  t.style.left = Math.min(window.innerWidth - r.width - 10, Math.max(8, x - r.width / 2)) + 'px';
  t.style.top = Math.max(8, y - r.height - 14) + 'px';
}
export function hideTip() { if (tip) tip.hidden = true; }

/* ── Formatters ──────────────────────────────────────────────────────────── */
export const fmt = {
  int: (v) => (v == null ? '—' : Math.round(v).toLocaleString('en-US')),
  one: (v) => (v == null ? '—' : v.toFixed(1)),
  pct: (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`),
  pct0: (v) => (v == null ? '—' : `${Math.round(v * 100)}%`),
  usd: (v) => (v == null ? '—' : '$' + Math.round(v).toLocaleString('en-US')),
  usdK: (v) => (v == null ? '—' : Math.abs(v) >= 1000 ? '$' + Math.round(v / 1000) + 'k' : '$' + Math.round(v)),
  nps: (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Math.round(v)}`),
  stars: (v) => (v == null ? '—' : v.toFixed(2) + '★'),
  min: (v) => (v == null ? '—' : Math.round(v) + 'm'),
  hrs: (v) => (v == null ? '—' : Math.round(v) + 'h'),
};

/* ── Figure shell: title, chart, legend, data table ──────────────────────── */
function figure({ title, subtitle, note, svg, legend, table, tall }) {
  const f = el('figure', 'viz' + (tall ? ' viz-tall' : ''));
  if (title) f.appendChild(el('figcaption', 'viz-head', `<span class="viz-title">${esc(title)}</span>${subtitle ? `<span class="viz-sub">${esc(subtitle)}</span>` : ''}`));
  if (legend) f.appendChild(legend);
  const body = el('div', 'viz-body');
  body.innerHTML = svg;
  f.appendChild(body);
  if (note) f.appendChild(el('p', 'viz-note', esc(note)));
  if (table) {
    const btn = el('button', 'viz-table-btn', 'Show data');
    const wrap = el('div', 'viz-table');
    wrap.hidden = true;
    wrap.innerHTML = table;
    btn.addEventListener('click', () => {
      wrap.hidden = !wrap.hidden;
      btn.textContent = wrap.hidden ? 'Show data' : 'Hide data';
    });
    f.appendChild(btn); f.appendChild(wrap);
  }
  return f;
}

function legendEl(items) {
  if (items.length < 2) return null;   // one series needs no legend — the title names it
  const l = el('div', 'viz-legend');
  l.innerHTML = items.map((i) => `<span class="viz-key"><i style="background:${i.color}"></i>${esc(i.name)}</span>`).join('');
  return l;
}

function dataTable(cols, rows) {
  return `<table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

/* ── Scales ──────────────────────────────────────────────────────────────── */
function niceMax(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

/* ==========================================================================
   Line / area chart — the change-over-time workhorse.
   Crosshair + tooltip by default; optional event markers on the x-axis.
   ========================================================================== */
export function lineChart({ title, subtitle, note, labels, series, format = fmt.int, area = false, markers = [], height = 210, zeroBase = true, bands = [] }) {
  const H = height, P = { t: 14, r: 14, b: 26, l: 46 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const all = series.flatMap((s) => s.values).filter((v) => v != null);
  const rawMax = Math.max(...all, 0), rawMin = Math.min(...all, 0);
  const max = niceMax(rawMax * 1.08 || 1);
  const min = zeroBase ? Math.min(0, rawMin) : rawMin - (rawMax - rawMin) * 0.12;
  const n = labels.length;
  const x = (i) => P.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => P.t + ih - ((v - min) / (max - min || 1)) * ih;

  const ticks = 4;
  let g = '';
  for (let k = 0; k <= ticks; k++) {
    const v = min + ((max - min) * k) / ticks, yy = y(v);
    g += `<line x1="${P.l}" y1="${yy.toFixed(1)}" x2="${W - P.r}" y2="${yy.toFixed(1)}" stroke="${INK.grid}" stroke-width="1"/>`;
    g += `<text x="${P.l - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="${INK.muted}">${esc(format(v))}</text>`;
  }

  // shaded windows (e.g. "analysis window")
  for (const b of bands) {
    g += `<rect x="${x(b.from)}" y="${P.t}" width="${Math.max(1, x(b.to) - x(b.from))}" height="${ih}" fill="rgba(255,255,255,.035)"/>`;
    if (b.label) g += `<text x="${x(b.from) + 6}" y="${P.t + 12}" font-size="10" fill="${INK.muted}">${esc(b.label)}</text>`;
  }

  let paths = '';
  series.forEach((s, si) => {
    const color = s.color || SERIES[si % SERIES.length];
    const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)]));
    const segs = [];
    let cur = [];
    for (const p of pts) { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } }
    if (cur.length) segs.push(cur);
    for (const seg of segs) {
      const d = seg.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
      if (area && series.length === 1) {
        paths += `<path d="${d} L${seg[seg.length - 1][0].toFixed(1)} ${y(min).toFixed(1)} L${seg[0][0].toFixed(1)} ${y(min).toFixed(1)} Z" fill="${color}" opacity=".13"/>`;
      }
      paths += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    // direct label at the last real point (≤4 series only)
    const lastIdx = [...s.values].reduce((acc, v, i) => (v != null ? i : acc), -1);
    if (series.length <= 4 && lastIdx >= 0 && s.name) {
      paths += `<circle cx="${x(lastIdx).toFixed(1)}" cy="${y(s.values[lastIdx]).toFixed(1)}" r="3.5" fill="${color}" stroke="${INK.surface}" stroke-width="2"/>`;
    }
  });

  let mk = '';
  for (const m of markers) {
    if (m.i < 0 || m.i >= n) continue;
    mk += `<line x1="${x(m.i).toFixed(1)}" y1="${P.t}" x2="${x(m.i).toFixed(1)}" y2="${P.t + ih}" stroke="${INK.axis}" stroke-width="1" stroke-dasharray="3 3"/>`;
    mk += `<text x="${(x(m.i) + 4).toFixed(1)}" y="${P.t + ih - 6}" font-size="9.5" fill="${INK.muted}">${esc(m.label)}</text>`;
  }

  const step = Math.max(1, Math.ceil(n / 7));
  let xl = '';
  for (let i = 0; i < n; i += step) xl += `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="${INK.muted}">${esc(labels[i])}</text>`;

  const id = 'ln' + Math.random().toString(36).slice(2, 8);
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="viz-svg" role="img" aria-label="${esc(title || 'line chart')}">
    ${g}${mk}${paths}
    <line x1="${P.l}" y1="${P.t + ih}" x2="${W - P.r}" y2="${P.t + ih}" stroke="${INK.axis}" stroke-width="1"/>
    ${xl}
    <g id="${id}-cross" style="opacity:0"><line y1="${P.t}" y2="${P.t + ih}" stroke="${INK.axis}" stroke-width="1"/>${series.map((s, i) => `<circle r="4.5" fill="${s.color || SERIES[i % SERIES.length]}" stroke="${INK.surface}" stroke-width="2"/>`).join('')}</g>
    <rect id="${id}-hit" x="${P.l}" y="${P.t}" width="${iw}" height="${ih}" fill="transparent"/>
  </svg>`;

  const f = figure({
    title, subtitle, note, svg,
    legend: legendEl(series.map((s, i) => ({ name: s.name, color: s.color || SERIES[i % SERIES.length] }))),
    table: dataTable(['Period', ...series.map((s) => s.name)], labels.map((l, i) => [l, ...series.map((s) => (s.values[i] == null ? '—' : format(s.values[i])))])),
  });

  // hover layer
  const svgEl = f.querySelector('svg');
  const hit = svgEl.querySelector(`#${id}-hit`);
  const cross = svgEl.querySelector(`#${id}-cross`);
  const move = (ev) => {
    const r = svgEl.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - P.l) / iw) * (n - 1))));
    cross.style.opacity = '1';
    cross.querySelector('line').setAttribute('x1', x(i)); cross.querySelector('line').setAttribute('x2', x(i));
    [...cross.querySelectorAll('circle')].forEach((c, si) => {
      const v = series[si].values[i];
      if (v == null) { c.style.opacity = '0'; return; }
      c.style.opacity = '1'; c.setAttribute('cx', x(i)); c.setAttribute('cy', y(v));
    });
    showTip(`<strong>${esc(labels[i])}</strong>` + series.map((s, si) =>
      `<span class="tk"><i style="background:${s.color || SERIES[si % SERIES.length]}"></i>${esc(s.name)}<b>${esc(s.values[i] == null ? '—' : format(s.values[i]))}</b></span>`).join(''),
      ev.clientX, r.top + (ev.clientY - r.top));
  };
  hit.addEventListener('mousemove', move);
  hit.addEventListener('mouseleave', () => { cross.style.opacity = '0'; hideTip(); });
  return f;
}

/* ==========================================================================
   Horizontal bar — the right form for ranked categories with long names.
   ========================================================================== */
export function barChart({ title, subtitle, note, rows, format = fmt.int, color, maxRows = 10, showValue = true }) {
  const data = rows.slice(0, maxRows);
  const rowH = 26, P = { t: 6, r: 90, b: 6, l: 152 };
  const H = P.t + P.b + data.length * rowH;
  const max = niceMax(Math.max(...data.map((r) => Math.abs(r.value)), 1));
  const iw = W - P.l - P.r;

  const bars = data.map((r, i) => {
    const y = P.t + i * rowH + 5, h = rowH - 12;
    const w = Math.max(2, (Math.abs(r.value) / max) * iw);
    const c = r.color || color || SERIES[0];
    return `<g class="viz-row" data-i="${i}">
      <text x="${P.l - 10}" y="${y + h / 2 + 4}" text-anchor="end" font-size="11.5" fill="${INK.secondary}">${esc(String(r.key).length > 24 ? String(r.key).slice(0, 23) + '…' : r.key)}</text>
      <rect x="${P.l}" y="${y}" width="${iw}" height="${h}" rx="4" fill="rgba(255,255,255,.04)"/>
      <rect x="${P.l}" y="${y}" width="${w.toFixed(1)}" height="${h}" rx="4" fill="${c}"/>
      ${showValue ? `<text x="${W - P.r + 8}" y="${y + h / 2 + 4}" font-size="11.5" fill="${INK.primary}" font-variant-numeric="tabular-nums">${esc(format(r.value))}</text>` : ''}
      <rect class="hit" x="0" y="${P.t + i * rowH}" width="${W}" height="${rowH}" fill="transparent"/>
    </g>`;
  }).join('');

  const f = figure({
    title, subtitle, note,
    svg: `<svg viewBox="0 0 ${W} ${H}" class="viz-svg" role="img" aria-label="${esc(title || 'bar chart')}">${bars}</svg>`,
    table: dataTable(['Item', 'Value'], data.map((r) => [r.key, format(r.value)])),
  });

  f.querySelectorAll('.viz-row').forEach((g, i) => {
    g.addEventListener('mousemove', (ev) => {
      const r = data[i];
      showTip(`<strong>${esc(r.key)}</strong><span class="tk">${esc(r.hint || 'Value')}<b>${esc(format(r.value))}</b></span>`, ev.clientX, ev.clientY);
    });
    g.addEventListener('mouseleave', hideTip);
    if (rows[i]?.onClick) { g.style.cursor = 'pointer'; g.addEventListener('click', rows[i].onClick); }
  });
  return f;
}

/* ==========================================================================
   Stacked bar — composition over time. 2px surface gap between segments.
   ========================================================================== */
export function stackedBar({ title, subtitle, note, labels, series, format = fmt.int, height = 210 }) {
  const H = height, P = { t: 12, r: 14, b: 26, l: 46 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const totals = labels.map((_, i) => series.reduce((s, sr) => s + (sr.values[i] || 0), 0));
  const max = niceMax(Math.max(...totals, 1));
  const bw = Math.min(34, (iw / labels.length) * 0.72);
  const xc = (i) => P.l + (i + 0.5) * (iw / labels.length);
  const y = (v) => P.t + ih - (v / max) * ih;

  let g = '';
  for (let k = 0; k <= 4; k++) {
    const v = (max * k) / 4, yy = y(v);
    g += `<line x1="${P.l}" y1="${yy.toFixed(1)}" x2="${W - P.r}" y2="${yy.toFixed(1)}" stroke="${INK.grid}" stroke-width="1"/>
          <text x="${P.l - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="${INK.muted}">${esc(format(v))}</text>`;
  }

  let bars = '';
  labels.forEach((lab, i) => {
    let acc = 0;
    series.forEach((sr, si) => {
      const v = sr.values[i] || 0;
      if (v <= 0) return;
      const y0 = y(acc + v), y1 = y(acc);
      acc += v;
      const h = Math.max(1, y1 - y0 - 2);   // 2px surface gap between segments
      bars += `<rect x="${(xc(i) - bw / 2).toFixed(1)}" y="${y0.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${sr.color || SERIES[si % SERIES.length]}"/>`;
    });
    bars += `<rect class="hit" data-i="${i}" x="${(xc(i) - (iw / labels.length) / 2).toFixed(1)}" y="${P.t}" width="${(iw / labels.length).toFixed(1)}" height="${ih}" fill="transparent"/>`;
  });

  const step = Math.max(1, Math.ceil(labels.length / 8));
  let xl = '';
  for (let i = 0; i < labels.length; i += step) xl += `<text x="${xc(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="${INK.muted}">${esc(labels[i])}</text>`;

  const f = figure({
    title, subtitle, note,
    svg: `<svg viewBox="0 0 ${W} ${H}" class="viz-svg" role="img" aria-label="${esc(title || 'stacked bar')}">${g}${bars}
      <line x1="${P.l}" y1="${P.t + ih}" x2="${W - P.r}" y2="${P.t + ih}" stroke="${INK.axis}" stroke-width="1"/>${xl}</svg>`,
    legend: legendEl(series.map((s, i) => ({ name: s.name, color: s.color || SERIES[i % SERIES.length] }))),
    table: dataTable(['Period', ...series.map((s) => s.name), 'Total'], labels.map((l, i) => [l, ...series.map((s) => format(s.values[i] || 0)), format(totals[i])])),
  });

  f.querySelectorAll('.hit').forEach((r) => {
    r.addEventListener('mousemove', (ev) => {
      const i = +r.dataset.i;
      showTip(`<strong>${esc(labels[i])}</strong>` + series.map((s, si) =>
        `<span class="tk"><i style="background:${s.color || SERIES[si % SERIES.length]}"></i>${esc(s.name)}<b>${esc(format(s.values[i] || 0))}</b></span>`).join('') +
        `<span class="tk tk-total">Total<b>${esc(format(totals[i]))}</b></span>`, ev.clientX, ev.clientY);
    });
    r.addEventListener('mouseleave', hideTip);
  });
  return f;
}

/* ==========================================================================
   Donut — parts of one whole, ≤5 slices, centre carries the total.
   ========================================================================== */
export function donut({ title, subtitle, note, rows, centreLabel, format = fmt.int }) {
  const H = 210, cx = W / 2, cy = H / 2, R = 74, r = 46;
  const total = rows.reduce((s, x) => s + x.value, 0) || 1;
  let a0 = -Math.PI / 2, seg = '';
  rows.forEach((row, i) => {
    const frac = row.value / total;
    const a1 = a0 + frac * Math.PI * 2;
    const gap = 0.014;                                  // 2px-equivalent surface gap
    const s = a0 + gap, e = Math.max(s + 0.001, a1 - gap);
    const large = e - s > Math.PI ? 1 : 0;
    const p = (ang, rad) => `${(cx + Math.cos(ang) * rad).toFixed(1)} ${(cy + Math.sin(ang) * rad).toFixed(1)}`;
    seg += `<path class="viz-slice" data-i="${i}" d="M${p(s, R)} A${R} ${R} 0 ${large} 1 ${p(e, R)} L${p(e, r)} A${r} ${r} 0 ${large} 0 ${p(s, r)} Z" fill="${row.color || SERIES[i % SERIES.length]}"/>`;
    a0 = a1;
  });

  const f = figure({
    title, subtitle, note,
    svg: `<svg viewBox="0 0 ${W} ${H}" class="viz-svg" role="img" aria-label="${esc(title || 'donut')}">${seg}
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="22" font-weight="700" fill="${INK.primary}">${esc(format(total))}</text>
      <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="10.5" fill="${INK.muted}">${esc(centreLabel || 'total')}</text></svg>`,
    legend: legendEl(rows.map((x, i) => ({ name: `${x.key} · ${format(x.value)}`, color: x.color || SERIES[i % SERIES.length] }))),
    table: dataTable(['Segment', 'Value', 'Share'], rows.map((x) => [x.key, format(x.value), `${((x.value / total) * 100).toFixed(1)}%`])),
  });
  f.querySelectorAll('.viz-slice').forEach((s) => {
    s.addEventListener('mousemove', (ev) => {
      const x = rows[+s.dataset.i];
      showTip(`<strong>${esc(x.key)}</strong><span class="tk">Value<b>${esc(format(x.value))}</b></span><span class="tk">Share<b>${((x.value / total) * 100).toFixed(1)}%</b></span>`, ev.clientX, ev.clientY);
    });
    s.addEventListener('mouseleave', hideTip);
  });
  return f;
}

/* ==========================================================================
   Contribution bar — "what share of the change does each slice explain?"
   This is the visual form of the root-cause decomposition, so the parts are
   labelled with their own percentage rather than relying on width alone.
   ========================================================================== */
export function contributionChart({ title, subtitle, note, rows, format = fmt.pct0 }) {
  const data = rows.filter((r) => r.contribution > 0.005).slice(0, 6);
  const rowH = 30, H = 8 + data.length * rowH, P = { l: 190, r: 60 };
  const iw = W - P.l - P.r;
  const bars = data.map((r, i) => {
    const y = 6 + i * rowH, h = rowH - 13;
    const w = Math.max(2, Math.min(1, r.contribution) * iw);
    const c = i === 0 ? STATUS.critical : SEQ[Math.max(1, 4 - i)];
    return `<g class="viz-row" data-i="${i}">
      <text x="${P.l - 10}" y="${y + h / 2 + 4}" text-anchor="end" font-size="11.5" fill="${INK.secondary}">${esc(String(r.label || r.key).length > 30 ? String(r.label || r.key).slice(0, 29) + '…' : (r.label || r.key))}</text>
      <rect x="${P.l}" y="${y}" width="${iw}" height="${h}" rx="4" fill="rgba(255,255,255,.04)"/>
      <rect x="${P.l}" y="${y}" width="${w.toFixed(1)}" height="${h}" rx="4" fill="${c}"/>
      <text x="${W - P.r + 8}" y="${y + h / 2 + 4}" font-size="11.5" font-weight="600" fill="${INK.primary}" font-variant-numeric="tabular-nums">${esc(format(r.contribution))}</text>
      <rect class="hit" x="0" y="${y - 4}" width="${W}" height="${rowH}" fill="transparent"/></g>`;
  }).join('');

  const f = figure({
    title, subtitle, note,
    svg: `<svg viewBox="0 0 ${W} ${Math.max(H, 40)}" class="viz-svg" role="img" aria-label="${esc(title || 'contribution')}">${bars}</svg>`,
    table: dataTable(['Driver', 'Share of change', 'Recent', 'Baseline'], data.map((r) => [
      r.label || r.key, format(r.contribution),
      r.recent_rate != null ? fmt.pct(r.recent_rate) : r.recent_per_day != null ? fmt.one(r.recent_per_day) + '/day' : '—',
      r.base_rate != null ? fmt.pct(r.base_rate) : r.base_per_day != null ? fmt.one(r.base_per_day) + '/day' : '—',
    ])),
  });
  f.querySelectorAll('.viz-row').forEach((g, i) => {
    g.addEventListener('mousemove', (ev) => {
      const r = data[i];
      showTip(`<strong>${esc(r.label || r.key)}</strong><span class="tk">Explains<b>${format(r.contribution)}</b></span>` +
        (r.recent_count != null ? `<span class="tk">Recent count<b>${fmt.int(r.recent_count)}</b></span>` : ''), ev.clientX, ev.clientY);
    });
    g.addEventListener('mouseleave', hideTip);
  });
  return f;
}

/* ── Gauge arc for the health score ─────────────────────────────────────── */
export function gaugeSvg(score, size = 132) {
  const R = 54, C = 2 * Math.PI * R;
  const pctv = Math.max(0, Math.min(100, score)) / 100;
  const col = score >= 75 ? STATUS.good : score >= 55 ? STATUS.warning : score >= 40 ? STATUS.serious : STATUS.critical;
  return `<svg viewBox="0 0 132 132" width="${size}" height="${size}" class="viz-gauge" role="img" aria-label="Operations health ${Math.round(score)} out of 100">
    <circle cx="66" cy="66" r="${R}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="11"/>
    <circle cx="66" cy="66" r="${R}" fill="none" stroke="${col}" stroke-width="11" stroke-linecap="round"
      transform="rotate(-90 66 66)" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - pctv)).toFixed(1)}"/>
    <text x="66" y="72" text-anchor="middle" font-size="30" font-weight="800" fill="${INK.primary}">${Math.round(score)}</text>
    <text x="66" y="90" text-anchor="middle" font-size="9.5" fill="${INK.muted}">/ 100</text>
  </svg>`;
}

/** Tiny inline sparkline for KPI tiles. */
export function sparkline(values, { w = 110, h = 30, color = SERIES[0] } = {}) {
  const vals = values.filter((v) => v != null);
  if (vals.length < 2) return '';
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const pts = values.map((v, i) => (v == null ? null : [(i / (values.length - 1)) * w, h - ((v - min) / span) * (h - 4) - 2]))
    .filter(Boolean).map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" class="viz-spark" preserveAspectRatio="none" aria-hidden="true"><path d="${pts}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** A radar/spider for the four risk dimensions. */
export function radarChart({ dimensions, size = 300 }) {
  const cx = size / 2, cy = size / 2, R = size * 0.34;
  const n = dimensions.length;
  const ang = (i) => -Math.PI / 2 + (i / n) * Math.PI * 2;
  const pt = (i, frac) => [cx + Math.cos(ang(i)) * R * frac, cy + Math.sin(ang(i)) * R * frac];

  let rings = '';
  for (const f of [0.25, 0.5, 0.75, 1]) {
    rings += `<polygon points="${Array.from({ length: n }, (_, i) => pt(i, f).map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${INK.grid}" stroke-width="1"/>`;
  }
  let spokes = '', labels = '';
  dimensions.forEach((d, i) => {
    const [x, y] = pt(i, 1);
    spokes += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${INK.grid}" stroke-width="1"/>`;
    const [lx, ly] = pt(i, 1.24);
    labels += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-size="10.5" fill="${INK.secondary}">${esc(d.label.replace(' Risk', ''))}</text>
               <text x="${lx.toFixed(1)}" y="${(ly + 13).toFixed(1)}" text-anchor="middle" font-size="11.5" font-weight="700" fill="${d.risk >= 45 ? STATUS.critical : d.risk >= 30 ? STATUS.warning : STATUS.good}">${d.risk}</text>`;
  });
  const poly = dimensions.map((d, i) => pt(i, Math.max(0.06, d.risk / 100)).map((v) => v.toFixed(1)).join(',')).join(' ');

  return `<svg viewBox="0 0 ${size} ${size}" class="viz-radar" role="img" aria-label="Risk radar">
    ${rings}${spokes}
    <polygon points="${poly}" fill="${STATUS.critical}" fill-opacity=".2" stroke="${STATUS.critical}" stroke-width="2" stroke-linejoin="round"/>
    ${dimensions.map((d, i) => { const [x, y] = pt(i, Math.max(0.06, d.risk / 100)); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${STATUS.critical}" stroke="${INK.surface}" stroke-width="2"/>`; }).join('')}
    ${labels}</svg>`;
}

export { esc, el, dataTable, figure };
