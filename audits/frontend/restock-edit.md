# restock-edit — frontend speed audit

Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool](../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: #121 #122. Page `frontend/src/pages/restock-form`, route `/inventories/restock/{open_restock}/edit`, opened as **seller**.

**Verdict:** 7 screen requests on a warm load (+3 shell); 2-deep waiting chains (RestockRequestDetail → FinancialAccountList · RestockRequestDetail → ProductByIds · RestockRequestDetail → RestockRequestList · RestockRequestDetail → ShipmentChannelList · RestockRequestDetail → SupplierByIds · RestockRequestDetail → TeamList); no duplicate; usable in 984 ms; its save fired 12 request(s) after (recorded); typing into the line quantity: 1 commit(s) · 3268 components per keystroke · 0 trailing; typing into the note: 1 commit(s) · 3268 components per keystroke · 0 trailing.

**Measured:** 2026-11-21 · `frontend/src` tree `3dee851ef19c` + 209 uncommitted file(s) · production build `f036740605e9837d` (`vite build` + `vite preview`) · seed 60 products · 10 racks (rack A 45 lines) · 30 restocks accepted + 10 open · 30 liability entries · 2 shops · 1 cold + 5 warm load(s) · typing 2 pass(es) a field · quiet machine.

| measure | value |
| --- | --- |
| requests per load (warm) | 10 — shell 3 · screen 7 |
| requests, cold load | 10 |
| same RPC asked twice | 0 |
| CORS pre-checks (OPTIONS) | 0 warm · 10 cold |
| waiting chain (measured) | depth 2 (2 over 2 dependency passes) — RestockRequestDetail → FinancialAccountList · RestockRequestDetail → ProductByIds · RestockRequestDetail → RestockRequestList · RestockRequestDetail → ShipmentChannelList · RestockRequestDetail → SupplierByIds · RestockRequestDetail → TeamList |
| time until usable | 984 ms median (962–1019, 5 warm) · cold 1502 ms |
| counts agree across warm loads | yes |
| requests after one save | 12 — recorded (RestockRequestUpdate (the note) — saves and opens the restock) — RestockRequestDetail · RestockRequestList · LiabilityPositionList · RestockRequestList · RestockActorList · RestockActorList · RestockTagList · UserByIDs · UserByIDs · UserByIDs · SupplierByIds · ShipmentChannelByIds |
| open ProductPicker | 5 request(s) — OwnerStockByIds ×2 · ProductByIds ×1 · ProductList ×1 · TeamByIds ×1 |
| typing: line quantity (`restock-qty-0`, 10 keys) | 1 commit(s) · 3268 components per keystroke · 0 trailing |
| typing: note (`restock-note`, 10 keys) | 1 commit(s) · 3268 components per keystroke · 0 trailing |

## Requests

The reference warm load, every Connect call: how many times, its wave in the waiting chain (1 = fired at once), and whether one was a duplicate.

| RPC | count | wave | duplicate |
| --- | --- | --- | --- |
| `AuthService/CheckAccess` | 1 | shell |  |
| `LiabilityService/LiabilityPositionList` | 1 | shell |  |
| `UserService/TeamAccessList` | 1 | shell |  |
| `FinancialAccountService/FinancialAccountList` | 1 | 2 |  |
| `ProductService/ProductByIds` | 1 | 2 |  |
| `RestockRequestService/RestockRequestDetail` | 1 | 1 |  |
| `RestockRequestService/RestockRequestList` | 1 | 2 |  |
| `ShipmentChannelService/ShipmentChannelList` | 1 | 2 |  |
| `SupplierService/SupplierByIds` | 1 | 2 |  |
| `TeamService/TeamList` | 1 | 2 |  |

After the save (`RestockRequestUpdate`), in the order they fired: RestockRequestDetail · RestockRequestList · LiabilityPositionList · RestockRequestList · RestockActorList · RestockActorList · RestockTagList · UserByIDs · UserByIDs · UserByIDs · SupplierByIds · ShipmentChannelByIds. The save navigated to `/inventories/restock` — that screen's load is counted here.

## Typing

What React draws while a person types (P2): each field typed 2 time(s) on a fresh load, its keys pressed one by one with two animation frames after each, then 500 ms of quiet for the trailing commits. Commits and components are per keystroke (the median); a figure like `1·2` is two passes that disagree. The components are named by the audit's build (`esbuild.keepNames`), their renders summed over the keys and the quiet: where each re-render STARTS (a component that rendered while the one above it did not — its state, or a context it reads, changed), then the app's own components (declared in frontend/src) and every component, Chakra's and emotion's internals included, rendered most.

| field | keys | commits/key | components/key | trailing | re-renders start at | the app's, most | every, most |
| --- | --- | --- | --- | --- | --- | --- | --- |
| line quantity (`restock-qty-0`) | 10 | 1 | 3268 | 0 | RestockFormPage ×10 (3268 a time) | Button ×460, ShipmentChannelBadge ×110, CurrencyInput ×90, SupplierBox ×90, SupplierChannelPicker ×90 | Insertion ×7580, (anonymous) ×4980, chakra(div) ×1870, Stack ×1090, FieldRoot ×800 |
| note (`restock-note`) | 10 | 1 | 3268 | 0 | RestockFormPage ×10 (3268 a time) | Button ×460, ShipmentChannelBadge ×110, CurrencyInput ×90, SupplierBox ×90, SupplierChannelPicker ×90 | Insertion ×7580, (anonymous) ×4980, chakra(div) ×1870, Stack ×1090, FieldRoot ×800 |

## Findings

A discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.

1. **Each keystroke re-renders the form, not the field** — components per keystroke: the line quantity 3268 (1 commit(s)), the note 3268 (1 commit(s)), the widest re-render starting at RestockFormPage ×10 (3268 a time) (the Typing table names the rest). *Fix:* hold the form in one useReducer and pass each card only its slice, memoised, so a key re-renders the card it is in (no-global-store-every-read-is-a-query-hook — a many-field form is one useReducer). *Trade-off:* the cards take props they compare, and a callback passed down needs a stable identity.
2. **What the code does** — The restock is already a query (useRestockRequest); its covers are a useEffect ProductByIds (pages/restock-form/index.tsx) — #122. The pickers run their own effects — #121.

## History

| Date | requests | dup | chain | usable ms | after save | commits/key | change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 7 | 0 | 2 | 1300 (noisy) | 12 | — | first baseline (P1) |
| 2026-11-21 | 7 | 0 | 2 | 984 | 12 | line quantity 1 · note 1 | no change past a threshold; typing first measured (P2) |
