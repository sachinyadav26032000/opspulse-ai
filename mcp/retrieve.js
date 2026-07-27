/* ==========================================================================
   Evidence retrieval — BM25 over the operation's own text.
   --------------------------------------------------------------------------
   The engine answers "what happened" with arithmetic. This answers the other
   half: "show me the customers actually saying it." Those are different
   questions and they need different machinery — a z-test cannot surface the
   sentence a detractor wrote, and no amount of retrieval will tell you whether
   a rate moved significantly.

   THE ONE RULE THIS FILE EXISTS TO KEEP: every passage returned carries the id
   of the record it came from. A retrieved sentence with no ticket_id behind it
   is a quote with no source, which is exactly the thing the rest of this
   codebase refuses to produce. If a passage cannot be traced to a record, it
   is not returned.

   BM25 rather than embeddings, deliberately: embeddings need a model, a vector
   store, and a network call, and would make the answer depend on all three.
   BM25 is ~80 lines, runs in a few milliseconds over 11,600 records, and its
   ranking is inspectable — you can print the term scores and see why a passage
   won. For a corpus this size the retrieval quality difference does not
   justify the dependency.
   ========================================================================== */

/* Terms that match nearly every support record carry no signal — "ticket" in a
   ticket corpus is noise, not a query. Kept short on purpose: an aggressive
   stoplist silently drops real queries ("no refund" → "refund"). */
const STOP = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'did',
  'do', 'does', 'for', 'from', 'had', 'has', 'have', 'i', 'if', 'in', 'into',
  'is', 'it', 'its', 'me', 'my', 'no', 'not', 'of', 'on', 'or', 'our', 's',
  'she', 'so', 't', 'that', 'the', 'their', 'them', 'then', 'there', 'they',
  'this', 'to', 'us', 'was', 'we', 'were', 'what', 'when', 'which', 'who',
  'will', 'with', 'would', 'you', 'your',
]);

const K1 = 1.5;   // term-frequency saturation — a 10th mention adds little
const B = 0.75;   // length normalisation — standard BM25 default

/** Lowercase, split on non-alphanumerics, drop stopwords and 1-char noise. */
export function tokenize(text) {
  if (!text) return [];
  const out = [];
  for (const w of String(text).toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length > 1 && !STOP.has(w)) out.push(w);
  }
  return out;
}

/* Each corpus entry is one record's text, never a merged blob: merging a
   ticket's subject with its description would be fine, but merging two
   tickets would produce a passage that cites two ids and belongs to neither. */
function docsFor(ds) {
  const docs = [];

  for (const t of ds.tickets) {
    const parts = [t.ticket_subject, t.ticket_description, t.resolution].filter(Boolean);
    if (!parts.length) continue;
    docs.push({
      id: t.ticket_id,
      kind: 'ticket',
      text: parts.join(' — '),
      day_index: t.day_index,
      meta: {
        category: t.category, tag: t.tag, company: t.company, plan: t.plan,
        priority: t.ticket_priority, status: t.ticket_status,
        escalated: !!t.escalated, csat: t.customer_satisfaction_rating ?? null,
      },
    });
  }

  for (const n of ds.nps) {
    if (!n.verbatim) continue;
    docs.push({
      id: n.response_id,
      kind: 'nps',
      text: n.verbatim,
      day_index: n.day_index,
      meta: {
        score: n.score, segment: n.segment, driver_tag: n.driver_tag,
        company: n.company, plan: n.plan, ticket_id: n.last_ticket_id ?? null,
      },
    });
  }

  for (const q of ds.qa) {
    if (!q.note) continue;
    docs.push({
      id: q.qa_id,
      kind: 'qa',
      text: q.note,
      day_index: q.day_index,
      meta: {
        agent_name: q.agent_name, cohort: q.cohort, team: q.team,
        overall_score: q.overall_score, flags: q.flags ?? [],
      },
    });
  }

  return docs;
}

