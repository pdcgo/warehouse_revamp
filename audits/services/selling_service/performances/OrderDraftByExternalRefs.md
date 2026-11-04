# Performance — `OrderDraftService.OrderDraftByExternalRefs`

> 2026-11-04 · probe `backend/services/selling_service/selling_v1/order_draft_by_external_refs_perf_test.go`
> (`go test -tags perfaudit -run TestPerf_OrderDraftByExternalRefs -v ./backend/services/selling_service/selling_v1/`).
> A discussion doc: nothing here was applied.

## Verdict

🟡 **Fast today, linear in the team's drafts.** One query, no N+1, bounded input (≤ 50 refs, one shop). But the only
index it can use, `order_drafts_external_ref_idx` UNIQUE `(team_id, source, external_id)`, cannot seek on
`external_id` because the ask carries no `source` — so Postgres reads every draft of the team (a seq scan when one team
is most of the table, an index range over `team_id` otherwise) and filters.

## Volume

60 000 `order_drafts`: 50 000 in the asked team (ten authors, three sources — two apps and `manual` — five shops) and
10 000 in another team. Drafts never expire, and an app pushing all day is the growth case.

## Numbers

| ask | queries | median wall | plan |
| --- | --- | --- | --- |
| 1 ref (the form's only ask) | 1 | ≈6.6 ms | Seq Scan on order_drafts, 59 999 rows removed by filter, 1 269 buffers |
| 50 refs (the cap) | 1 | ≈15 ms | Index Scan on `order_drafts_external_ref_idx`, Index Cond `team_id = 2 AND external_id = ANY(...)` — the `external_id` part is checked per index entry, not sought; 568 buffers |

Non-SQL time is nil (mapping ≤ 50 rows).

## Why it is not 🔴 yet

The form calls it once per *Create* with one ref, and a finalized draft is deleted with its order, so a team's live
drafts are its unworked backlog. At 50 000 that backlog costs ≈6 ms; it grows ~linearly (≈60 ms at 500 000).

## The fix, if the backlog grows — a schema question, not applied

A new index on the lookup's own key, in a selling migration:

```sql
CREATE INDEX order_drafts_team_shop_external_idx ON order_drafts (team_id, shop_id, external_id);
```

The query would become an index seek per ref (sub-millisecond at any volume). Cost: one more index on every draft
push/update. Alternative without schema: none clean — the team's distinct `source` values are unknown to the caller, so
`(team_id, source, external_id)` cannot be sought without a loose-index-scan CTE.
