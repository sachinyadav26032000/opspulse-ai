'use strict';
/* ==========================================================================
   AGENT 1 — Data Ingestion
   in:  raw source records (native metric names)
   out: normalized signal records on a common schema/timeline
   technique: ETL + schema mapping. NOT ML.
   ========================================================================== */

const { CATALOG, SOURCE_MAP, headlineSignalType } = require('../signals');

function run(raw) {
  const normalized = [];
  const dropped = [];
  raw.forEach((r) => {
    const key = SOURCE_MAP[r.source] && SOURCE_MAP[r.source][r.stream];
    if (!key || !CATALOG[key]) { dropped.push({ source: r.source, stream: r.stream }); return; }
    const meta = CATALOG[key];
    normalized.push({
      key,
      source: r.source,
      label: meta.label,
      unit: meta.unit,
      better: meta.better,
      entityId: r.entity.id,
      entity: r.entity,
      headline_type: headlineSignalType(key, r.entity.type),
      series: r.series, // common {t, value} timeline
    });
  });
  return { normalized, stats: { in: raw.length, out: normalized.length, dropped: dropped.length } };
}

module.exports = { run };
