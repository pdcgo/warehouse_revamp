# Development state — supplier

**Pass:** business analysis on the owner's [supplier/context.md](../../business/supplier/context.md), written and
revised five times on 2026-10-06. Questions: [context_clarify.md](../../business/supplier/context_clarify.md) —
**Q10 open: the design_accept**. Decisions: [context_decision.md](../../business/supplier/context_decision.md) — eleven,
one reversed. The lifecycle is at **design_accept**: the CRUD prototype is built and wired to the running app; no
backend change yet.

## Decided

| decision | what it means for the build |
| --- | --- |
| [the-supplier-gets-its-own-service](../../business/supplier/context_decision.md#the-supplier-gets-its-own-service) *(Q6)* | new `backend/services/supplier_service/`, proto `warehouse.supplier.v1` (my spec) · `restock_requests.supplier_id` loses its FK |
| [no-province-city-or-soft-delete](../../business/supplier/context_decision.md#no-province-city-or-soft-delete) *(Q8)* | `suppliers` = id, team_id, name, contact, address, description, timestamps · **delete is hard**, channels cascade |
| [the-supplier-has-no-code](../../business/supplier/context_decision.md#the-supplier-has-no-code) | no `code` anywhere — form, list column, `SupplierSelect` label, test ids · reverses `reversed-the-supplier-keeps-its-code` |
| [the-supplier-lists-only-its-online-stores](../../business/supplier/context_decision.md#the-supplier-lists-only-its-online-stores) · [channel-type-is-the-marketplace-list](../../business/supplier/context_decision.md#channel-type-is-the-marketplace-list) *(Q5, Q7)* | `supplier_channels` = channel_type (the shared `Marketplace` enum, `custom` = OTHER), name, uri, description · no online/offline, no contact/location |
| [only-a-selling-team-has-suppliers](../../business/supplier/context_decision.md#only-a-selling-team-has-suppliers) | `SupplierCreate` refuses a non-selling team — today it does not |
| [a-team-restocks-from-another-teams-supplier](../../business/supplier/context_decision.md#a-team-restocks-from-another-teams-supplier) *(Q1)* · [another-team-sees-everything-of-a-supplier](../../business/supplier/context_decision.md#another-team-sees-everything-of-a-supplier) *(Q3)* · [manage-and-discover-are-two-pages](../../business/supplier/context_decision.md#manage-and-discover-are-two-pages) | cross-team use and the discover page — **after** the CRUD pass |
| [products-hang-off-a-channel](../../business/supplier/context_decision.md#products-hang-off-a-channel) · [linking-products-is-deferred](../../business/supplier/context_decision.md#linking-products-is-deferred) · [statistics-are-deferred](../../business/supplier/context_decision.md#statistics-are-deferred) | `supplier_channel_products` and statistics wait — the parked points are in the clarify |

## What exists — all inside `inventory_service`

| | |
| --- | --- |
| RPCs | `SupplierCreate` · `List` · `ByIds` (cross-team) · `Detail` · `Update` · `Delete` (soft) · `SupplierChannelCreate` · `List` · `Update` · `Delete` |
| tables | `suppliers` (with code, province, city, deleted) · `supplier_channels` (online/offline) · `restock_requests.supplier_id` a real FK, `ON DELETE SET NULL` |
| frontend | `pages/suppliers`, `pages/supplier-detail`, `components/pickers/SupplierSelect` · routes `/inventories/suppliers[/:id]` |

## The CRUD prototype — built 2026-10-06

| | |
| --- | --- |
| the translation step | `features/suppliers/adapt.ts` — pages read and write `SupplierRecord` / `SupplierChannelRecord` (the decided shape) and never the proto. It makes up a code (`generatedSupplierCode`), folds city + province into the address and clears them on save, sends every channel as ONLINE with `channel_type` as its marketplace, reads an old offline row as OTHER with contact · location as its description, and leaves contact/location ABSENT on a channel update so that description survives. **Delete it when supplier_service lands** — the pages do not change |
| pages | `pages/suppliers` (Name · Contact · Address, phone blocks, RefreshOverlay + `listQuery`, New/Edit/Delete for a SELLING team only) · `pages/supplier-detail` (contact, address, description; channels under a horizontal **Channels** tab — channels-are-a-horizontal-tab — by `MarketplaceBadge`; `pending.ts` — one `dropped` mark, the channel description) · `SupplierSelect` (name only) |
| Storybook | `.storybook/supplierStub.ts` + `supplierFixtures.ts` — writeable, TODAY's wire shape (code required, online/offline), plus two decided rules (selling team only, hard delete); reset in `preview.tsx`. Stories: `Pages/Suppliers/Suppliers` (8), `Pages/Suppliers/SupplierDetail` (12), `SupplierSelect` (8) |
| tests | all 949 story tests green · `e2e/suppliers.spec.ts` + `supplier_channels.spec.ts` green against the real server — each makes its own SELLING team (Root as Owner) and switches to it |
| fixtures | suppliers moved out of `fixtures.ts` to team **12** (selling); team 13 holds one supplier that team 12 must never list |

## Next

1. **design_accept** — [Q10](../../business/supplier/context_clarify.md#question): 10a the screens, 10b the move, 10c *Other*.
2. **`supplier_service`** — migrations, proto `warehouse.supplier.v1`, RPCs with a unit test each, the performance and
   concurrency audits. Then point `adapt.ts` at it and delete the translation step.
3. **The move** — if 10b: a one-shot `san` command copies rows keeping their ids, then an `inventory_service`
   migration drops the old tables and the FK.

## Elsewhere

- **The restock side** moved to [restock_clarify.md](../../business/inventory/restock_clarify.md) — Q1 what a restock
  shows after a hard delete (recommend a name snapshot), Q2 the cross-team picker. ⚠ That file is **not** a pass of
  restock.md yet.
- ⛔ The owner's [technical/architecture/context.md:7](../../technical/architecture/context.md) still puts the supplier
  in `product_service` — reported, theirs to edit.
- **"yes" to a two-option question was the LITERAL option both times this pass**, against the recommendation — Q8
  (*drop them?* → drop) and Q6 (*own service, or the built one?* → own). Confirm before recording.
