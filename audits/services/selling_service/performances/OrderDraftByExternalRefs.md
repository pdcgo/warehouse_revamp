# Performance — `OrderDraftService.OrderDraftByExternalRefs`

> 2026-11-05 (re-measured; first audit 2026-11-04) · probe
> `backend/services/selling_service/selling_v1/order_draft_by_external_refs_perf_test.go`
> (`go test -tags perfaudit -run TestPerf_OrderDraftByExternalRefs -v ./backend/services/selling_service/selling_v1/`).

## Verdict

✅ **Fixed 2026-11-05 — an index seek per ref, flat in the team's drafts.** One query, no N+1, bounded input (≤ 50 refs,
one shop). The 2026-11-04 audit found it 🟡 linear in the team's drafts: the only usable index,
`order_drafts_external_ref_idx` UNIQUE `(team_id, source, external_id)`, could not seek on `external_id` because the ask
carries no `source`. Selling migration `00037_order_drafts_external_ref_lookup.sql` adds the lookup's own key:

```sql
CREATE INDEX order_drafts_team_shop_external_idx ON order_drafts (team_id, shop_id, external_id);
```

## Volume

60 000 `order_drafts`: 50 000 in the asked team (ten authors, three sources — two apps and `manual` — five shops) and
10 000 in another team. Drafts never expire, and an app pushing all day is the growth case.

## Numbers

| ask | queries | median wall | plan | before the index (2026-11-04) |
| --- | --- | --- | --- | --- |
| 1 ref (the form's only ask) | 1 | ≈0.52 ms | Index Scan on `order_drafts_team_shop_external_idx`, Index Cond `team_id = 2 AND shop_id = 31 AND external_id = …`, 7 buffers, 0.03 ms execution | ≈6.6 ms · Seq Scan, 59 999 rows removed, 1 269 buffers |
| 50 refs (the cap) | 1 | ≈0.56 ms | the same index, `external_id = ANY(…)` sought; 3 rows removed by the `source <> 'manual'` filter, 160 buffers, 0.11 ms execution | ≈15 ms · range over `team_id` on the unique index, 568 buffers |

Non-SQL time is nil (mapping ≤ 50 rows). The wall is now the loopback round-trip, not the plan.

## Cost of the fix

One more index on every draft push/update (`OrderDraftPush` inserts or updates one row; the index adds one entry). The
`manual` filter stays a row filter — a `manual` draft's external id is a minted form id, so it almost never shares a
marketplace ref, and the filter removes nothing in practice.
