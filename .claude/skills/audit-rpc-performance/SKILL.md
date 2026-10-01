---
name: audit-rpc-performance
description: Audit an RPC's performance after implementing it — measure wall time, count and time every SQL query it issues, EXPLAIN ANALYZE the expensive ones, and detect N+1 / seq-scan / unbounded-read problems. Writes audits/services/<service>/performances/<rpc>.md with fix recommendations ONLY when something is heavy. Use after implementing or changing an RPC, when asked about RPC latency, slow queries, query cost, N+1, missing indexes, or "is this RPC fast enough".
---

# Audit RPC performance

Runs **after an RPC is implemented and green**. Answers three questions with numbers, not opinion:

1. **Latency** — how long the handler takes end to end.
2. **SQL cost** — how many queries, how long each, and what the planner actually does.
3. **Time processing** — how much of the wall time is *not* the database (mapping, N× loops, encoding).

**A report is written ONLY if something is heavy** ([step 5](#5--verdict-is-it-heavy)). A fast RPC
produces a one-line answer in chat and no file — the `audits/` tree is a list of *problems*, not a
log of every RPC.

> The report is a **discussion doc**: it names the fix, it does not apply it. Applying a fix is a
> separate, explicitly-asked task — this skill never rewrites the handler.

Run everything from the repo root unless stated.

---

## 0 — The probe

[`backend/pkgs/san_perf/`](../../../backend/pkgs/san_perf/) is the query recorder — installed and
tested. (If it is ever missing, `references/san_perf.go` here is the source; copy it back.)

It is a **GORM session logger**, not a callback — a session logger rides the cloned Config, so it
reaches everything the handler derives from the wrapped db (`WithContext`, `Model`, `Transaction`)
and nothing else. A callback would live on the process-wide root `san_testdb` hands sessions off,
and would record every other test in the package.

| | |
| --- | --- |
| `Wrap(db)` | → `(*gorm.DB, *Probe)` — hand the db to the service constructor |
| `SeedRows(t, db, rows)` | bulk insert **+ `ANALYZE`**, invisible to the probe |
| `probe.Measure(fn)` | → `(wall, db)` — the gap between them is the non-SQL cost |
| `probe.Count()` / `DBTotal()` / `Queries()` / `Reset()` | |
| `probe.Report(t, name)` | the markdown table, grouped by query shape with a `×N ⚠` repeat count |
| `Explain(t, db, sql)` | `EXPLAIN (ANALYZE, BUFFERS)` **on the test's own transaction** |
| `Median(ds)` | |

---

## 1 — Read the handler before measuring

`graphify query "what queries does <RpcName> run"`, then read the handler file
(`backend/services/<svc>/<svc>_v1/<rpc>.go`) and its mapper.

Note, without running anything yet:

- every `Find` / `First` / `Count` / `Pluck` / `Preload` / `Raw`, and whether any sits **inside a
  loop or a mapper** (that is an N+1 before you measure it),
- what the filter and sort columns are — you will check them against the service's
  `db_migrations/` for an index,
- whether the read is **bounded** (HARD RULE 9 pagination) or can return the whole table.

This read produces the *hypotheses*. Steps 2–4 confirm or kill them; never report an unmeasured one.

---

## 2 — Seed realistic volume, or the whole audit is worthless

**An EXPLAIN on an empty table is a lie.** Postgres seq-scans anything under a few hundred rows no
matter what indexes exist, and every plan comes back at 0.02 ms. A perf test on the 3 rows a unit
test inserts measures nothing.

Seed inside the test transaction (it rolls back, so the database stays clean):

```go
db, probe := san_perf.Wrap(san_testdb.DB(t))
san_perf.SeedRows(t, db, rows)          // CreateInBatches + ANALYZE, invisible to the probe
```

`SeedRows` runs `ANALYZE` and that is **not** decoration: freshly inserted rows have no statistics,
autovacuum never runs inside a transaction, so without it the planner sizes the table at its default
guess and picks a plan unrelated to the one production gets. Hand-rolled seeding must do the same.

Default volumes — pick by what the table *will* hold in this warehouse, not what it holds today:

| Table kind | Seed | Examples |
| --- | --- | --- |
| transaction / movement / log | **50 000** | stock movements, restock items, order items |
| entity | **10 000** | products, users, racks |
| reference | **200** | couriers, categories |

Say in the report which volumes were used. A number without its volume is not a measurement.

---

## 3 — Measure: write `<rpc>_perf_test.go`

Beside the handler, build-tagged so it never runs in `go test ./...` or CI:

```go
//go:build perfaudit

package inventory_v1_test

func TestPerf_StockList(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	san_perf.SeedRows(t, db, stockRows(50_000))
	svc := newService(db)

	_, err := svc.StockList(ctx, connect.NewRequest(req))   // warm-up: schema reflection, pool
	if err != nil {
		t.Fatalf("StockList: %v", err)
	}

	walls := make([]time.Duration, 0, 5)

	for range 5 {
		probe.Reset()

		wall, dbTime := probe.Measure(func() {
			_, err = svc.StockList(ctx, connect.NewRequest(req))
		})

		walls = append(walls, wall)
		t.Logf("wall=%v db=%v go=%v queries=%d", wall, dbTime, wall-dbTime, probe.Count())
	}

	t.Logf("median wall %v", san_perf.Median(walls))
	probe.Report(t, "StockList")
}
```

Run it:

```sh
cd backend && go test -tags perfaudit -run TestPerf_StockList -v ./services/<svc>/<svc>_v1/
```

**Measure warm, not cold.** The first call pays for connection setup and GORM's schema reflection,
which is not the RPC's cost. And take the **median of 5**, not one sample — a single run on a laptop
with docker on it is noise.

**Run it at two page sizes** (say 20 and 200). If `probe.Count()` moves with the row count, that is
an N+1, and it is heavy however small the absolute number is. This is the single most valuable line
of the whole audit — do not skip it because the totals looked fine.

---

## 4 — EXPLAIN the expensive queries

For every query over **10 ms**, or any query on a growing table:

```go
plan := san_perf.Explain(t, db, probe.Queries()[0].SQL)   // SQL is already interpolated
```

⚠ **It must run on the test's own transaction — never from `psql`.** The seed rows live inside the
per-test transaction that `san_testdb` rolls back, so any other connection plans against an *empty*
table and reports a meaningless 0.02 ms seq scan. `san_perf.Explain` uses the passed `db` for
exactly this reason.

Read the plan for, in this order:

| Look for | Means |
| --- | --- |
| `Seq Scan` on a growing table | no usable index for the filter — the query gets slower forever |
| `Rows Removed by Filter` ≫ rows returned | the index is being used but is the wrong shape (or the filter is not sargable) |
| estimated `rows=` vs `actual rows=` off by >10× | stale stats or a correlated filter — the planner is choosing badly on bad information |
| `Sort Method: external merge Disk` | work_mem spill; usually means sorting a set that should have been narrowed first |
| `Nested Loop` with a high `loops=` | the plan-level version of an N+1 |
| high `read=` in BUFFERS with low `hit=` | the working set does not fit in cache — index or narrower columns |

Then check the service's own `db_migrations/` for whether the index the plan wants exists. Index
recommendations go in the report as a **proposed migration**, never applied here (HARD RULE 3 —
that migration belongs to the owning service, and it is the owner's call).

---

## 5 — Verdict: is it heavy?

**Any one of these makes it heavy.** They are thresholds for *writing the report*, not SLOs.

| Signal | Heavy at |
| --- | --- |
| **N+1** — query count grows with row count | **always heavy, at any absolute number** |
| queries per call | > 5 |
| median wall time (warm, seeded) | > 150 ms |
| any single query | > 50 ms |
| plan | `Seq Scan` on a table that grows, or a disk sort |
| non-DB time (`wall − db`) | > 40% of wall — the work is in Go, not the query |
| result size | unbounded (no `PageFilter` — this is also a HARD RULE 9 violation) or > 1 000 rows per page |

Nothing tripped → **no file**. Report in chat: `StockList: 3 queries, 18 ms median @50k rows — not heavy.`

Something tripped → write the report.

---

## 6 — Write the report

Path, exactly: **`audits/services/<service_name>/performances/<rpc_name>.md`** —
service directory name including the `_service` suffix, RPC in its proto name
(`audits/services/inventory_service/performances/StockList.md`).

Copy [references/report-template.md](references/report-template.md) and fill it. It follows the
owner's doc style (CLAUDE.md 8b): **tables over prose, a `→ Recommend` inline under every finding,
a mermaid diagram of where the time goes, and an `## Open questions` for what needs the owner.**

Three things the report must not do:

- **Do not apply the fix.** The report is input to a discussion. Recommendations are written as
  proposals with their trade-off, including the one you would pick.
- **Do not report an unverified cause.** "Probably a missing index" is not a finding — the plan
  either shows a seq scan or it does not.
- **Do not hide what you did not measure.** Concurrency, cache-cold behaviour, and production data
  distribution are all outside this audit. Say so in `## Not measured`.

If the file already exists, **update it in place** — keep the history table at the bottom so a
re-audit after a fix shows the before/after rather than silently overwriting the evidence.

Finally, run `cd frontend && npm run lint:mermaid` — the diagram must parse (HARD RULE 3).

---

## Auditing several RPCs at once

For a sweep (a whole service, or the governed-RPC list), spawn **one subagent per RPC** so the
EXPLAIN output and benchmark logs stay out of the main context. Give each agent this skill's path,
the one RPC, and the seed volumes; have it return only `{rpc, heavy, headline}`. Then read the
files it wrote. Carry the graphify rule into the subagent prompts.
