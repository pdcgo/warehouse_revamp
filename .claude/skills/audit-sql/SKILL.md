---
name: audit-sql
description: Audit an RPC's SQL for CONCURRENCY bugs — lost updates, check-then-act/TOCTOU races, phantom inserts, and deadlocks from inconsistent lock ordering. Reads the write path for the known patterns, then PROVES the verdict against a real Postgres with backend/pkgs/san_race (N-way race + a written-down two-transaction interleaving). Writes audits/services/<service>/concurrency/<Rpc>.md only when something is unsafe. Use after implementing a write RPC, when asked about race conditions, deadlocks, FOR UPDATE, lost updates, double-spend of stock, lock ordering, transaction isolation, or "is this query safe under concurrent callers".
---

# Audit SQL concurrency

The companion to `audit-rpc-performance`. That one asks *is this RPC fast*; this one asks **is this
RPC still correct when two people run it at the same second** — which in this warehouse is the
normal case, not the edge case. Two pickers on the same shelf, a scanner and a phone on the same
stock level, a fulfil and a cancel landing together.

Answers three questions, with a demonstration rather than an opinion:

1. **Lost update** — can two callers read the same number and both write over each other?
2. **Check-then-act** — can the thing a handler verified stop being true before it acts on it?
3. **Deadlock** — do two code paths take the same locks in different orders?

