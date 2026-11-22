# product-edit — frontend speed audit

Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool](../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: #121 #122. Page `frontend/src/pages/product-edit`, route `/products/{product}/edit`, opened as **seller**.

**Verdict:** 3 screen requests on a warm load (+3 shell); 2-deep waiting chains (ProductDetail → CategoryList); no duplicate; usable in 339 ms; its save fired 9 request(s) after (recorded); typing into the name: 1 commit(s) · 934 components per keystroke · 0 trailing.

**Measured:** 2026-11-21 · `frontend/src` tree `3dee851ef19c` + 209 uncommitted file(s) · production build `f036740605e9837d` (`vite build` + `vite preview`) · seed 60 products · 10 racks (rack A 45 lines) · 30 restocks accepted + 10 open · 30 liability entries · 2 shops · 1 cold + 5 warm load(s) · typing 2 pass(es) a field · quiet machine.

| measure | value |
| --- | --- |
| requests per load (warm) | 6 — shell 3 · screen 3 |
| requests, cold load | 6 |
| same RPC asked twice | 0 |
| CORS pre-checks (OPTIONS) | 0 warm · 6 cold |
| waiting chain (measured) | depth 2 (2 over 2 dependency passes) — ProductDetail → CategoryList |
| time until usable | 339 ms median (338–346, 5 warm) · cold 825 ms |
| counts agree across warm loads | yes |
| requests after one save | 9 — recorded (ProductUpdate (unchanged)) — LiabilityPositionList · ProductList · TeamList · ProductList · OwnerStockStat · OrderActivityStat · TeamList · OwnerStockByIds · OrderProductActivityByIds |
| open CategorySelect | 0 request(s) |
| typing: name (`product-edit-name`, 10 keys) | 1 commit(s) · 934 components per keystroke · 0 trailing |

## Requests

The reference warm load, every Connect call: how many times, its wave in the waiting chain (1 = fired at once), and whether one was a duplicate.

| RPC | count | wave | duplicate |
| --- | --- | --- | --- |
| `AuthService/CheckAccess` | 1 | shell |  |
| `LiabilityService/LiabilityPositionList` | 1 | shell |  |
| `UserService/TeamAccessList` | 1 | shell |  |
| `CategoryService/CategoryList` | 1 | 2 |  |
| `ProductService/ProductDetail` | 1 | 1 |  |
| `TeamService/TeamByIds` | 1 | 1 |  |

After the save (`ProductUpdate`), in the order they fired: LiabilityPositionList · ProductList · TeamList · ProductList · OwnerStockStat · OrderActivityStat · TeamList · OwnerStockByIds · OrderProductActivityByIds. The save navigated to `/products` — that screen's load is counted here.

## Typing

What React draws while a person types (P2): each field typed 2 time(s) on a fresh load, its keys pressed one by one with two animation frames after each, then 500 ms of quiet for the trailing commits. Commits and components are per keystroke (the median); a figure like `1·2` is two passes that disagree. The components are named by the audit's build (`esbuild.keepNames`), their renders summed over the keys and the quiet: where each re-render STARTS (a component that rendered while the one above it did not — its state, or a context it reads, changed), then the app's own components (declared in frontend/src) and every component, Chakra's and emotion's internals included, rendered most.

| field | keys | commits/key | components/key | trailing | re-renders start at | the app's, most | every, most |
| --- | --- | --- | --- | --- | --- | --- | --- |
| name (`product-edit-name`) | 10 | 1 | 934 | 0 | ProductEditPage ×10 (934 a time) | Button ×610, CardTitle ×30, CharCount ×30, Group ×20, CategorySelect ×10 | Insertion ×2390, (anonymous) ×940, Button ×610, chakra(button) ×610, chakra(div) ×600 |

## Findings

A discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.

1. **Each keystroke re-renders the form, not the field** — components per keystroke: the name 934 (1 commit(s)), the widest re-render starting at ProductEditPage ×10 (934 a time) (the Typing table names the rest). *Fix:* hold the form in one useReducer and pass each card only its slice, memoised, so a key re-renders the card it is in (no-global-store-every-read-is-a-query-hook — a many-field form is one useReducer). *Trade-off:* the cards take props they compare, and a callback passed down needs a stable identity.
2. **What the code does** — ProductDetail is a useEffect read (pages/product-edit/index.tsx) — #122; CategorySelect fetches in its own effect — #121.

## History

| Date | requests | dup | chain | usable ms | after save | commits/key | change |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 3 | 0 | 2 | 423 (noisy) | 9 | — | first baseline (P1) |
| 2026-11-21 | 3 | 0 | 2 | 339 | 9 | name 1 | no change past a threshold; typing first measured (P2) |
