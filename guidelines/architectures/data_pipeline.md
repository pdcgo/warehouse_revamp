# Data Pipeline Rule.

**Final.** Decided alongside [event_library.md](event_library.md) and moved here when that plan was called final.

These are **not** library scope. [`san_event`](event_library.md) stops at *"a validated, deduped, typed event
reached your handler"*. Everything below is what a service does **next** — and these are the reasons a thin
library is safe.

The broader pipeline design (the log, the statistical tables, replay) is still being argued out in
`disscuss/architecture/data_processing.md` and is **not** authoritative.

---

## 1. Recompute the bucket, never increment

Re-running then produces the same rows, which is what makes *any* rebuild or redelivery safe. An incrementing
projector double-counts every time it sees an event twice — and under a broker that guarantees at-least-once,
it will.

This is what lets the library stop at the contract: **order-independence comes from deltas, retry-independence
comes from recompute.** With both, a service can process however it likes and the library never has to police
it.

## 2. A batch is a dirty-set signal, not the input to the arithmetic

⚠ Three events for 31 July mean **31 July is dirty** — recomputing the day from those three alone wipes the
five hundred already processed for it. Re-read the whole bucket; use the batch only to learn which buckets to
re-read.

## 3. Two detectors, catching disjoint sets

| Detector | Measured in | Sees | Blind to |
| --- | --- | --- | --- |
| **position lag** | arrival order | stalls, dead workers | a projector computing wrong numbers |
| **reconcile** | business time | wrong numbers, missing events | a stall — a stuck consumer's old days reconcile fine |

They are different **axes**, not two views of one number, which is why neither substitutes for the other.

⚠ **Neither sees a silent upstream.** If the publisher stops, nothing arrives, lag sits at zero and every day
reconciles perfectly. A dead source and a quiet warehouse are indistinguishable to both — catching that needs a
liveness expectation, which only the service can set.

⚠ **Alarm on the shape of lag, not the value.** Lag exists every interval, so `lag > 0` is noise. A stall is
lag growing *monotonically*.

## 4. Reconcile is the projector run without writing

Never a second query. A separately written check is a second implementation of the same arithmetic, and when
the two disagree nobody can say which is right — the entire value of reconcile is that it is the same code.

Consequence worth stating: it catches **divergence**, not correctness. A projector that has always been wrong
agrees with itself. Which also makes it the right tool right after fixing one — run it across the retained
range and it names every day needing a rebuild.

## 5. A day is not complete at its boundary

A grace hour absorbs transport lag — a batch interval plus broker latency plus a slow tick. It does **not**
absorb a fact that is late in business terms: a backdated entry, a quarantined row retried next week, a
backfill run next month. Those land in their *own* bucket, weeks back, so checking "yesterday" looks in the
wrong place.

- A **trailing window**, not a single day.
- **One day-boundary function**, shared by projector and reconcile — not "midnight" as a schedule but as a
  definition.
- **Gate on lag**: defer rather than report when the consumer has not caught up, or one root cause fires two
  alarms and the reconcile one reads as corruption.
- **Alert, never auto-rebuild.**