**A report is written ONLY if something is unsafe** ([step 6](#6--verdict-is-it-unsafe)). A safe RPC
produces a one-line answer in chat and no file — `audits/` is a list of *problems*, not a log.

> The report is a **discussion doc**: it names the fix, it does not apply it. Changing a lock,
> adding a constraint, or picking an isolation level is a design decision and the owner's call
> (HARD RULE 8). This skill never rewrites the handler.

Run everything from the repo root unless stated.

---

## 0 — The harness

[`backend/pkgs/san_race/`](../../../backend/pkgs/san_race/) — installed and self-tested.
(`references/san_race.go` is the source if it ever goes missing.)

⚠ **It does NOT use `san_testdb.DB(t)`, and it must not.** That gives every test ONE transaction
that rolls back. Two goroutines sharing one transaction never block on each other's row locks,
never serialize and never deadlock — so a lost update that happens daily in production passes the
test. `san_race` takes `san_testdb.Pool` (committing, real connections) and cleans up by deleting.

| | |
| --- | --- |
| `New(t, tables…)` | → `*Harness`. DELETEs those tables before and after — **list children before parents** |
| `h.DB()` | the committing pool — seed with it, and read the final state from it |
| `h.Race(t, n, fn)` | n callers released **simultaneously** by a barrier → `Results` |
| `res.Count(kind)` / `Failed()` / `Report(t)` | |
| `h.Interleave(t, steps…)` | two transactions in an **exact** order you write down → `Schedule` |
| `Do` / `Block` / `Commit` / `Rollback` | the steps. `Block` = "this one is expected to wait" |
| `Classify(err)` | SQLSTATE → `Deadlock` (40P01), `Serialization` (40001), `LockTimeout` (55P03), `UniqueViolation` (23505), … |
| `Waiters(db)` | `pg_blocking_pids` — who is waiting on whom, by query text |

**`Race` and `Interleave` are not interchangeable, and this is the most important line in the skill:**

| | proves |
| --- | --- |
| `Race` **fails** | the bug is **real** — you have the counter-example |
| `Race` **passes** | **nothing.** The window was not hit. It is not evidence of safety |
| `Interleave` shows the block | the lock actually holds — this is the only proof of *safety* |

So a finding is closed by a Race that breaks it, and a clean bill of health is closed by an
Interleave that shows the lock holding. Never write "safe" off a green Race alone.

---

## 1 — Read the write path first

`graphify query "what does <RpcName> write"`, then read the handler
(`backend/services/<svc>/<svc>_v1/<rpc>.go`) and its helpers. Map, before running anything:

- the **transaction boundary** — what is inside `s.db.WithContext(ctx).Transaction(...)` and what
  leaked outside it,
- every **row it locks** (`clause.Locking{Strength: "UPDATE"}`, `FOR UPDATE`), **in the order it
  takes them**,
- every **read whose value is later written back**, and
- every **check** (`exists`, `status ==`, `on_hand >=`) and the write that depends on it.

That map is the audit. Steps 3–5 confirm or kill each hypothesis; never report an unproven one.

---

## 2 — The patterns, in the order they actually bite

Check the handler against each. The **Safe when** column is what closes it — if none applies,
it is a hypothesis for step 3.

| # | Pattern | Looks like | Safe when |
| --- | --- | --- | --- |
| 1 | **read-modify-write** | `SELECT n` → compute in Go → `UPDATE SET n = <computed>` | the read was `FOR UPDATE`, **or** it is one statement: `SET n = n + ?` |
| 2 | **check-then-act (TOCTOU)** | `if status == PENDING` … then `UPDATE` | the checked row was loaded `FOR UPDATE` **in the same transaction**, and re-checked after the lock |
| 3 | **phantom insert** | "no row like this exists" → `INSERT` | a **UNIQUE index** (or `ON CONFLICT`) backs it. ⚠ `FOR UPDATE` gives you **nothing** here — you cannot row-lock a row that does not exist yet |
| 4 | **unordered multi-row lock** | `WHERE id IN (…) FOR UPDATE`, or a loop over `req.Lines` in caller order | a deterministic order — `ORDER BY id` on the locking read, and the *same* order in every handler |
| 5 | **cross-handler lock inversion** | A locks request→lines, B locks lines→request | one written-down hierarchy. Only a **service-wide sweep** ([step 5](#5--deadlock-the-lock-order-matrix)) sees this |
| 6 | **lock held across a foreign call** | an HTTP call, a Pub/Sub publish, another service's RPC inside `Transaction` | the call is **after** commit. A lock held for a network round-trip is a deadlock multiplier and a latency bug at once |
| 7 | **aggregate-then-write** | `SELECT SUM(qty)` → write a derived total | the **parent** row is locked (`FOR UPDATE` on the batch/request/order), so no sibling can be inserted under the sum |
| 8 | **serialization not retried** | nothing catches 40001 / 40P01 | a retry, or a deliberate decision that the caller retries. A deadlock reaching the user as a 500 is a finding even when the data is intact |
| 9 | **nested `Transaction` = SAVEPOINT** | a helper opens `s.db.Transaction` while already inside one | understood: rolling back the savepoint does **not** release locks the outer transaction took |
| 10 | **advisory lock on the pool** | `pg_advisory_lock` through `*gorm.DB` | taken on a **pinned** connection — session-scoped, so lock and unlock can otherwise land on different connections and leak forever |

**The isolation level is READ COMMITTED** (Postgres default; nothing in this repo raises it). Two
consequences that decide half of the table above:

- Each **statement** takes a fresh snapshot, and an `UPDATE … WHERE` **re-evaluates its predicate
  after waiting** for the lock. So `UPDATE stock_levels SET on_hand = on_hand - ? WHERE id = ? AND
  on_hand >= ?` is safe on its own — the guard is re-checked under the lock.
- A `SELECT` and a later `UPDATE` in the same transaction are **two snapshots**. Everything the
  SELECT saw may have changed. This is pattern 1 and 2, and it is where nearly every real bug is.

---

## 3 — Prove the bug: `Race`

Beside the handler, build-tagged so it never runs in `go test ./...` or CI:

```go
//go:build raceaudit

package inventory_v1_test

func TestRace_StockPick_DoubleSpend(t *testing.T) {
	h := san_race.New(t, "stock_movements", "shelf_batches", "stock_levels")
	seedOneShelfWith(h.DB(), 10) // exactly enough for ONE of the callers
	svc := newService(h.DB())

	res := h.Race(t, 8, func(i int) error {
		_, err := svc.StockPick(ctx, connect.NewRequest(pickTen))
		return err
	})
	res.Report(t)

	// The assertion is on the WAREHOUSE, not on the errors.
	var onHand int64
	h.DB().Raw(`SELECT on_hand FROM stock_levels WHERE id = ?`, id).Scan(&onHand)

	if onHand < 0 {
		t.Fatalf("picked %d units off a shelf holding 10", 10-onHand)
	}
}
```

```sh
cd backend && go test -tags raceaudit -run TestRace_StockPick -v ./services/<svc>/<svc>_v1/
```

Four things that decide whether this test is worth anything:

- **Assert on the DATA, never on the errors.** 7 of 8 callers failing is fine and may be correct.
  A stock level of −60 is the bug. Read the final state back through `h.DB()`.
- **Seed for scarcity.** Give the shelf exactly enough for *one* caller. Eight callers over
  plentiful stock race for nothing.
- **Widen the window on purpose** when the handler has a Go-side gap — a `time.Sleep` between the
  read and the write inside a test double, or simply raise `n`. A race test that needs luck reports
  "safe" on a fast machine.
- **Run it ~20 times** (`-count=20`) before believing a pass. Then still do step 4.

---

## 4 — Prove the FIX (or the safety): `Interleave`

A schedule is a written-down interleaving. It cannot miss the window, because you *are* the
scheduler — this is what turns "it passed 20 races" into "the bug is impossible".

```go
sched := h.Interleave(t,
	san_race.Do("A", "A loads the request FOR UPDATE", loadForUpdate),
	san_race.Block("B", "B loads the same request", loadForUpdate), // must WAIT
	san_race.Do("A", "A sets status=FULFILLED", setFulfilled),
	san_race.Commit("A"),
	san_race.Do("B", "B re-reads status after the lock", reReadStatus), // must see FULFILLED
	san_race.Commit("B"),
)
sched.Report(t)
```

Read the report for exactly two things:

| In the report | Means |
| --- | --- |
| `⏸ blocked, released on the other commit` | the lock holds. **This is the proof of safety** |
| `⚠ EXPECTED TO BLOCK, RETURNED AT ONCE` | **the finding.** The lock you assumed is not held — B read a value A was mid-way through changing |

And then the second half, which is the one people forget: **B must re-check after it acquires the
lock.** A `FOR UPDATE` that blocks correctly and then acts on the status it read *before* blocking
is still broken — it waited politely and then did the wrong thing anyway.

Call `san_race.Waiters(h.DB())` from a second goroutine while a `Block` step is parked if you need
to name the lock; the error message never does.

---

## 5 — Deadlock: the lock-order matrix

A deadlock is **never** a load problem — it is our code taking locks in two different orders, and it
is invisible from inside a single handler. Build the matrix for the whole service:

```sh
rg -n "Locking\{|FOR UPDATE" backend/services/<svc>/
```

For each handler, list the tables it locks **in acquisition order**, then look for any pair whose
orders disagree:

| Handler | Lock order |
| --- | --- |
| `RestockRequestFulfill` | `restock_requests` → `restock_request_lines` → `stock_levels` |
| `RestockRequestCancel` | `restock_requests` → `restock_request_lines` |
| `StockPick` | `stock_levels` (ORDER BY rack) |

Two rules, and a disagreement with either is a finding:

1. **One hierarchy per service**, parent before child, and every handler follows it.
2. **Within one table, a deterministic row order** — `ORDER BY id` on the locking read. Locking N
   rows in caller-supplied order (`req.Lines`) is a deadlock waiting for two operators to scan the
   same two products in opposite orders.

Prove it with `Race(t, 2, …)` where the two callers use opposite orders — `res.Count(san_race.Deadlock)`
should be 0. The matrix goes in `audits/services/<svc>/concurrency/lock-order.md`, service-wide,
**even when it is clean** — it is the only file this skill writes unconditionally, because its value
is being the reference the next handler is checked against.

---

## 6 — Verdict: is it unsafe?

**Any one of these makes it unsafe.** Thresholds for *writing the report*, not SLOs.

| Signal | Unsafe |
| --- | --- |
| a Race drove the data to an impossible state (negative stock, double-fulfil, duplicate row) | **always** |
| a `Block` step returned at once | **always** — the lock is not held |
| a lock acquired after the read it was meant to protect | **always** (pattern 1/2) |
| an existence check with no unique index behind it | **always** (pattern 3) |
| `Count(Deadlock) > 0` at n=2 | **always** — that is a lock-ordering bug, not load |
| a lock held across a network call inside the transaction | **always** (pattern 6) |
| 40001 / 40P01 reaching the caller with no retry | unsafe — a user-visible 500 on a retryable error |
| a unique violation surfacing as `internal` instead of `already_exists` | 🟡 report it, low severity |

Nothing tripped → **no file**. Report in chat:
`StockPick: 8-way race over a 10-unit shelf → on_hand 0, no oversell; interleave shows FOR UPDATE holding — safe.`

Something tripped → write the report.

---

## 7 — Write the report

Path, exactly: **`audits/services/<service_name>/concurrency/<RpcName>.md`** — service directory
including the `_service` suffix, RPC in its proto name
(`audits/services/inventory_service/concurrency/StockPick.md`).

Copy [references/report-template.md](references/report-template.md). It follows the owner's doc
style (CLAUDE.md 8b): tables over prose, an inline `→ Recommend` under **every** finding, and a
**mermaid sequence diagram of the losing interleaving** — a race is a story about time, and a
sequence diagram is the only way it reads in one pass.

Four things the report must not do:

- **Do not apply the fix.** A lock change alters what blocks what, service-wide. It is a discussion.
- **Do not report an unproven race.** "Could theoretically interleave" is not a finding. Either the
  `Race` broke the data or the `Interleave` shows the step not blocking — otherwise it is a
  *hypothesis*, and it goes under `## Suspected, not proved` with the reason it could not be shown.
- **Do not claim safety from a green Race.** Say which Interleave proved it, or say it is unproven.
- **Do not hide the scope.** One RPC racing itself is not one RPC racing its five siblings. Say what
  was not raced in `## Not proved`.

If the file exists, **update it in place** and keep the History table — a re-audit after a fix must
show before/after, not overwrite the evidence.

Finally: `cd frontend && npm run lint:mermaid` (HARD RULE 3), and delete the `raceaudit` test only
if the owner asks — a proven race is worth keeping as a regression test.

---

## Auditing several RPCs at once

Sweep a whole service in two passes, and the order matters:

1. **The lock-order matrix first** ([step 5](#5--deadlock-the-lock-order-matrix)), once, for the
   service. It is cross-handler, so no per-RPC agent can produce it.
2. **Then one subagent per write RPC**, each given this skill's path, its one RPC, and the matrix
   from pass 1. Have each return only `{rpc, unsafe, headline}` so the SQL and the race logs stay
   out of the main context. Carry the graphify rule into the subagent prompts.

Read-only RPCs are out of scope — audit them with `audit-rpc-performance` instead.
