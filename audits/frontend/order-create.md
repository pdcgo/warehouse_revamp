# order-create — frontend speed audit

Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool](../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: #121 #122 #123. Page `frontend/src/pages/order-create`, route `/orders/new`, opened as **seller**.

**Verdict:** 9 screen requests on a warm load (+3 shell); 2-deep waiting chains (TeamList → WarehouseReceivingStatus); no duplicate; usable in 678 ms; its save fired 8 request(s) after (recorded); typing into the buyer name: 1 commit(s) · 3826 components per keystroke · 0 trailing; typing into the address: 2 commit(s) · 4213 components per keystroke · 0 trailing; typing into the quantity: 1 commit(s) · 4079 components per keystroke · 2 trailing.

**Measured:** 2026-11-21 · `frontend/src` tree `3dee851ef19c` + 209 uncommitted file(s) · production build `f036740605e9837d` (`vite build` + `vite preview`) · seed 60 products · 10 racks (rack A 45 lines) · 30 restocks accepted + 10 open · 30 liability entries · 2 shops · 1 cold + 5 warm load(s) · typing 2 pass(es) a field · quiet machine.

| measure | value |
| --- | --- |
| requests per load (warm) | 12 — shell 3 · screen 9 |
| requests, cold load | 12 |
| same RPC asked twice | 0 |
| CORS pre-checks (OPTIONS) | 0 warm · 10 cold |
| waiting chain (measured) | depth 2 (2 over 2 dependency passes) — TeamList → WarehouseReceivingStatus |
| time until usable | 678 ms median (651–714, 5 warm) · cold 1196 ms |
| counts agree across warm loads | yes |
| requests after one save | 8 — recorded (OrderCreate (customer, warehouse, shop, courier, a product, today, a price, the ref, a receipt) — opens the order) — LiabilityPositionList · OrderDetail · OrderTagList · ShipmentChannelList · OrderSettlementDetail · UserByIDs · ShopList · ProductByIds |
| open ProductPicker (the warehouse picked first) | 4 request(s) — OwnerStockByIds ×1 · ProductList ×1 · StockAvailability ×1 · TeamByIds ×1 |
| typing: buyer name (`order-create-customer-name`, 10 keys) | 1 commit(s) · 3826 components per keystroke · 0 trailing |
| typing: address (`address-line`, 10 keys) | 2 commit(s) · 4213 components per keystroke · 0 trailing |
| typing: quantity (`order-line-qty-0`, 10 keys) | 1 commit(s) · 4079 components per keystroke · 2 trailing |

## Requests

The reference warm load, every Connect call: how many times, its wave in the waiting chain (1 = fired at once), and whether one was a duplicate.

| RPC | count | wave | duplicate |
| --- | --- | --- | --- |
| `AuthService/CheckAccess` | 1 | shell |  |
| `LiabilityService/LiabilityPositionList` | 1 | shell |  |
| `UserService/TeamAccessList` | 1 | shell |  |
| `RegionService/RegionList` | 1 | 1 |  |
| `ShipmentChannelService/ShipmentChannelList` | 1 | 1 |  |
| `ShopService/ShopList` | 2 | 1 |  |
| `TeamService/TeamDetail` | 1 | 1 |  |
| `TeamService/TeamList` | 3 | 1 |  |
| `WarehouseInfoService/WarehouseReceivingStatus` | 1 | 2 |  |

After the save (`OrderCreate`), in the order they fired: LiabilityPositionList · OrderDetail · OrderTagList · ShipmentChannelList · OrderSettlementDetail · UserByIDs · ShopList · ProductByIds. The save navigated to `/orders/1` — that screen's load is counted here.

## Typing

What React draws while a person types (P2): each field typed 2 time(s) on a fresh load, its keys pressed one by one with two animation frames after each, then 500 ms of quiet for the trailing commits. Commits and components are per keystroke (the median); a figure like `1·2` is two passes that disagree. The components are named by the audit's build (`esbuild.keepNames`), their renders summed over the keys and the quiet: where each re-render STARTS (a component that rendered while the one above it did not — its state, or a context it reads, changed), then the app's own components (declared in frontend/src) and every component, Chakra's and emotion's internals included, rendered most.

| field | keys | commits/key | components/key | trailing | re-renders start at | the app's, most | every, most |
| --- | --- | --- | --- | --- | --- | --- | --- |
| buyer name (`order-create-customer-name`) | 10 | 1 | 3826 | 0 | OrderCreatePage ×10 (3826 a time) | ShipmentChannelBadge ×110, CardTitle ×100, MarketplaceBadge ×90, Button ×70, ConfirmDialog ×40 | (anonymous) ×8980, Insertion ×7520, DatePickerTableCell ×2280, DatePickerTableCellTrigger ×2280, chakra(DatePickerTableCell) ×1140 |
| address (`address-line`) | 10 | 2 | 4213 | 0 | OrderCreatePage ×10 (3826 a time), FieldRoot ×190 (3 a time), ComboboxItem ×140 (3 a time), RadioGroupItem ×20 (13 a time), ComboboxContent ×80 (3 a time) | ShipmentChannelBadge ×110, CardTitle ×100, MarketplaceBadge ×90, Button ×70, ConfirmDialog ×40 | (anonymous) ×10740, Insertion ×7610, DatePickerTableCell ×2280, DatePickerTableCellTrigger ×2280, chakra(DatePickerTableCell) ×1140 |
| quantity (`order-line-qty-0`) | 10 | 1 | 4079 | 2 | OrderCreatePage ×13 (4079 a time), FieldRoot ×19 (3 a time), ComboboxItem ×14 (3 a time), RadioGroupItem ×2 (13 a time), ComboboxContent ×8 (3 a time) | ShipmentChannelBadge ×143, Button ×130, CardTitle ×130, MarketplaceBadge ×117, ConfirmDialog ×52 | (anonymous) ×12162, Insertion ×10696, DatePickerTableCell ×2964, DatePickerTableCellTrigger ×2964, chakra(div) ×1537 |

## Findings

A discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.

1. **2 commit(s) after the typing stops** in the quantity — a read keyed by the field (a quote, a picker search) or a debounced one answering once the person paused, its answer drawn. Expected where the field searches or prices; anywhere else it is a re-render nothing asked for.
2. **Each keystroke re-renders the form, not the field** — components per keystroke: the buyer name 3826 (1 commit(s)), the address 4213 (2 commit(s)), the quantity 4079 (1 commit(s)), the widest re-render starting at OrderCreatePage ×10 (3826 a time) (the Typing table names the rest). *Fix:* hold the form in one useReducer and pass each card only its slice, memoised, so a key re-renders the card it is in (no-global-store-every-read-is-a-query-hook — a many-field form is one useReducer). *Trade-off:* the cards take props they compare, and a callback passed down needs a stable identity.
3. **What the code does** — Every field is its own useState (30 of them) — the form #123 works on. Its save (P2) is the whole OrderCreate a person types — the warehouse, a shop, a courier, one product, today, a price, the ref, a receipt file — and opens the order it made, so the requests after it are the order page's load. The product picker opens only once a warehouse is picked: its probe picks one first, uncounted.

## History

| Date | requests | dup | chain | usable ms | after save | commits/key | change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 9 | 0 | 1 | 1210 (noisy) | — | — | first baseline (P1) |
| 2026-11-21 | 9 | 0 | 2 | 678 | 8 | buyer name 1 · address 2 · quantity 1 | chain 1→2; typing first measured (P2); its save first measured (P2) |
