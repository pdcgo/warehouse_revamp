# Development state — inventory / batch

The business record is [batch.md](../../business/inventory/batch.md) and [batch_decision.md](../../business/inventory/batch_decision.md);
how a restock mints its batches is restock's [one-batch-per-line](../../business/inventory/restock_decision.md#one-batch-per-line).
The ledgers behind them are [ledgers.md](ledgers.md).

## The screens on the screen rules (2026-11-07)

The owner: *"inisiasi dan kasih keterangan batch itu apa"*. Both batch screens follow
[context_decision.md](../../technical/frontend/context_decision.md) — recorded in a new file,
[batches_decision.md](../../technical/frontend/batches_decision.md):
[the-batches-follow-the-screen-rules](../../technical/frontend/batches_decision.md#the-batches-follow-the-screen-rules) and
[a-batch-says-what-it-is](../../technical/frontend/batches_decision.md#a-batch-says-what-it-is). No proto change.

| | |
| --- | --- |
| the list (`pages/batches`) | title + a line on what a batch is + `BatchExplainer`; `SummaryStrip` (Batch · Nilai siap · Kedaluwarsa ≤ 30 hari); `FilterBar` — search (debounced), `components/ExpirySelect` (Chakra Select with ×), `DateRangePicker`; a row named by the batch's own number with *Restok #… · resi* / *Retur* under it; `TeamItem` for the owner; short dates (`formatUnixDateShort` new in `lib/datetime`); a block per batch on a phone; `EmptyHint` ×2; `ListSkeleton`; `GrowingPager`; `useWarehouseBatches` spreads `listQuery`, returns `teamByProductId`, and the rows sit in `RefreshOverlay` |
| a batch's page (`pages/batch-detail`) | one title row — back (`cameFrom`), *Batch #id* (it was the restock's number), origin and expiry badges, Koreksi (its icon on a phone); `ProductListItem`, owner, *Dari Restok #…* link · resi · who received it; `BatchExplainer`; the lifecycle as `SummaryStrip`; tabs vertical on a desktop and across on a phone; `FilterSearch` for racks; `EmptyHint`; history through `MovementTable`'s reworked mode; `GrowingPager` ×2; skeletons |
| `features/inventory/BatchExplainer` | what a batch is — a tooltip on *Apa itu batch?* (hover, focus, or a click/tap — a phone has no hover; it was a collapsible panel until the owner's *"jangan collapse, tooltips?"*); its story `Features/Inventory/BatchExplainer` |
| Storybook | `.storybook/batchStub.ts` (new) — BatchList, BatchDetail, BatchPlacementList, StockHistory, ProductPlaces for Gudang Pusat's six batches (restocks 503, 507, 398 and a return); `noBatchesAt`; reset in preview |
| stories | BatchList 9, BatchDetail 8, BatchExplainer 2 (`On hover`, `On a tap`) — the two pages had none |
| then | the SKU copies ([sku-is-copyable](../../technical/frontend/batches_decision.md#sku-is-copyable)); *Kedaluwarsa* is the day alone at *Tiba*'s size with how long is left under it — `ExpiryCell` (now `features/inventory/`), `daysUntilUnix` new in `lib/datetime` ([an-expiry-says-how-long-is-left](../../technical/frontend/batches_decision.md#an-expiry-says-how-long-is-left)); the day-alone rule for every screen is [a-day-without-a-time-is-shown-alone](../../technical/frontend/context_decision.md#a-day-without-a-time-is-shown-alone). ⚠ Nothing sets a batch's expiry yet (the accept takes none) — raised, not decided |
| then | a batch's source is a way there — *Restok #503* links to the restock, no resi; a return's *Retur* carries ⚠ `returnLink` (`missing`): `delivery_id` is the restock's number only, so a return's batch has no return number to link (`features/inventory/BatchSource`, `features/inventory/pending.ts`, [a-batch-opens-where-it-came-from](../../technical/frontend/batches_decision.md#a-batch-opens-where-it-came-from)) |
| then | whose goods is `TeamItem size="xs"` — the small avatar and the name, no *Selling* badge — on the list's column and block and on a batch's page (it was a name badge there); `useBatchDetail` returns `owner: Team \| null` beside `ownerName`. The rule for every screen: [a-team-of-a-known-type-shows-no-badge](../../technical/frontend/context_decision.md#a-team-of-a-known-type-shows-no-badge) |
| then | the list filters by team — `TeamSelect` over selling teams, `?team=`, ⚠ `teamFilter` (`dropped`: `BatchListFilter` has no owning team); `pages/batches/pending.ts` extends `BATCH_PENDING` so the return keeps ⚠1 ([the-batch-list-filters-by-team](../../technical/frontend/batches_decision.md#the-batch-list-filters-by-team)). Status (Ada stok / Habis) offered, not asked for |
| then (2026-11-10) | a batch's page is one page of sections — Ditaruh Saat Diterima · Info Batch · Riwayat under `SectionNav` (`pages/batch-detail/sections.ts`), the heading sticking with the product under the number (`components/BatchTitleRow`, `useStickyTitle`, `ProductStickyStrip`), Info beside the rest from `xl`. Info holds Dari (`BatchSource`, its `prefix` retired), Diterima oleh, Harga satuan, Kedaluwarsa; `ExpiryCell` moved to `features/inventory/` with a `fontSize`. Stories: BatchDetail 10 (`One page of sections`, `Title sticks` new), one file ([a-batch-page-is-one-page-of-sections](../../technical/frontend/batches_decision.md#a-batch-page-is-one-page-of-sections)) |
| then (2026-11-10) | Koreksi (`features/inventory/AdjustStockDialog`, opened from a batch's page and a warehouse product's): the reason is `RadioPills` ([the-adjust-reason-is-a-radio-pill](../../technical/frontend/batches_decision.md#the-adjust-reason-is-a-radio-pill)), the note a two-row `Textarea`, the batch `components/pickers/BatchSelect` — a Combobox by the batch's own number ([a-batch-is-picked-by-its-own-number](../../technical/frontend/batches_decision.md#a-batch-is-picked-by-its-own-number)); its story `Components/Pickers/BatchSelect` (4) |
| e2e | found_requests.spec opens a batch's page for Koreksi (`batch-detail-adjust`, unchanged); none drives the rest of the batch pages |

## Not yet

- The batch page's history and placements reads are query hooks already, but the detail aggregate (`useBatchDetail`)
  is five reads behind one query — unchanged.
- A batch's *Koreksi* opens the shared stock dialog for the product, not for this batch alone — unchanged.
- ⚠ NOT FINISHED (2026-11-11) — **a batch's page is the only one on a grey canvas.** `usesGreyCanvas` in
  `layouts/shell.ts` paints `/inventories/batches/…` `gray.100`; it came with the repo's first commit (2026-08-19) and no
  decision names it. Every other detail page — a rack's, a product's — is white, and the batch page is their shape since
  [a-batch-page-is-one-page-of-sections](../../technical/frontend/batches_decision.md#a-batch-page-is-one-page-of-sections).
  Recommended to the owner: drop it, and the mechanism with it (`usesGreyCanvas`, `GREY_CANVAS`, and the two layout
  stories that pin it). Asked, not answered — the owner said *"commit aja, tandai belum selesai"*.
- When Koreksi's *Ditemukan* is sent from a batch's page, the units do not necessarily go back into THAT batch — the
  approval picks (the oldest open loss, else a new batch). The dialog does not say so but on the waiting line's hover;
  raised with the owner, not answered.
