# Development state — product

Decisions: [context_decision.md](../../business/product/context_decision.md). Bundles and discovery have their own
reports ([bundle.md](bundle.md), [discover.md](discover.md)).

## 2026-11-02 — archive, delete, and the product code

| | |
| --- | --- |
| [a-used-product-is-archived-never-deleted](../../business/product/context_decision.md#a-used-product-is-archived-never-deleted) | `ProductArchive` / `ProductUnarchive` / `ProductDelete` (product `00007`, `archived`). Delete asks first whether anything used the product (`ProductHistory` — inventory's ledgers and selling's orders, through `cmd/app_development/product_history.go`) and whether a bundle holds it; a used product is archived instead. The list's Archived tab and the detail's actions; the writes stay the selling team's (`product_writes_selling_only_test`) |
| [the-field-is-product-code-composed-on-write](../../business/product/context_decision.md#the-field-is-product-code-composed-on-write) | product `00008`, selling `00032`, inventory `00033`: `sku` → `product_code`, composed `<team_code>-<part>` on write (`product_code.go`, the team code asked of team_service — `product_team_codes.go`); `san product recompose-codes` rewrites them after a team code changes ([san.md](../../tools/san.md)). About 110 TypeScript files renamed |
| [the-code-is-composed-from-the-team-code](../../business/product/context_decision.md#the-code-is-composed-from-the-team-code) | the same build |

```sh
go test ./backend/services/product_service/... ./backend/cmd/app_development/...
```