/**
 * Build the inverted index once per dataset. ~11,600 documents indexes in
 * well under a second, and the index is reused across every query — rebuilding
 * per query is what makes naive BM25 implementations feel slow.
 */
export function buildIndex(ds) {
  const docs = docsFor(ds);
  const df = new Map();                    // term → number of docs containing it
  const tfs = new Array(docs.length);      // per-doc term → count
  let totalLen = 0;

  for (let i = 0; i < docs.length; i++) {
    const toks = tokenize(docs[i].text);
    const tf = new Map();
    for (const w of toks) tf.set(w, (tf.get(w) || 0) + 1);
    tfs[i] = tf;
    totalLen += toks.length;
    for (const w of tf.keys()) df.set(w, (df.get(w) || 0) + 1);
  }

  // Posting lists let a query touch only the documents that contain its terms
  // rather than scoring all 11,600 — the difference between ~2ms and ~40ms.
  const postings = new Map();
  for (let i = 0; i < docs.length; i++) {
    for (const [w, c] of tfs[i]) {
      let list = postings.get(w);
      if (!list) postings.set(w, (list = []));
      list.push([i, c]);
    }
  }

  return {
    docs,
    postings,
    df,
    lens: tfs.map((tf) => { let n = 0; for (const c of tf.values()) n += c; return n; }),
    avgLen: docs.length ? totalLen / docs.length : 0,
    n: docs.length,
  };
}

/** Standard BM25 idf, floored at zero so a term in >half the corpus can't
    subtract from a document's score. */
function idf(index, term) {
  const n = index.df.get(term);
  if (!n) return 0;
  return Math.max(0, Math.log(1 + (index.n - n + 0.5) / (n + 0.5)));
}

/**
 * @param {object} index      from buildIndex()
 * @param {string} query
 * @param {object} [opt]
 * @param {number} [opt.limit=8]
 * @param {'ticket'|'nps'|'qa'} [opt.kind]  restrict to one record type
 * @param {number} [opt.from_day]  inclusive day index lower bound
 * @param {number} [opt.to_day]    inclusive day index upper bound
 */
export function search(index, query, opt = {}) {
  const terms = tokenize(query);
  if (!terms.length) return { query, terms: [], total_matched: 0, passages: [] };

  const limit = Math.max(1, Math.min(50, opt.limit ?? 8));
  const scores = new Map();

  for (const term of terms) {
    const list = index.postings.get(term);
    if (!list) continue;
    const w = idf(index, term);
    if (w <= 0) continue;
    for (const [i, count] of list) {
      const norm = 1 - B + B * (index.lens[i] / (index.avgLen || 1));
      const s = w * ((count * (K1 + 1)) / (count + K1 * norm));
      scores.set(i, (scores.get(i) || 0) + s);
    }
  }

  /* Filters are applied AFTER scoring rather than folded into the loop: BM25's
     idf is a property of the whole corpus, and narrowing the corpus first would
     make the same passage score differently depending on the filter — so two
     searches that both return a ticket would disagree about how relevant it is. */
  let hits = [...scores.entries()];
  if (opt.kind) hits = hits.filter(([i]) => index.docs[i].kind === opt.kind);
  if (opt.from_day != null) hits = hits.filter(([i]) => index.docs[i].day_index >= opt.from_day);
  if (opt.to_day != null) hits = hits.filter(([i]) => index.docs[i].day_index <= opt.to_day);

  const total = hits.length;
  hits.sort((a, b) => b[1] - a[1]);

  return {
    query,
    terms,
    total_matched: total,
    passages: hits.slice(0, limit).map(([i, score]) => {
      const d = index.docs[i];
      return {
        record_id: d.id,           // ← the whole point: every passage is traceable
        kind: d.kind,
        day_index: d.day_index,
        score: Math.round(score * 1000) / 1000,
        text: d.text,
        ...d.meta,
      };
    }),
  };
}
