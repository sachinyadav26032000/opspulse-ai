/* ==========================================================================
   Cross-tab sync — one simulator, many tabs.
   --------------------------------------------------------------------------
   The store's original note said cross-tab passing was declined because it
   "would add leader election, replay and persistence-race handling." That was
   true, and it is what this file is: the cost, paid deliberately, so that
   NorthDesk in one tab and OpsPulse in another show the same operation rather
   than two operations that happen to share a seed.

   THE SHAPE OF THE PROBLEM
   Every tab can rebuild the same 90-day history from the persisted seed — that
   part was already in sync. What diverges is the LIVE TAIL: each tab was
   running its own interval timer, so a tab open for ten minutes had ten
   minutes of tickets a tab opened just now had never seen.

   THE FIX: one writer, many readers.
     · Exactly one tab runs the simulator.
     · It broadcasts what it did — the actual records, not a command to
       re-derive them. Replaying a seeded PRNG in each tab would also work and
       send less, but it makes every tab's correctness depend on every tab
       walking an identical code path; one dropped message and they diverge
       silently and permanently. Shipping the records means a follower's state
       is a function of what it RECEIVED, which is inspectable.
     · Followers apply, then re-run the engine against the leader's `as_of` so
       window boundaries can't put two tabs on opposite sides of a day.

   TWO ROLES, NOT ONE
   `lockHolder` is decided by navigator.locks: an exclusive lock that is never
   released, so the browser hands it to the next waiter when the holder's tab
   closes — failover with no heartbeat, no timeout, no tie-break.

   `leader` is who is actually ticking, and it can move without the lock moving.
   It has to, because browsers throttle timers in hidden tabs down to roughly
   one per minute after a few minutes. Leave the writer in a backgrounded tab
   and every OTHER tab goes quiet — the exact failure a viewer would read as
   "the demo is broken." So a hidden leader hands off to a visible tab.

   Splitting the two is what keeps that safe. Delegation is a favour the lock
   holder grants and can take back; because only the lock holder runs the
   watchdog that reclaims a dead delegation, there is never a moment when two
   tabs both believe they should be writing.

   Everything here degrades to a no-op. Without BroadcastChannel or
   navigator.locks — Node, jsdom, older browsers — `solo` is true, the tab is
   its own leader, and the store behaves exactly as it did before this file
   existed.
   ========================================================================== */

export const CHANNEL = 'opspulse.sync.v1';
export const LOCK = 'opspulse.leader.v1';

/* Long enough that an ordinary tick gap or a slow engine pass never trips it,
   short enough that a delegate whose tab was closed mid-run is noticed before
   anyone reads the screen as frozen. */
const WATCHDOG_MS = 15000;

/* How long a newly-locked tab waits for an existing writer to answer before
   assuming there isn't one. A BroadcastChannel round-trip is sub-millisecond;
   this is generous enough to survive a busy main thread and still short enough
   that nobody perceives the gap. */
const PROBE_MS = 250;

const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/**
 * @param {object} o
 * @param {boolean|object} [o.enabled]  false to force solo; an object injects
 *        `{ channel, requestLeadership }` for tests that need several peers in
 *        one process (see tools/synccheck.mjs).
 * @param {(msg: object) => void} o.onMessage   a peer said something
 * @param {() => void} o.onLeader   this tab is now the writer
 * @param {() => void} [o.onDemote] this tab just stopped being the writer
 * @param {() => boolean} [o.isRunning] is the simulation meant to be ticking?
 */
