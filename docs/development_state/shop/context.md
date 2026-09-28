# Development state — shop

**Pass:** business analysis — **first pass** (2026-09-28) on the owner's new
[shop/context.md](../../business/shop/context.md): create, edit, delete, list. Questions:
[context_clarify.md](../../business/shop/context_clarify.md). Nothing decided yet.

## What exists

| | |
| --- | --- |
| proto | `ShopService` in [selling.proto](../../../proto/warehouse/selling/v1/selling.proto) — `ShopCreate`, `ShopList`, `ShopDetail`, `ShopUpdate`, `ShopDelete` (soft), and shop access: `ShopUserList`, `ShopUserAdd`, `ShopUserRemove` |
| service | inside `backend/services/selling_service/` — `shops` and `shop_users` are its tables |
| frontend | `pages/shops`, `pages/shop-detail` |
| shop access | ⚠ `shop_users` is written, and read by nothing else — no RPC or screen enforces it. The settlement importer's shop check will be its first reader |

## Open

| | |
| --- | --- |
| who may work on a shop | [shop Q1](../../business/shop/context_clarify.md#question) — re-routed from importer Q12 |
| is the shop its own service | [shop Q2](../../business/shop/context_clarify.md#question) |
