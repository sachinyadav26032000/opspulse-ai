/* ==========================================================================
   Billing terms — why the renewal date is not the churn date.
   --------------------------------------------------------------------------
   From the validation call with a Director of Customer Success:

     "Payment frequency — is it an offline or online customer? Many companies
      on offline get 30 days extra credit, so the churn is not exactly on the
      same date."

   This is the modifier most tools miss, and it inverts prioritisation. An
   offline account renewing in 20 days actually has 50 days of runway; an
   online account renewing in 35 has 35. Sorted by renewal date the CSM works
   the offline one first and is wrong. Sorted by EFFECTIVE churn date they work
   the right one.

   Both dates are surfaced rather than one, because the gap between them is the
   insight — a single "corrected" date would hide the very thing worth knowing.

   Run as a POST-PASS on its own RNG stream. Adding draws to the account loop
   shifts every downstream value and silently regenerates the world; that has
   already happened once on this branch and broke pattern detection.
   ========================================================================== */

import { makeRng } from './rng.js';

const DAY = 86400000;

/** Share of accounts billed offline (invoice, PO, bank transfer). */
export const OFFLINE_SHARE = 0.30;

/* Credit terms by channel. Offline invoicing carries a payment window; online
   card billing does not, because the charge either clears on the day or the
   account lapses. */
export const CREDIT_DAYS = {
  online: 0,
  offline: 30,
};

/** Attach `billing` to every account. Mutates `ds.accounts` in place. */
export function attachBilling(ds) {
  const rnd = makeRng((ds.meta.seed ^ 0x2b11c3) >>> 0);
  const asOf = ds.meta.as_of;

  for (const a of ds.accounts) {
    /* Offline billing skews to larger contracts — enterprise procurement runs
       on invoices and POs, self-serve runs on a card. The skew is mild, not
       deterministic, so plan does not give the answer away. */
    const lean = a.plan === 'Enterprise' ? 0.22 : a.plan === 'Growth' ? 0.04 : -0.08;
    const channel = rnd.chance(OFFLINE_SHARE + lean) ? 'offline' : 'online';
    const creditDays = CREDIT_DAYS[channel];

    const renewalMs = asOf + a.renewal_in_days * DAY;
    const effectiveMs = renewalMs + creditDays * DAY;

    a.billing = {
      channel,
      credit_days: creditDays,
      // Derived, not drawn: renewal date plus whatever credit the terms allow.
      effective_churn_date: new Date(effectiveMs).toISOString().slice(0, 10),
      effective_churn_in_days: a.renewal_in_days + creditDays,
      renewal_date: new Date(renewalMs).toISOString().slice(0, 10),
      // True when the gap changes which account a CSM should work first.
      runway_differs: creditDays > 0,
    };
  }

  return ds;
}