export function createSync({ enabled, onMessage, onLeader, onDemote, isRunning }) {
  const inject = enabled && typeof enabled === 'object' ? enabled : null;

  /* Both capabilities are required, and navigator.locks is the load-bearing
     one. A channel without a lock manager would let two tabs each decide they
     are the writer — two simulators, two streams, worse than not syncing at
     all. Node and jsdom have BroadcastChannel but no lock API, which is why
     the harnesses keep running solo exactly as they did before. */
  const capable = typeof BroadcastChannel !== 'undefined'
    && typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function';

  const CH = inject?.channel !== undefined
    ? inject.channel
    : (enabled !== false && capable ? new BroadcastChannel(CHANNEL) : null);

  /* Injectable because every store in a test shares one jsdom document, so a
     global visibility read could never model "A is backgrounded, B is not". */
  const amHidden = inject?.isHidden ?? hidden;

  const requestLeadership = inject?.requestLeadership
    ?? ((grant) => {
      const locks = typeof navigator !== 'undefined' ? navigator.locks : null;
      if (!locks?.request) return false;      // no lock API → caller falls back to solo
      // Held for the lifetime of the tab. The promise never settles, so the
      // lock is released only when this context goes away — which is exactly
      // the event we want to hand leadership on.
      locks.request(LOCK, { mode: 'exclusive' }, () => { grant(); return new Promise(() => {}); })
        .catch(() => grant());                // lock manager unavailable — better a second writer than none
      return true;
    });

  /* No channel means nothing to coordinate with, so this tab is trivially the
     writer. Declaring that up front keeps every caller on one code path. */
  const solo = !CH;
  const id = Math.random().toString(36).slice(2, 10);

  let lockHolder = solo;
  let leader = solo;
  let closed = false;
  let lastSeen = 0;
  let watchdog = null;
  let sawWriter = false;

  const post = (msg) => {
    if (!CH || closed) return;
    // A structured-clone failure on the hot path would kill the simulator for
    // every tab; a dropped frame only costs one tick of freshness.
    try { CH.postMessage(msg); } catch (e) { console.warn('[sync] message not sent', e); }
  };

  function promote(reason) {
    if (leader || closed) return;
    leader = true;
    armWatchdog();
    onLeader(reason);
  }

  function demote() {
    if (!leader || closed) return;
    leader = false;
    lastSeen = Date.now();
    armWatchdog();
    onDemote?.();
  }

  /* Only the lock holder ever watches, and only while it is NOT the writer.
     One watcher, so a reclaim can never produce a second simultaneous writer. */
  function armWatchdog() {
    clearInterval(watchdog); watchdog = null;
    if (closed || !lockHolder || leader) return;
    watchdog = setInterval(() => {
      if (closed || leader || !lockHolder) return;
      if (!isRunning?.()) { lastSeen = Date.now(); return; }   // paused: silence is expected
      if (Date.now() - lastSeen > WATCHDOG_MS) promote('reclaimed');
    }, WATCHDOG_MS / 3);
  }

  if (CH) {
    CH.onmessage = (e) => {
      const m = e.data;
      if (closed || !m || typeof m !== 'object') return;
      lastSeen = Date.now();

      switch (m.t) {
        /* The writer went into the background. Any tab the user can actually
           see should offer to take over. */
        case '__yield':
          if (!leader && !amHidden()) post({ t: '__take', id });
          return;
        /* Someone wants to write. Hand over only if we are hidden — a visible
           writer is already the best place for the simulator to be. */
        case '__take':
          if (leader && amHidden()) { post({ t: '__granted', to: m.id }); demote(); }
          return;
        case '__granted':
          if (m.to === id) promote('delegated');
          return;
        /* A tab just took the lock and is asking whether anyone is already
           writing — because the lock only moves when its holder's tab closes,
           and the writer at that moment may have been a delegate elsewhere. */
        case '__who':
          if (leader) post({ t: '__writing' });
          return;
        case '__writing':
          sawWriter = true;
          armWatchdog();
          return;
        default:
          onMessage(m);
      }
    };

    const granted = requestLeadership(() => {
      if (closed) return;
      lockHolder = true;
      if (leader) { onLeader('lock'); return; }
      /* Ask rather than guess. "No message for a while" would be the cheap
         test, but it cannot tell a writer that just closed from one that is
         still writing — and getting it wrong means either two simulators or a
         stall until the watchdog fires. A live tab answers in microseconds. */
      sawWriter = false;
      post({ t: '__who' });
      setTimeout(() => { if (!closed && !sawWriter && !leader) promote('lock'); }, PROBE_MS);
    });
    if (!granted) { lockHolder = true; queueMicrotask(() => { if (!closed) promote('no-lock-api'); }); }

    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', () => {
        if (closed) return;
        // Became visible and someone else is writing from the background? Offer.
        if (!leader && !amHidden()) post({ t: '__take', id });
        // We are the writer and just went away? Ask for a better host.
        if (leader && amHidden()) post({ t: '__yield' });
      });
    }
  }

  return {
    get isLeader() { return leader; },
    get solo() { return solo; },
    get active() { return !!CH; },
    post(msg) { if (msg && msg.t === undefined) post(msg); },
    close() {
      closed = true;
      clearInterval(watchdog);
      try { CH?.close(); } catch { /* already gone */ }
    },
  };
}
