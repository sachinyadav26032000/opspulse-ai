/* ==========================================================================
   FROZEN ENGINE SNAPSHOT — do not hand-edit.
   --------------------------------------------------------------------------
   Generated from a real engine run at:
       seed   20260724
       as_of  2026-07-26T09:00:00.000Z

   Both are pinned deliberately. generate(seed, asOf) derives day0 from as_of,
   so the seed alone does NOT reproduce a dataset — the exposed accounts turn
   over completely as the clock moves.

   All three explorations render from this object, so any difference between
   them is design, never content.

   Written as a CLASSIC script, not an ES module, so every exploration opens
   straight off the filesystem — ES modules are blocked by CORS over file://
   and the whole point of these files is that they need no server.
   ========================================================================== */

var SNAPSHOT = {
  "meta": {
    "seed": 20260724,
    "as_of": "2026-07-26T09:00:00.000Z",
    "frozen_at": "2026-07-26T09:00:00.000Z",
    "period": "13 Jul – 26 Jul · 14-day window",
    "window_days": 14,
    "user": "Sudharshan",
    "records_in": 11600,
    "detectors": 9,
    "confidence_floor": 60
  },
  "health": {
    "score": 53,
    "delta": -11,
    "dimensions": [
      {
        "key": "support",
        "label": "Support Risk",
        "score": 44,
        "delta": -19,
        "hint": "Can the desk keep up with what is arriving?"
      },
      {
        "key": "customer",
        "label": "Customer Risk",
        "score": 67,
        "delta": -11,
        "hint": "Are customers still with us — and would they say so?"
      },
      {
        "key": "quality",
        "label": "Quality Risk",
        "score": 49,
        "delta": 3,
        "hint": "Is the work being done correctly the first time?"
      },
      {
        "key": "compliance",
        "label": "Compliance Risk",
        "score": 50,
        "delta": -16,
        "hint": "Are we meeting obligations we do not get to negotiate?"
      }
    ]
  },
  "headline": {
    "decisions_count": 3,
    "at_stake_low": 101889,
    "at_stake_high": 179125,
    "at_stake_range": "$102K–$179K",
    "at_stake_mid": 140507,
    "uncosted": 0
  },
  "decisions": [
    {
      "rank": 1,
      "id": "ins_ct44zj",
      "signal_type": "escalation_spike",
      "band": "critical",
      "severity": 86,
      "confidence": 95,
      "held": false,
      "title": "Refund escalation spike",
      "metric_label": "19% escalation rate · 2.9× baseline",
      "problem": "Refund escalations moved from 6.6% to 19.2% of that category's tickets over the last 14 days — 56 escalations where the baseline predicts 19. 231 distinct customers are involved.",
      "root_cause": "Refund policy window (30d → 14d) is driving the spike — it accounts for 100% of the increase in escalation rate, and the shift begins 4 days after “Refund policy updated — window cut 30d → 14d”.",
      "action": "Republish the refund policy article with the corrected window, add a guided macro, and run a 30-minute policy huddle for Billing Ops",
      "owner_role": "Support Operations Manager",
      "playbook_id": "PB-REFUND-POLICY-01",
      "money_low": 89865,
      "money_high": 161757,
      "money_range": "$90K – $162K",
      "money_mid": 125811,
      "horizon_days": 90,
      "affected_accounts": 231
    },
    {
      "rank": 2,
      "id": "ins_19kv76",
      "signal_type": "backlog_risk",
      "band": "critical",
      "severity": 84,
      "confidence": 88,
      "held": false,
      "title": "Ticket backlog is outgrowing capacity",
      "metric_label": "406 open · +13.7/day",
      "problem": "Open backlog has grown from 228 to 406 tickets in the last 14 days, +13.7/day. 304 tickets are older than 72 hours and median first response has slipped 37→45 minutes.",
      "root_cause": "Inflow is running 127/day against 116/day of throughput — a gap of 11 tickets a day.",
      "action": "Close the daily capacity gap: surge-staff the queue and deflect the two categories driving inflow",
      "owner_role": "Head of Support",
      "playbook_id": "PB-CAPACITY-03",
      "money_low": 5994,
      "money_high": 8658,
      "money_range": "$6K – $9K",
      "money_mid": 7326,
      "horizon_days": 30,
      "affected_accounts": 378
    },
    {
      "rank": 3,
      "id": "ins_657zwj",
      "signal_type": "emerging_topic",
      "band": "high",
      "severity": 78,
      "confidence": 95,
      "held": false,
      "title": "Refund contact surge",
      "metric_label": "+116% volume · 335 extra/mo",
      "problem": "Refund contacts are running at 20.8/day against a 9.6/day baseline (2.16×), an extra 335 contacts a month.",
      "root_cause": "Customers are contacting support about refund policy window (30d → 14d) — that reason alone explains 100% of the extra volume, starting 8 days after “Refund policy updated — window cut 30d → 14d”.",
      "action": "Close the daily capacity gap: surge-staff the queue and deflect the two categories driving inflow",
      "owner_role": "Head of Support",
      "playbook_id": "PB-CAPACITY-03",
      "money_low": 6030,
      "money_high": 8710,
      "money_range": "$6K – $9K",
      "money_mid": 7370,
      "horizon_days": 30,
      "affected_accounts": 231
    }
  ],
  "churn": {
    "id": "ins_1bgxmj",
    "title": "Churn risk — 64 accounts",
    "metric_label": "$808k ARR exposed",
    "arr_at_risk": 808100,
    "arr_at_risk_display": "$808K",
    "affected_accounts": 64
  },
  "exposed_accounts": [
    {
      "account_id": "AC2006",
      "account_name": "Fable Media",
      "arr_usd": 168600,
      "arr_display": "$168,600",
      "plan": "Enterprise",
      "region": "LATAM",
      "renewal_date": "2027-07-08",
      "renewal_in_days": 347,
      "owner": "Otto Yilmaz",
      "contact_name": "Ava Costa",
      "risk_reason": "Raised a P2 cancellation case 13 days ago, now closed, the open thread was “at-risk renewal — retention required”.",
      "recommended_action": {
        "action": "Executive save call — the case closed without a renewal commitment, and this is a top-decile account by ARR.",
        "owner": "Otto Yilmaz",
        "owner_role": "Account CSM"
      },
      "supporting_signals": [
        {
          "source": "CRM · Escalations",
          "metric": "Escalations raised",
          "value": "1 in 14d",
          "delta": "+1 vs prior period",
          "observed_at": "2026-07-12T18:30:00.000Z",
          "detail": "Most recent: P2 — At-risk renewal — retention required"
        },
        {
          "source": "Ticketing",
          "metric": "Tickets opened",
          "value": "2 in 14d",
          "delta": "0 vs prior period",
          "observed_at": "2026-07-23T05:53:41.247Z",
          "detail": "All resolved"
        },
        {
          "source": "Survey · NPS",
          "metric": "Last NPS response",
          "value": "8",
          "delta": "passive",
          "observed_at": "2026-06-12T09:44:42.143Z",
          "detail": "“Works fine, nothing remarkable.”"
        },
        {
          "source": "CRM · Contract",
          "metric": "Renewal",
          "value": "347 days",
          "delta": "Enterprise · $168,600 ARR",
          "observed_at": "2026-07-26T09:00:00.000Z",
          "detail": null
        }
      ]
    },
    {
      "account_id": "AC2353",
      "account_name": "Ardent Digital",
      "arr_usd": 160400,
      "arr_display": "$160,400",
      "plan": "Enterprise",
      "region": "EMEA",
      "renewal_date": "2026-12-10",
      "renewal_in_days": 137,
      "owner": "Omar Mehta",
      "contact_name": "Otto Sharma",
      "risk_reason": "Raised a P2 cancellation case 7 days ago, now closed, contact volume is up (1 ticket this window against 0 before it).",
      "recommended_action": {
        "action": "Executive save call — the case closed without a renewal commitment, and this is a top-decile account by ARR.",
        "owner": "Omar Mehta",
        "owner_role": "Account CSM"
      },
      "supporting_signals": [
        {
          "source": "CRM · Escalations",
          "metric": "Escalations raised",
          "value": "1 in 14d",
          "delta": "+1 vs prior period",
          "observed_at": "2026-07-18T18:30:00.000Z",
          "detail": "Most recent: P2 — At-risk renewal — retention required"
        },
        {
          "source": "Ticketing",
          "metric": "Tickets opened",
          "value": "1 in 14d",
          "delta": "+1 vs prior period",
          "observed_at": "2026-07-19T08:43:20.434Z",
          "detail": "All resolved"
        },
        {
          "source": "CRM · Contract",
          "metric": "Renewal",
          "value": "137 days",
          "delta": "Enterprise · $160,400 ARR",
          "observed_at": "2026-07-26T09:00:00.000Z",
          "detail": null
        }
      ]
    },
    {
      "account_id": "AC0944",
      "account_name": "Bright Group",
      "arr_usd": 73100,
      "arr_display": "$73,100",
      "plan": "Enterprise",
      "region": "EMEA",
      "renewal_date": "2027-03-08",
      "renewal_in_days": 225,
      "owner": "Diego Hassan",
      "contact_name": "Tomas Petrov",
      "risk_reason": "Raised a P2 cancellation case yesterday, now closed, the open thread was “at-risk renewal — retention required”.",
      "recommended_action": {
        "action": "Run the save play now while the case is still fresh — closed is not the same as resolved.",
        "owner": "Diego Hassan",
        "owner_role": "Account CSM"
      },
      "supporting_signals": [
        {
          "source": "CRM · Escalations",
          "metric": "Escalations raised",
          "value": "1 in 14d",
          "delta": "+1 vs prior period",
          "observed_at": "2026-07-24T18:30:00.000Z",
          "detail": "Most recent: P2 — At-risk renewal — retention required"
        },
        {
          "source": "Ticketing",
          "metric": "Tickets opened",
          "value": "2 in 14d",
          "delta": "-3 vs prior period",
          "observed_at": "2026-07-25T12:54:43.266Z",
          "detail": "All resolved"
        },
        {
          "source": "Survey · CSAT",
          "metric": "Mean satisfaction",
          "value": "4.0★",
          "delta": "+1 vs prior period",
          "observed_at": "2026-07-13T06:34:39.504Z",
          "detail": "1 rated ticket in window"
        },
        {
          "source": "CRM · Contract",
          "metric": "Renewal",
          "value": "225 days",
          "delta": "Enterprise · $73,100 ARR",
          "observed_at": "2026-07-26T09:00:00.000Z",
          "detail": null
        }
      ]
    },
    {
      "account_id": "AC2349",
      "account_name": "Harbor Textiles",
      "arr_usd": 25200,
      "arr_display": "$25,200",
      "plan": "Growth",
      "region": "North America",
      "renewal_date": "2027-02-21",
      "renewal_in_days": 210,
      "owner": "Freya Ahmed",
      "contact_name": "Mila Weber",
      "risk_reason": "Escalated once in the last 14 days — P2, full workspace lockout, the last NPS response was a 5.",
      "recommended_action": {
        "action": "Proactive check-in ahead of renewal, with the escalation history acknowledged up front.",
        "owner": "Freya Ahmed",
        "owner_role": "Account CSM"
      },
      "supporting_signals": [
        {
          "source": "CRM · Escalations",
          "metric": "Escalations raised",
          "value": "1 in 14d",
          "delta": "+1 vs prior period",
          "observed_at": "2026-07-20T18:30:00.000Z",
          "detail": "Most recent: P2 — Full workspace lockout"
        },
        {
          "source": "Ticketing",
          "metric": "Tickets opened",
          "value": "2 in 14d",
          "delta": "-1 vs prior period",
          "observed_at": "2026-07-22T08:46:47.096Z",
          "detail": "All resolved"
        },
        {
          "source": "Survey · NPS",
          "metric": "Last NPS response",
          "value": "5",
          "delta": "detractor",
          "observed_at": "2026-07-09T04:03:22.881Z",
          "detail": "“Renewal quote went up with no added value.”"
        },
        {
          "source": "CRM · Contract",
          "metric": "Renewal",
          "value": "210 days",
          "delta": "Growth · $25,200 ARR",
          "observed_at": "2026-07-26T09:00:00.000Z",
          "detail": null
        }
      ]
    },
    {
      "account_id": "AC0175",
      "account_name": "Halcyon Logistics",
      "arr_usd": 24500,
      "arr_display": "$24,500",
      "plan": "Growth",
      "region": "North America",
      "renewal_date": "2027-03-03",
      "renewal_in_days": 220,
      "owner": "Amara Costa",
      "contact_name": "Ines Kim",
      "risk_reason": "Escalated once in the last 14 days — P1, full workspace lockout, contact volume is up (2 tickets this window against 0 before it).",
      "recommended_action": {
        "action": "Schedule a service review — the dissatisfaction is measured, not anecdotal.",
        "owner": "Amara Costa",
        "owner_role": "Account CSM"
      },
      "supporting_signals": [
        {
          "source": "CRM · Escalations",
          "metric": "Escalations raised",
          "value": "1 in 14d",
          "delta": "+1 vs prior period",
          "observed_at": "2026-07-17T18:30:00.000Z",
          "detail": "Most recent: P1 — Full workspace lockout"
        },
        {
          "source": "Ticketing",
          "metric": "Tickets opened",
          "value": "2 in 14d",
          "delta": "+2 vs prior period",
          "observed_at": "2026-07-21T05:53:04.865Z",
          "detail": "All resolved"
        },
        {
          "source": "Survey · CSAT",
          "metric": "Mean satisfaction",
          "value": "3.0★",
          "delta": "no prior ratings",
          "observed_at": "2026-07-21T05:53:04.865Z",
          "detail": "1 rated ticket in window"
        },
        {
          "source": "CRM · Contract",
          "metric": "Renewal",
          "value": "220 days",
          "delta": "Growth · $24,500 ARR",
          "observed_at": "2026-07-26T09:00:00.000Z",
          "detail": null
        }
      ]
    },
    {
      "account_id": "AC2256",
      "account_name": "Ironwood Media",
      "arr_usd": 24000,
      "arr_display": "$24,000",
      "plan": "Growth",
      "region": "North America",
      "renewal_date": "2026-08-08",
      "renewal_in_days": 13,
      "owner": "Ravi Rossi",
      "contact_name": "Amara Kowalski",
      "risk_reason": "Renewal is 13 days away, and this account already raised a P1 cancellation case 10 days ago.",
      "recommended_action": {
        "action": "Renewal lands in 13 days and they have already tried to leave once — put an exec on the call, not a check-in.",
        "owner": "Ravi Rossi",
        "owner_role": "Account CSM"
      },
      "supporting_signals": [
        {
          "source": "CRM · Escalations",
          "metric": "Escalations raised",
          "value": "1 in 14d",
          "delta": "+1 vs prior period",
          "observed_at": "2026-07-15T18:30:00.000Z",
          "detail": "Most recent: P1 — Cancellation with contractual dispute"
        },
        {
          "source": "Ticketing",
          "metric": "Tickets opened",
          "value": "1 in 14d",
          "delta": "-1 vs prior period",
          "observed_at": "2026-07-16T14:10:18.068Z",
          "detail": "All resolved"
        },
        {
          "source": "CRM · Contract",
          "metric": "Renewal",
          "value": "13 days",
          "delta": "Growth · $24,000 ARR",
          "observed_at": "2026-07-26T09:00:00.000Z",
          "detail": "Inside the renewal window"
        }
      ]
    }
  ],
  "reconciliation": {
    "exposed_total": 475800,
    "exposed_total_display": "$475,800",
    "exposed_count": 6,
    "of_full_set": 64
  }
};

if (typeof window !== 'undefined') window.SNAPSHOT = SNAPSHOT;
