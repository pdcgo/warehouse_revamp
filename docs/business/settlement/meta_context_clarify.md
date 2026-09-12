# Clarity — `meta_context.md`

What I read out of [meta_context.md](./meta_context.md). **That doc is yours — this one is mine.**

> **Re-examined 2026-09-02.** ✅ `analytic_status` (`live` / `recompute`) is **gone**, and with it my
> objection that a global mode cannot describe a per-shop-per-day job. What replaced it is a different
> and more defensible thing: `process_event_lock`, a developer's maintenance switch. My question about
> the table's *purpose* survives the swap and is sharper for it — a switch a person flips is the clearest
> possible case of configuration living in a table that also wants to hold state.

## Critique

| | Problem | → Recommend |
| --- | --- | --- |
| **1** | ⚠ **`value` is a `string` holding `{ lock: true|false }`** — JSON in a text column, and a boolean wrapped in an object. Nothing parses it, nothing validates it, and a typo reads as neither true nor false. The fold then has to decide what an unparseable lock means, and in practice it will read as *unlocked* — so the guard silently stops existing at the moment it is misconfigured. | **`jsonb`, or state plainly that `value` is an opaque encoded blob each key defines.** And whichever it is, an unrecognised value must be an **error the handler surfaces**, never a fallback — for a lock, failing open is the wrong direction. |
| **2** | ⛔ **A lock in a metadata table has no owner and no lease.** `pg_advisory_lock` is released when its session ends — a row is not. If the process holding it dies, or a person sets it and goes home, the pipeline stays stopped and only another person can restart it. ⚠ Nothing says who releases it or when. | **Record `locked_by` and `locked_at` beside it, and put a stated maximum on the window** — see [analytic Critique 5](./analytic_context_clarify.md#critique), because a long hold does not merely pause the pipeline, it dead-letters good events. If the lock is ever needed for *correctness* rather than maintenance, it should be an advisory lock instead, which cannot outlive its holder. |
| **3** | ⚠ **Nothing says who may WRITE a metadata row, or whether writes are recorded.** A key/value table reachable by RPC is the easiest thing in a service to change and the hardest to notice having changed — and this key stops every report in the service from updating. `## Access Role.` defers roles for settlement generally ([no-role-policy-yet](./context_decision.md#no-role-policy-yet)), which is right for the ledger's reads and wrong for this. | **`[ROLE_ROOT, ROLE_ADMIN]`, unscoped**, plus `updated_at` and `updated_by` on the row. Two columns, and they are the difference between a change you can explain afterwards and one you can only observe. |
| **4** | ⚠ **The lock is read on every event, from a table.** One extra round trip per message, on the hot path, for a value that changes a few times a year. | **Read it inside the fold's own transaction** so it cannot go stale mid-compute, or cache it with a short TTL. Not urgent — worth one sentence so it is a decision rather than an accident. |

## Question

1. ⚠ **Is `settlement_service_metadata` CONFIGURATION or STATE?** The doc says *"metadata &
   configuration"*, and those are opposite lifecycles: configuration is set by a person and read by the
   service, state is set by the service and read by a person. `process_event_lock` is clearly the
   **first** — which reverses what I expected when `analytic_status` was the only key, and it matters
   because the two want different guarantees (an audit trail versus a fast read).
   **→ I recommend saying this table is CONFIGURATION — human-set, service-read** — with `updated_by` /
   `updated_at` on every row, and that anything the service writes about *itself* (a run's progress, a
   watermark) gets its own typed table rather than a string in here.

## Awaiting

- **`key` is unique and scoped to nothing.** Fine while every key is service-global. Worth saying so
  **now** — *keys are service-global by definition, per-scope state gets its own table* — because the day
  a per-team key appears the uniqueness has to change shape.
- **No `updated_at`.** For a switch, *when it was flipped* is most of the information.
