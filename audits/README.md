# audits/

Assessments of implemented RPCs. Two kinds, and they ask different questions:

```
audits/services/<service_name>/performances/<RpcName>.md   is it FAST?     (audit-rpc-performance)
audits/services/<service_name>/concurrency/<RpcName>.md    is it CORRECT   (audit-sql)
                                                           when two people
                                                           run it at once?
audits/services/<service_name>/concurrency/lock-order.md   the service's lock hierarchy
```

**A file here means something is WRONG.** An RPC that measured fine, or that was proved safe, gets
no file — this tree is a list of *problems*, not a log of every RPC. So the absence of a file means
one of two things, and they are not the same: it was audited and was fine, or it was never audited.
Each report's `History` table says when it was last run.

`lock-order.md` is **the one exception** — it is written even when clean, because its value is being
the reference the next handler is checked against.

Thresholds live in the skills, not here:

| Skill | Writes a file when |
| --- | --- |
| **`audit-rpc-performance`** | N+1 at any size, >5 queries, >150 ms median, >50 ms single query, a seq scan on a growing table, >40% of wall time outside the database, an unbounded read |
| **`audit-sql`** | a race drove the data to an impossible state, a lock that was assumed held is not, a check-then-act with nothing behind it, a deadlock at n=2, a lock held across a network call, a retryable error reaching the caller |

> These are **discussion documents**. A report names the fix and its trade-off; it does not apply
> it. Acting on one — especially an index migration or a lock change, which belong to the owning
> service and alter what blocks what across it — is a separate, explicitly-asked task (HARD RULE 3,
> HARD RULE 8).
