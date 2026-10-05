# The 7 Biggest Questions

Every open question in every `_clarify.md`, rolled up to the seven that block the most.

> **Derived file — regenerate, never hand-edit.** Same rule as a `state_report`. The open SET comes
> from `*_clarify.md` only, never from `*_decision.md`, so an answered question leaves here the moment
> it is recorded. Rebuild it whenever any `_clarify.md` changes.
>
> ⚠ **But the RANK is checked against the code, not only against the docs.** A rebuild that reads the
> clarify files alone cannot see that a question has been overtaken by what shipped — which is how
> four of seven rows went stale at once (see below). Before ranking a row, open the file it is about.
>
> **Ranked by what is BLOCKED**, not by how interesting the question is — a question that stops a
> lifecycle pass outranks one that merely matters. Several rows below are **one question asked in two
> docs**, and merging those is most of what this file is for.

**156 open questions across 26 files.** The seven below are shown; **149 are not** — they are not
closed, only smaller. The per-file counts are at the bottom.

▲ **+2 net, still 2026-09-29 — the owner asked how a restock or return can be received PARTIALLY** (some broken,
some lost in transit). Answered in [usulan-penerimaan-sebagian](business/stock_thoni/context_clarify.md#usulan-penerimaan-sebagian):
three counts per line (good · broken · missing) that must sum to what was sent, broken units kept in a
never-taken slot, one parcel per transaction received once, and **every unit at the same price, the loss recorded
as its own figure** — spreading it over the good units would make a borrowing team pay markup on the owner's loss.
🔄 **It revises two of my recommendations elsewhere**: order_return's short parcel goes to `return_completed` with
the shortfall on inventory's receipt, not `problem` (the items that arrived need a path to stock), and inventory Q1's
*divide by received quantity* holds only if losses are absorbed. −1 decided:
[retur-merujuk-order-lewat-ref-order-id](business/stock_thoni/context_decision.md#retur-merujuk-order-lewat-ref-order-id).

▲ **+1 later on 2026-09-29.** The owner defined `TRANSACTIONS.order_id` as the **restock's purchase number**, not our
order — recorded as [order-id-adalah-nomor-pesanan-restock](business/stock_thoni/context_decision.md#order-id-adalah-nomor-pesanan-restock).
⛔ So a `return` transaction now names **no order at all**, while its slot's price is that order's COGS and a return is
always the whole order. **→ Recommend** a separate `return_order_id`, unique for returns.

✅ **2026-09-29 — the ERD changed twice in four minutes, net 0.** `TRANSACTIONS` gained `type (restock | return)` —
recorded as [transaksi-adalah-barang-masuk](business/stock_thoni/context_decision.md#transaksi-adalah-barang-masuk),
🔄 **reversing my recommendation** (restock and return are both parcels by courier, so the columns fit both; a take is
not an arrival) — and [ongoing-dihitung-dari-status](business/stock_thoni/context_decision.md#ongoing-dihitung-dari-status).
A `status` column appeared and was **removed again**; both entries carry a correction note rather than a rename, since
neither verdict reversed. **6 of 10** now. ⛔ **The status living only in the log is now a stock-doubling hazard**: two
people pressing *accept* on one restock write two `arrived` rows and mint the slots twice — the recommendation is a
partial unique index, one terminal status per transaction, which keeps the owner's log-only design.

✅ **Then the ERD was revised the same afternoon — −3 decided, +3 successors, net 0.** Recorded, all as
recommended: [slot-lahir-saat-barang-tiba](business/stock_thoni/context_decision.md#slot-lahir-saat-barang-tiba) ·
[pemilik-adalah-tim-di-sku](business/stock_thoni/context_decision.md#pemilik-adalah-tim-di-sku) ·
[harga-silang-dihitung-dari-persen](business/stock_thoni/context_decision.md#harga-silang-dihitung-dari-persen) ·
[harga-dan-supplier-per-slot](business/stock_thoni/context_decision.md#harga-dan-supplier-per-slot). **5 of 10**
now: everything needed to **compute** an order line exists, and what is missing is what **records and reverses** a
take — one decision, [take-dicatat-di-mana](business/stock_thoni/context_clarify.md#take-dicatat-di-mana). ⚠ **Price now
lives only on the slot, which the warehouse creates on arrival** — and the warehouse does not know what the selling
team paid. ⚠ **A correction of mine**: I had called `technical/stock/design.md` Toni's own; git does not support it,
so slot vs batch-plus-placement is a disagreement **between proposals** and waits on
[member_clarify Q4](business/project/member_clarify.md#question) — reported in
[technical/stock](technical/stock/design_clarify.md#the-business-proposal-decided-one-row-per-pile).

🔄 **+2 more the same day — the owner added an ERD, [stock_thoni/model.md](business/stock_thoni/model.md).** It
parses. ✅ **It reversed my recommendation, on the merits**: `SKU_SLOT` — one row per pile, from one restock, on one
rack — beats the batch-plus-placement split I had copied from `technical/stock`, because the take then picks a slot
and the **rack and the cost travel with the unit**. ⛔ What it leaves out is columns, not concepts: no owner, no
price, and no link from an item to the slot it drew from, so a cancelled take cannot go back where it came from.
**2 of 10** now. +2: is SKU the product · is a take a transaction.

⚠ **+7 this round (2026-09-28), from Toni's stock proposal — rewritten to connect to OrderCreation.**
[stock_thoni/context.md](business/stock_thoni/context.md) dropped §Transaction and the stock rules, and added
two prices on the SKU, restock fields, `stock_ongoing`/`stock_ready`, and an **empty** §Penyediaan data
OrderCreation. Tested against what order already decided, **1 of 9** things OrderCreation needs from the take
is in the doc ([the test](business/stock_thoni/context_clarify.md#uji-ulang-terhadap-ordercreation)).
⛔ **It widens #5**: a stored *"price for others"* on the SKU would be a **third** source for the cross markup,
beside `products.cross_markup_bps` and `liability_terms.product_markup_bp`. ⚠ **And two recorded decisions lost
their text** — one now reads `return` where order decided stock moves at `return_completed`. **None enters the
seven**: what it blocks is the inventory side of the take, whose order-side contract is still waiting on
[which-team-is-team-id](business/order/order_creation_clarify.md#which-team-is-team-id). ⚠ **Arithmetic
correction:** this file claimed the stock_thoni row was added two rounds ago; it was **not in the table**, which
summed to 144 without it. The row exists now.

⚠ **+7 this round, from a BRAND-NEW technical package** (2026-09-21) —
[`technical/packages/excel_readers/context.md`](technical/packages/excel_readers/context.md), the settlement
file parser, and its [clarify](technical/packages/excel_readers/context_clarify.md) is the first pass over it.
**None of the seven enters the list above**, because none blocks a whole context — the package has no consumer
waiting on it yet. ⛔ **But one of them is a second asking of a question already open in settlement**: its Q3
routes to [settlement's `unique_id`](business/settlement/context_clarify.md#question), and the 25 sample
workbooks now **disprove the `hash(date + order_ref_id)` best effort** that
[settlement/context.md](business/settlement/context.md) proposes — Shopee emits byte-identical duplicate rows
(`shopee_malaysia_base.xlsx` r69/r70), and TikTok settles one order twice across overlapping exports
(`overlapping_earning.xlsx`). That makes **#3's shape sharper, not its rank**.

⚠ **The header was right and the table was stale.** Recounted mechanically again this round: the pre-existing
files sum to **137** across **23** files, which is exactly what the header already said — while the table below
summed to 133 and listed a 24th file, `business/product/systems_clarify.md`, **that does not exist**. That row
is deleted here. Two live counts also drifted: `technical/architecture` is **11**, not 10, and the warehouse
row's link pointed at `business/warehouse/`, which is not where the file is
(`business/teams/warehouse/`). No question opened or closed to produce any of that — it is arithmetic and link
drift, and it is the third consecutive round in which this table, not the header, was the wrong part.

⚠ **+11 this round, from a BRAND-NEW context** (2026-09-16) — `business/warehouse/context.md`, four lines long,
and its [clarify](business/warehouse/context_clarify.md) is the first pass over it. ⛔ **Three of the four things it
asks for already exist somewhere else in the build**, which is why it opens so many at once: the location and the
open/close grid are `team_service.warehouse_infos` (shipped, and the grid is **read by nobody**), and the order fee
is `liability_service.liability_terms.handling_fee` — **flat**, per pair, and charging money today, against the
doc's `fee_percent` + `max_fee`. **See #7.**

⚠ **The header count was 116 and the table summed to 113 — neither was right.** Recounted mechanically this
round (every `###` under a `## Question`, every numbered item under a `# Question`), the pre-existing files sum to
**119**; warehouse's 11 makes **130**. No question closed or opened to produce that correction — it is drift in the
arithmetic, not in the open set.

⚠ **+2 this round, from the ORDER context** (2026-09-15) — its clarify was rewritten after a session of edits
to `order/context.md`. **Six decisions recorded** (money follows settlement · unique by shop + marketplace ref ·
drafts keep their own table · eight statuses · lost is final · plus the missing index row for
ensuring-an-order-is-whole). **−2 closed** (the cancel gate · which boxes are statuses) and **+4 opened**
(lost/return and `initial_total` · what `return` means · the journey setting stale statuses · who may cancel a
pending order, the remainder of the statuses question). The old uniqueness question is **reshaped, not new**: the
rule is decided, and what is left is that its flow cannot deny and spans two tables. ⛔ **And #1 got worse on
inspection** — five sites, not three, and the reconciliation report the code relies on is unbuilt. Order
questions are **named now, not numbered**; `order Q14` is
[a-lost-publish-is-not-tracked-on-the-order](business/order/context_decision.md#a-lost-publish-is-not-tracked-on-the-order).

⚠ **+3 this round, all from BUILDING settlement** (`dabc331`) — none of them blocks anything, because each
was built the recommended way and is asked only for a yes: settlement **Q4** (an order with
`marketplace_total = 0` opens no account), **Q5** (a cancel undoes the LIVE sale), and analytic **Q6**
(topic retention instead of `retain_acked_messages` for the replay's seek). ✅ **And three rows below lost
their blocker without closing**: #6's *"settlement's event cannot be written today"* — it is now written
and published · #1's *"`SettlementPost` (no account opens)"* leg — the call exists, after commit, never
fatal · #2 and #3 — the fold whose drift they describe now exists, so they are live risks rather than
design ones.

⚠ **−3 this round** — event_architecture **Q6, Q14 and Q15 are all closed**, every part of each decided, so **that file now has none open**. Net −2 across the session: Q15 opened when the encoding was decided and closed when its last part was applied. Recounted mechanically: 6e
was a PART of Q6, so deciding it narrows a question rather than removing one. Recounted mechanically (every
numbered item under a `# Question` or `## Question` heading, fenced code skipped): 109 items, less architecture
Q2, which is a pointer to order's a-lost-publish-is-not-tracked-on-the-order (was Q14, now decided) rather than an open question. The per-file table sums to the header.

> ## What changed this round
>
> 🆕 **The owner added `## Order Return Flow.` and `product_return_maps` to `order_return.md` (2026-09-21), and
> the clarify was re-examined against it. +6, and it enters at #6.** ✅ The diagram **parses** (470 diagrams
> clean), so there is nothing to report under RULE 3. ⛔ **Checked against the build first**, and the
> configuration the doc asks for is already a shipped column in a different service —
> `team_infos.return_warehouse_id`, beside `default_warehouse_id`, **written by no screen and read by no
> server**. That is the **third** stored-but-unread field found this way (`warehouse_infos`' open/close grids,
> `products.reserved_stock`), and it is becoming the signature defect of this system: a field is added, an
> editor is promised, and nothing ever reads it. ⛔ **The flow's own-product branch clones the team's own
> catalogue** on every return, contradicting `context.md`'s return diagram two files away — the same way
> §Complete Journey went stale against the status diagram. **+6**
> ([order_return](business/order/order_return_clarify.md#question)), **#6**.
>
> 🆕 **A new context appeared — `business/warehouse/context.md` — and its first clarify opens 11.** The doc asks
> for a `warehouse_service` owning location, open/close days and a `fee_percent` + `max_fee`, plus a
> `WarehouseFeeCalculate` RPC for other services. ⛔ **Checked against the code before ranking** (the rule this file
> learned the hard way): `warehouse_infos` already holds the location and BOTH weekly grids in `team_service`, with
> a shipped editor — and **no RPC anywhere reads the grids**, so an order can be placed into a warehouse that is
> shut. The fee is worse than duplicated: `liability_terms.handling_fee` is a **flat** per-order amount, per
> **pair**, and it is charging money now — a percent with a cap is a different contract for every existing pair.
> ⚠ **And it overtakes an in-flight change**: [technical/balance Q8](technical/balance/team_balance_design_clarify.md#question)
> asks whether to rename that column `order_fee`, which should not happen to a column that is about to move
> services. **→ Recommend the rate MOVES** to `warehouse_service`, the order **freezes** the amount
> (`orders.warehouse_fee`, a column the order context promises and the build does not have), and liability posts
> what it is handed instead of computing. **+11** ([warehouse](business/warehouse/context_clarify.md#question)), **#7**.
>
> 🔄 **And the owner added the `WarehouseFeeCalculate` PAYLOAD the same day. +3 more.** ✅ It ratifies two things
> the clarify had asked for — the RPC takes a **basis** (`order_total`) rather than an `order_id`, so
> `warehouse_service` never depends on `order_service`, and it **echoes the rate it used**, which is what makes a
> charge explainable later. ⛔ **Three new:** every money field is a **`double`**, and a grep across every proto in
> the repo returns **no float at all** — money is `int64` whole rupiah, written down as a rule in `expense.proto`
> ([Contradiction](business/warehouse/context_clarify.md#money-is-a-double-here-and-an-integer-everywhere-else)) ·
> the request names **no selling team**, which both drops the per-pair rate liability already charges and leaves
> the message with **no `use_scope` field**, so the access interceptor has no team to scope the call to · and it
> prices **one** warehouse per call, while the response echoes `warehouse_id` as though it were already a batch.
> ⚠ `order_total` also does not say **which** total — `orders.total` includes shipping, and `subtotal`, `cogs`
> and `marketplace_total` are three other candidates, the last being `0` on a phone order. **+3**
> ([the payload as I would write it](business/warehouse/context_clarify.md#the-payload-as-i-would-write-it)).
>
> ✅ **And the owner then settled the warehouse context's biggest question, hours after it was asked** —
> `§Responsbility 2`: *"warehouse service just give rpc for calculate. how the fee handle and recorded is
> responsbility of balance and called by order"*, recorded as
> [warehouse-prices-balance-records](business/warehouse/context_decision.md#warehouse-prices-balance-records).
> The rate lives where the calculation lives, **balance is told the amount** instead of deriving it, and the fee
> is fixed when the order calls. ✅ **Half of that principle was already shipped and is now the argument for the
> other half**: `ReverseOrder` refuses to recompute a fee it once posted, *"a rate changed between placement and
> cancellation would make it disagree by design"*. **−2 closed, +2 successors, net 0** — what survives is
> whether `liability_terms.handling_fee` is **dropped** (leaving it is the two-rates bug chosen by accident) and
> how the amount **reaches** balance. **#7 reshaped**: it is no longer *who owns the fee* but *can the contract be
> written* — the money type, the basis, the scope field, and the disposal of a rate that is charging money now.
>
> ✅ **product — a product cannot be deleted while it still has stock** — *"no"*, recorded as
> [deleting-a-product-requires-zero-stock](business/product/context_decision.md#deleting-a-product-requires-zero-stock), as recommended. `ProductDelete`
> checks nothing today, so this is a new guard. ✅ **It RESOLVES the contradiction** between *a deleted product cannot
> be searched anywhere* and `ProductByIds` returning soft-deleted rows *because stock outlives a catalogue entry* —
> with no shelf holding one, the two stop competing. ✅ **And it retires my own argument for burning a code**: a
> re-typed code can no longer make an old sticker scan as a new product, because no such sticker survives. Reuse is
> safe, and only the mechanism is left — the partial index, not the `[code]_deleted_ts` rename, which mutates a
> printed string and self-collides when one code is created and deleted twice in a tick.
>
> ⚠ **Two things the guard costs, recorded with it.** It makes delete **blockable** — a product with units nobody can
> find can never be archived until they are written off, so that path has to exist and be reachable — and the refusal
> must **name** the warehouses and quantities holding the stock, or an operator is told no with nowhere to go.
> **−1 closed, +2 successors**: does *zero stock* mean zero on hand or no references at all, and does *unfindable
> anywhere* reach a known-id lookup for HISTORY, where a closed order line still names an archived product
> ([product Q11, Q12](business/product/context_clarify.md#question)). **+1.**
>
> ✅ **product — a deleted product is unfindable** — *"deleted product is cannot search anywhere"*, recorded as
> [a-deleted-product-is-unfindable](business/product/context_decision.md#a-deleted-product-is-unfindable). ⛔ **And it surfaced the question the
> whole code discussion turned out to be a proxy for: `ProductDelete` checks NOTHING about stock**, so a product with
> four hundred labelled units on a rack can be soft-deleted in one call — and the only thing that then names those
> units is `ProductByIds`, the lookup this decision removes (*"stock outlives a catalogue entry"*, its own comment).
> **→ Recommend requiring ZERO stock to delete**, which collapses three questions at once: nothing can be mis-scanned,
> the code can be freed safely, and *unfindable anywhere* becomes true instead of nearly-true.
> [Contradiction](business/product/context_clarify.md#a-deleted-product-is-unfindable-and-a-shelf-of-its-units-still-needs-its-name) ·
> [product Q11](business/product/context_clarify.md#question), reshaped rather than added. **No count change.**
>
> ⚠ **The pattern behind it, recorded per HARD RULE 11**: these rules are written about a *catalogue* and land on a
> *warehouse*. `deleted`, `is_private` and the code namespace each have a second audience — the person holding the
> physical unit — and none of the three says what it means on a shelf.
>
> ✅ **product — the code is composed from the team's code** — *"composed"*, recorded as
> [the-code-is-composed-from-the-team-code](business/product/context_decision.md#the-code-is-composed-from-the-team-code). `<team_code>-<the team's own
> part>`, so global uniqueness stops being a namespace two teams compete for: no create is refused because of another
> team's row, and no refusal leaks that one exists. ⚠ **It needs `teams.team_code` and the ownership rule needs
> `teams.type` — the same cross-service read, so build ONE** ([product Q8](business/product/context_clarify.md#question)). ⚠ And the
> prefix must be **frozen at write**, not recomputed: teams can be renamed, and a recomputed prefix would rewrite every
> label a team ever printed. **−1.**
>
> 🔄 **And I reversed my own delete recommendation, on evidence rather than argument.** I had recommended a partial
> unique index so a deleted code could be reused. ⛔ **Reuse is exactly what makes a printed sticker lie**:
> `RestockRequestLabels` prints the code *"so a picker can find and scan what it just shelved"*, so a re-typed code
> makes every old unit still on a shelf scan as a **different product**. **→ Recommend BURNING the code** — one unique
> index, no `WHERE`, no rename — which composition makes nearly free, since the namespace is the team's own. The
> owner's `[code]_deleted_ts` has the same reuse defect *plus* mutation, and collides with itself when two deletes of
> one code land in the same tick, failing the DELETE. Still open as
> [product Q11](business/product/context_clarify.md#question). **No count change.**
>
> 🆕 **product gained `### Whats is `product_code`` — and `globally unique` is the most consequential line added to that
> doc so far.** It collides with the doc's own rule that a product is one selling team's catalogue entry: two teams
> selling the same supplier's item are two rows, so the second **cannot use the supplier's code**, and its refusal
> tells it somebody else holds that code — a probe of another team's catalogue that `is_private` does not stop.
> **→ Recommend keeping global and composing the string** as `<team_code>-<code>`: the warehouse argument for global is
> strong (a scan at a rack resolves without asking *whose*), and composition makes uniqueness a property rather than a
> constraint two teams compete for. ⚠ **The `[code]_deleted_ts` rename should not ship**: the live partial index
> `WHERE deleted = FALSE` already frees the code, and the rename breaks a lookup the code depends on — `ProductByIds`
> returns soft-deleted products *because stock outlives a catalogue entry*. Two deletes of one code in the same tick
> also produce the same mangled string, so the **delete** is what fails. **+3**
> ([product Q10, Q11, Q12](business/product/context_clarify.md#question)).
>
> 🔄 **And it reversed my own naming recommendation, for a reason worth keeping**: I argued to keep the shipped `sku`.
> A globally unique code is not a *stock-keeping unit* — that is a seller's own code by definition — so `sku` would now
> name the opposite of the rule. **Rename to `product_code`.** ✅ The attribute list also gained `reserved_stock`,
> `is_private` and `is_deleted`, leaving only the **owning team** missing from it. ⚠ `is_private` looks like a third
> name for the shared lock, shipped as `cross_locked`. **No count change.**
>
> ✅ **product — a product files under MANY categories** — *"categories is plural"*, recorded as
> [a-product-files-under-many-categories](business/product/context_decision.md#a-product-files-under-many-categories). `products.category_id` becomes a
> `product_categories` link table and four proto sites go `repeated`. 🔄 **It reverses my recommendation, and my
> reasoning was wrong in a way worth recording**: I argued one → many is additive later — true of the schema, false of
> the contract, because `buf breaking` makes the proto change equally breaking whenever it happens. ✅ **Cheaper than
> it looks**: nothing filters by category today, so there is no `WHERE` to rewrite — the id is carried on the row and
> read by nobody. ⚠ **Two things not to get wrong**: the list read is one `IN` per page and not a lookup per row, and
> `CategorySelect` is NOT made multi — three of its four callers pick a *parent node*, so the multi control is a chips
> wrapper that composes it. **−1, +1 successor** ([product Q9](business/product/context_clarify.md#question) — which one is primary,
> and how many). **Net 0.**
>
> ✅ **product — a warehouse team may not own a catalogue** — *"warehouse cannot have own product"*, recorded as
> [only-a-selling-team-owns-a-catalogue](business/product/context_decision.md#only-a-selling-team-owns-a-catalogue), and it is the FIRST entry in a
> `product/context_decision.md` that did not exist — that folder's decisions had been living inside the prunable open
> set. ✅ It makes §Pricing Behavior total: every product now has an owner that can also be a buyer, so the
> own-line/cross-line split has no third case. ⛔ **But the ACL does not enforce it.** Narrowing the four write
> policies (`ProductCreate|Update|Delete|Restore` lose `ROLE_WAREHOUSE_OWNER`/`ADMIN`) leaves `ROLE_TEAM_OWNER`
> grantable *inside* a warehouse team — no grant path checks `teams.type` — so the handler must read the team's TYPE,
> which product_service has no path to and HARD RULE 3 makes an RPC. **+1** ([product Q9](business/product/context_clarify.md#question)).
>
> 🆕 **product gained `## General.`, `## Responsbility.` and an `## Attribute` field list, and the list disagrees
> with the shipped row in three places.** `categories` is plural against a single `products.category_id`
> ([product Q7](business/product/context_clarify.md#question)) · `product_code` and `cross_markup_percent` are shipped as `sku` and
> `cross_markup_bps` ([product Q8](business/product/context_clarify.md#question)) · and the list omits the owning team,
> `reserved_stock` and `cross_locked`, the last two mandated by §Cross/Shared Products Rule in the same file.
> ⚠ **The naming one is time-sensitive now that `buf breaking` runs in CI** — a rename is free this week and a wire
> break after. **+2.**
>
> ⚠ **Verified against the code while ranking, and it narrows an existing row:** the shared LOCK is enforced in exactly
> one place — `cross_locked = false` in [product_discover.go:32](../backend/services/product_service/product_v1/product_discover.go#L32) — so it hides a
> product from BROWSE while `ProductByIds` filters on ids alone. A team that already holds the id can still build an
> order around a locked product. And `reserved_stock` is stored and editable with **no reader anywhere** — the reserve
> is a rule the system does not apply. Neither is a new question: both are the unanswered halves of
> [product Q3 and Q4](business/product/context_clarify.md#question). **No count change.**
>
> ✅ **The event guideline is rewritten** — `guidelines/architectures/event_library.md`, on the owner's word.
> Its nineteen stale sites are gone and the contradiction is **resolved**: the doc now describes one envelope,
> a topic per variant, `protojson`, the required `oneof`, the mandatory `event_type` filter and the identity
> rule. Every superseded rule is KEPT with its anchor and a record of what replaced it (HARD RULE 11), so the
> thirteen links into it from other docs all still land. **Also implemented this round:** the whole event
> architecture in code, and `san pubsub ensure` for provisioning. **No count change** — a contradiction is not
> a question.
>
> ✅ **event_architecture — handlers take one event, not a batch** — *"we dont take batch"*, recorded as
> [handlers-take-one-event-not-a-batch](technical/event_architecture/context_decision.md#handlers-take-one-event-not-a-batch). It closes the last gap between the
> shipped receive path and the contract already decided: the slice goes, the generic goes with it (with one envelope
> `T` was always `Event`), and the `tx` goes too, since rule 4 says the handler opens its own. ✅ Better, not just
> smaller — a failing batch redelivers every message in it, and a push delivers one per request anyway. ⚠ Accepts N
> transactions where a batch had one, which the doorbell-not-delivery rule already answers. **No count change.**
>
> ✅ **event_architecture Q15 is CLOSED and the change is APPLIED** — recorded as [ci-runs-on-dev-and-checks-breaking](technical/event_architecture/context_decision.md#ci-runs-on-dev-and-checks-breaking) and
> written into [ci.yml](../.github/workflows/ci.yml): CI now runs on every push to `dev` (the expensive `test` job
> held to `main` and PRs by an `if:`, since it pulls Postgres, Redis and a Playwright browser), and `buf breaking`
> is in the fast job against `HEAD~1` with `fetch-depth: 2`. The baseline was chosen by running both:
> `--against main` is **already red** from the RPC guideline migration, `HEAD~1` was clean.
> 🆕 **event_architecture now has NO open questions.** ⛔ What still blocks the first event there is a
> **contradiction**, not a question — see **#6**. **−1.**
>
> 🆕 **event_architecture 15c elaborated into the actual change**
> ([here](technical/event_architecture/context_clarify.md#15c--buf-breaking-in-ci-and-why)), and running it revised
> my own recommendation twice. ⛔ **`buf breaking --against main` is ALREADY RED on this repo** — the RPC guideline
> migration (`TeamListRequest.q` → `filter`), on `dev` and not on `main` — so a `main` baseline is red for the whole
> gap between a change landing and a promotion, which on this workflow is the normal state.
> `--against '.git#ref=HEAD~1,subdir=proto'` is **clean today** and trips exactly on the commit that renames
> something. ⚠ It must run from the repo ROOT and the checkout needs `fetch-depth: 2`. And the `dev` trigger wants
> an `if:` on the `test` job, which pulls Postgres, Redis and a Playwright browser per commit. ✅ Verified it starts
> green. **No count change.**
>
> ✅ **event_architecture Q14 is CLOSED, all four parts** — recorded as [identity-is-a-record-never-a-credential](technical/event_architecture/context_decision.md#identity-is-a-record-never-a-credential), as
> recommended: `identity = 5` (⚠ and under `protojson` the permanent choice is the NAME, not the digit) · a caller
> with none passes a shared `SystemIdentity(agent)` · the sender clears `expired_at` · and no consumer authorises
> from it, now a **fifth rule** on
> [one-contract-for-both-handler-types](technical/event_architecture/context_decision.md#one-contract-for-both-handler-types). ⚠ What it accepts, recorded:
> `SystemIdentity()` is the easy thing to reach for, and a call site inside a real request that reaches for it
> anyway loses the user with nothing detecting it — hence the required `agent` argument. ⚠ **The adopter checklist
> has grown by three this session** and wants one restating pass. **−1 — one question left in this file, Q15.**
>
> ✅ **event_architecture — breaking the old protos is accepted** — *"its okay breaking old, we follow this new
> design"*, recorded as [breaking-the-old-protos-is-accepted](technical/event_architecture/context_decision.md#breaking-the-old-protos-is-accepted). It answers
> my *"not yet"* objection to 15c: the one `buf breaking` failure is expected, so what is left is a commit ORDER —
> land the `event_base.v1` removal first, then add the CI step. ⛔ **It withdraws my dual-publishing
> recommendation.** ⚠ What it accepts, recorded: messages in flight at the cutover have no consumer, so an order
> placed in that window is never charged — the same silent post-commit gap **#1** names, arriving once and
> deliberately. **→ Recommend a consumer-first cutover** (liability reads both old and new for one deploy), which
> removes the window and costs less than the bridge. Q15 is now only the two CI lines. **No count change.**
>
> ✅ **event_architecture 15b decided** — *"for 15b, yes, we have new"*, recorded as
> [the-library-has-one-decoder](technical/event_architecture/context_decision.md#the-library-has-one-decoder): one decoder in the new `san_event`,
> `DiscardUnknown` then validate, and `event_source`'s `DecodeEvent` goes. The two-decoder contradiction is settled
> by decision — what remains is the code change. 🆕 **And *"why breaking?"* is answered**: `buf breaking` is the only
> check that compares the proto to its PREVIOUS SELF — lint, the generate-drift check and the tests all pass on a
> rename, and `go build` fails only until you update the Go, which goes green while the wire stays broken.
> 🔄 **I revised my own timing recommendation to NOT YET** — verified, it fails today on
> [event-base-v1-is-removed](technical/event_architecture/context_decision.md#event-base-v1-is-removed), and a check that is routinely overridden teaches people
> to override it. Q15 narrows to 15c. **No count change.**
>
> ✅ **event_architecture 15a decided** — *"yes one of is required"*, recorded as [the-event-oneof-is-required](technical/event_architecture/context_decision.md#the-event-oneof-is-required),
> as recommended: an `Event` with no variant set fails validation, so a renamed arm — or one a consumer has not
> regenerated — is recorded and ACKed instead of arriving as a valid envelope with no body. It fires at both ends,
> and it is what makes keeping `DiscardUnknown` safe (15b). ⚠ **Re-examined (RULE 11): no contradiction**, but one
> thing becomes load-bearing and irreversible — the `event_type` subscription filter is what removes 15a's only
> cost, and a filter is **immutable**, so the setup tool refuses to change one. It has to be right at creation.
> **→ Recommend it becomes a required step of the adopter checklist.** Q15 narrows to 15b · 15c. **No count
> change** — 15a was a part, not a question.
>
> 🆕 **event_architecture Q15 elaborated** into three parts
> ([here](technical/event_architecture/context_clarify.md#q15-part-by-part)), each verified by running it. They are
> not independent — **15a is what makes 15b's leniency safe**: `DiscardUnknown` alone turns a renamed or unknown
> `oneof` arm into a valid `Event` with no body, silently ACKed. ⚠ Two findings beyond the question: 15a's cost —
> rejection noise on consumers that have not regenerated — **is removed by the `event_type` subscription filter**,
> which promotes that filter from a nicety to a requirement · and ⛔ **CI never runs on `dev`**: the triggers are
> `push: [main]` and `pull_request`, and work goes straight to `dev` with no PR, so every check fires only at the
> merge to `main`. Adding `dev` to the triggers is worth more than `buf breaking` alone — `go vet` would then catch
> the by-value `identity` on the commit that introduces it. **No count change.**
>
> 🔄 **event_architecture — `context.md` line 20 changed, and it REVERSES a decision from earlier today.** The
> identity is now an explicit **parameter** of `EventSender`, recorded as
> [identity-is-a-sender-parameter](technical/event_architecture/context_decision.md#identity-is-a-sender-parameter);
> [superseded-the-sender-reads-identity-from-ctx](technical/event_architecture/context_decision.md#superseded-the-sender-reads-identity-from-ctx) is renamed and
> annotated, and every reference to it repointed (RULE 12).
> ✅ **It is the better shape** — a `ctx` value is invisible in a signature and a parameter cannot be omitted, so the
> compiler now enforces what the library was going to do by convention, and the causation chain is visible at the
> call site. ⛔ **But it does not compile as written**: `identity role_basev1.Identity` passes a proto message by
> value, and `go vet` — which CI runs — refuses it (verified against the real signature: *"copies lock value …
> MessageState contains sync.Mutex"*). The line-98/129 by-value contradiction is renamed to its CAUSE and widened to
> three sites. ⚠ Q14 · 14b moves from the library to the adopter checklist. **No count change.**
>
> 🆕 **event_architecture Q14 elaborated** into four parts
> ([here](technical/event_architecture/context_clarify.md#q14-part-by-part)), each checked against the code. The new
> finding is **14b — the identity chain breaks at the FIRST consumer**: user 57 places an order, liability consumes
> the event and publishes a ledger event whose `ctx` has no identity, so the ledger row says SYSTEM caused it — and
> the real answer was on the incoming event. One line in the adopter checklist keeps causation across every hop.
> **14a** shrank: under `protojson` the field NUMBER is not on the wire, so the permanent choice is the word
> `identity`, not the digit 5. **No count change.**
>
> ✅ ⛔ **event_architecture Q6 is CLOSED** — *"i choose one map"* settles its last part as [event-metadata-is-copied-into-the-attributes](technical/event_architecture/context_decision.md#event-metadata-is-copied-into-the-attributes),
> against my recommendation of two maps with no overlap: `Event.metadata` and the message attributes hold the same
> keys after a send. ⚠ **The cost is not the size cap** — it is that the caller and the library now share one key
> namespace, so a producer writing `metadata["event_type"]` breaks the subscription filter or is silently
> overwritten. Also recorded: a legal body value can lose the event to the attributes' 1024-byte cap (a key must
> also not start with `goog`), and `event_id` now exists three times. **→ One free guard:** `buf.validate` map
> rules mirroring Pub/Sub's own caps — they can never reject what the broker accepted. **−1.**
>
> 🆕 **event_architecture Q6 · 6f elaborated again** — *"whats mean one or two bag"*: the choice is now written as
> literal output rather than a metaphor
> ([here](technical/event_architecture/context_clarify.md#6f--which-values-ride-on-ctx)). ONE map
> written to both `Event.metadata` and `Message.Attributes`, or TWO with different authors and no overlap. The
> deciding cost: an attribute value caps at **1024 bytes** and the body's map caps at nothing, so under ONE map a
> caller writing a long annotation loses the event to a broker error that does not name the key. What TWO gives
> up: a caller cannot filter on its own key. **No count change.**
>
> ✅ **event_architecture — identity is from `ctx`** — *"identity is from ctx"*, recorded as [superseded-the-sender-reads-identity-from-ctx](technical/event_architecture/context_decision.md#superseded-the-sender-reads-identity-from-ctx) — ⛔ **since reversed the same day**, see below —
> as recommended. The sender fills `Event.identity` by reading it, never a call site: `san_auth.GetIdentity(ctx)`
> already returns the exact type, and twelve handlers call it today. **Q6 · 6f elaborated** and now has one half
> left — whether `Event.metadata` and the message attributes are one bag or two. ⚠ **Found while grounding it:**
> `GetIdentity` ERRORS when nothing set it, and the access interceptor is the ONLY setter in the repo — so a pull
> worker, a push handler, `tools/san` and every backfill publish with no identity, which is the first real flow,
> not an edge. **Q14** narrows to the number, that case, `expired_at` and the trust rule. **No count change.**
>
> ⛔ **event_architecture 6e decided** — the owner added §How Event Encode and Decode: `protojson`, recorded as
> [events-are-encoded-with-protojson](technical/event_architecture/context_decision.md#events-are-encoded-with-protojson), against my recommendation of binary. The encode fork is recorded
> beside it as [meta-rides-in-the-body-and-the-attributes](technical/event_architecture/context_decision.md#meta-rides-in-the-body-and-the-attributes) — the meta attributes are written TWICE, into the body and
> into the message attributes, and the decode reads the body only.
> ⚠ **What it accepts, recorded:** under `protojson` the wire identity is the field NAME, so renaming a `oneof`
> arm — and the global `Event` is all `oneof` — drops the ENTIRE body to an unset oneof, and `DiscardUnknown`
> makes that a valid `Event` that is silently ACKed. `buf breaking` is configured in `proto/buf.yaml` and CI
> never runs it. **→ New Q15** proposes the three cheap guards. ⚠ **Re-examined (RULE 11):** the guideline's
> *"Protobuf, binary encoding"* is a nineteenth stale site, and the repo's two protojson decoders — `codec.go`
> lenient, `push.go` strict — are now a contradiction rather than a note. **+1.**
>
> ✅ **event_architecture Q4 decided** — *"for now we dont use bigquery or dump event to cloud storage"*
> ([no-archive-events-live-31-days](technical/event_architecture/context_decision.md#no-archive-events-live-31-days)): no archive, an event lives 31 days.
> ⚠ **Re-examined (RULE 11):** settlement's `order_created_by_user_id` rides on the event and sits on no table, so
> after 31 days it is unrecoverable — the unbuilt `the-creator-is-stamped-on-the-state-row` migration is now its
> only protection, and settlement's clarify says so. **−1.**
>
> ✅ **event_architecture Q3 decided, as recommended** — *"for q3 we use pubsub emulator"*
> ([dev-runs-the-emulator](technical/event_architecture/context_decision.md#dev-runs-the-emulator)): the emulator in dev, Pub/Sub in production, no sqlite broker, and the dev
> binary's in-process **loopback retired**. ⚠ What it costs a developer: the `pubsub` profile must be up, the setup
> tool re-run after every emulator restart (it keeps nothing, and nothing checks at boot), and a dev PUSH endpoint
> is `host.docker.internal:8080` — pull needs no route. An eighteenth guideline site goes stale. **−1.**
>
> ⛔ **event_architecture 6d decided** — *"stop publisher and close the client"* are the service's, recorded as
> [publisher-and-client-shutdown-is-the-services](technical/event_architecture/context_decision.md#publisher-and-client-shutdown-is-the-services),
> against my recommendation: `NewEventSender` returns no cleanup. It accepts one loss, stated: a send still retrying
> when a deploy exits is gone with no log line — the dev binary drains for 10 s, the client retries for 60. Q6
> narrows to 6e · 6f. No count change.
>
> 🆕 **The owner's `NewEventSender` now takes the client** (line 25, pseudocode type) — as 6d's sketch has it — but
> still returns only `EventSender`, so 6d's cleanup has nowhere to go. Every line reference below it shifted by
> one and is updated. No count change.
>
> 🆕 **event_architecture 6d elaborated** ([here](technical/event_architecture/context_clarify.md#6d--one-publisher-per-topic-and-a-cleanup)).
> ⚠ **A correction of my own**: the shipped sender's per-event publishers are NOT a goroutine leak in the v2.6.1
> client — each is garbage once its batch is sent. What is real: no batching, an ordering key made impossible,
> and a deploy during a Pub/Sub slowdown killing batched events with no log line. 6d's cleanup is what waits for
> them, and it changes `InitializeApp` to return one. No count change.
>
> ⛔ **event_architecture 6b decided** — *"return error as is"*, recorded as
> [sender-returns-the-client-error-as-is](technical/event_architecture/context_decision.md#sender-returns-the-client-error-as-is),
> against my recommendation: no wrapping, no sentinels. The caller's log line carries the `event_id`. Q6 narrows
> to 6d · 6e · 6f. No count change.
>
> 🆕 **event_architecture 6b elaborated** (since decided — [the decision](technical/event_architecture/context_decision.md#sender-returns-the-client-error-as-is)) —
> seven errors the sender can return, in three classes (bug · setup · outage), and three caller rules the live
> producer already follows — above all, a send error after the commit never fails the RPC, or the person at the
> shelf taps again and a second order exists. No count change.
>
> ✅ **event_architecture 6c decided** — *"ctx its used for bring custom and optional value if needed"*, recorded as
> [sender-ctx-carries-values-not-cancel](technical/event_architecture/context_decision.md#sender-ctx-carries-values-not-cancel):
> the sender keeps the `ctx`'s values and drops its cancel, which fixes the false *"not stored"* on a client
> disconnect. It opens 6f — Go's `context` package keeps optional parameters OFF `ctx`, so a per-event option
> belongs in `Event.metadata`. Q6 is now 6b · 6d · 6e · 6f. No count change.
>
> 🆕 **event_architecture Q6 elaborated part by part** ([here](technical/event_architecture/context_clarify.md#q6-part-by-part)).
> ⚠ One of my claims corrected: under the shipped codec (`DiscardUnknown`) a renamed field silently reads as
> ZERO rather than failing — in a money event, the worse outcome. Findings in code: two `protojson` decoders
> that disagree (push.go strict, codec.go lenient), and `buf breaking` configured but never run in CI. No count
> change.
>
> 🆕 **The owner's sender takes `*eventsv1.Event`** — recorded as
> [the-sender-takes-a-pointer](technical/event_architecture/context_decision.md#the-sender-takes-a-pointer), part 6a of
> event_architecture Q6. ⚠ The two handler types still take `Event` by value — a new contradiction in the
> owner's doc. Q6 narrows to 6b–6e. No count change.
>
> 🆕 **event_architecture Q6 elaborated, not answered** — [the sender, spelled out](technical/event_architecture/context_clarify.md#proposed--the-sender-for-q6).
> ⛔ One live finding in shipped code: the Pub/Sub client sends on its own background `ctx`, while
> [sender.go](../backend/pkgs/event_source/sender.go#L70) waits on the caller's — so a client disconnect
> returns an error, and a log line saying *not published*, for an event that IS sent. Q6 is now five parts:
> pointer · what an error means · detached wait · one publisher per topic plus a cleanup · binary encoding.
> No count change.
>
> ✅ **event_architecture Q5 decided, as recommended** — *"its clear for this question"*, confirmed as all of it
> ([setup-ensures-safe-defaults-never-deletes](technical/event_architecture/context_decision.md#setup-ensures-safe-defaults-never-deletes)). The two setup functions ENSURE: six defaults
> built in, update what may change, refuse and never delete what cannot — plus `Redrive` for the DLQ. No guideline
> rule is overridden: it already asks for a DLQ and 5 attempts. **−1.**
>
> 🆕 **The two setup functions are a developer's tool** — *"for developer to setup & ensure topic and subscriber
> exists and configure properly"*, recorded as
> [setup-functions-are-a-developer-tool](technical/event_architecture/context_decision.md#setup-functions-are-a-developer-tool).
> ✅ No running service holds Pub/Sub admin. ⚠ One gap: a push route whose subscription nobody has created
> receives nothing and reports nothing. ⛔ The owner declined a boot-time check for it —
> [services-do-not-verify-setup-at-boot](technical/event_architecture/context_decision.md#services-do-not-verify-setup-at-boot) — so running the tool
> is part of shipping a subscription. No count change.
>
> 🆕 **event_architecture Q5 walked through six situations** (now in [the decision](technical/event_architecture/context_decision.md#setup-ensures-safe-defaults-never-deletes)) —
> it found two more silent defaults: with no retry policy Pub/Sub redelivers *"as soon as possible"*, so a
> 30-second database blip dead-letters good events · and a push subscription's 10 s ack deadline is also
> its HTTP timeout, so a slow fold rolls back five times and lands in the DLQ. And nothing brings a
> dead-lettered event back — `Redrive` proposed as a third function. No count change.
>
> 🆕 **The owner gave `EventSender` a `ctx`** — `func(ctx context.Context, event Event) error`, recorded as
> [the-sender-takes-ctx](technical/event_architecture/context_decision.md#the-sender-takes-ctx). Half of
> event_architecture Q6, as recommended — and the `ctx` Q14 fills `identity` from. Q6 narrows to the pointer,
> the meaning of `nil`, the detach and the cleanup. No count change.
>
> 🆕 **The owner added `identity` to `Event`** — `role_base.v1.Identity identity`, *"its from rolebase"*. ✅ Reusing
> the token's `Identity` is right: it is what `san_auth.GetIdentity(ctx)` already returns. ⛔ Three things it
> leaves unsaid, each silent — who fills it (a worker or push handler has no identity in `ctx`), whether a
> consumer may trust it (**every push route is open**, so it is forgeable), and the token's `expired_at`, which
> makes a replayed event look expired. → **new event_architecture Q14**, which leans on Q6's `ctx`. The
> guideline's `string actor = 5` becomes a seventeenth stale site. **+1.**
>
> 🆕 **event_architecture Q5 elaborated, not answered** —
> the two setup functions, spelled out (now in [the decision](technical/event_architecture/context_decision.md#setup-ensures-safe-defaults-never-deletes)):
> `InitializeTopic` derives its topics from the proto, `InitializeSubscriber` takes one service's
> declaration, both refuse an immutable mismatch and never delete. No count change.
>
> 🆕 **event_architecture Q2 decided — no outbox** — *"we assume publisher is always publish message properly,
> and its pubsub responsbility"*, against my recommendation ([no-outbox-the-publish-is-trusted](technical/event_architecture/context_decision.md#no-outbox-the-publish-is-trusted)).
> The producer publishes after its commit, the Pub/Sub client retries for up to 60 s, and delivery from there
> is Pub/Sub's. **Re-examined (RULE 11):** stock critique 3, ledger critique 5 and balance critique 4 all
> recommended an outbox and now point at the decision · order Q14's event leg too — for a publish that
> never happens, **its finder is now the only detector** (#1) · no guideline mentions an outbox. **−1.**
>
> 🆕 **The owner renamed the option's field** — `context.md` line 45 now reads `string topic`, recorded as
> [the-option-field-is-topic](technical/event_architecture/context_decision.md#the-option-field-is-topic).
> It closes the naming point the removal left open. ⚠ The doc's three examples (lines 59, 66, 85) still
> write `topics:`, which `protoc` rejects — reported as a contradiction. No count change.
>
> ## Before this round
>
> 🆕 **`warehouse.event_base.v1` is removed** — *"remove warehouse.event_base.v1, its not used for further"*,
> answering event_architecture Q9 against my recommendation
> ([event-base-v1-is-removed](technical/event_architecture/context_decision.md#event-base-v1-is-removed)). The
> topic option lives in `warehouse.events.v1`. ⚠ **Recorded, not yet deleted from the code**: selling's two
> live events and `TopicName()` compile against it, so the delete lands in ONE change with the new option
> and their move — the decision lists all five sites, `CLAUDE.md`'s options table among them. ✅ **No proto
> question is left**: what stands between the design and the first event is now the library, not the contract.
>
> 🆕 **The owner cancelled multi-topic** — *"cancel multi topic"*: the global `Event` stays, and each
> variant names ONE topic ([one-event-one-topic-per-variant](technical/event_architecture/context_decision.md#one-event-one-topic-per-variant)).
> The old entry is renamed
> [superseded-one-event-many-topics](technical/event_architecture/context_decision.md#superseded-one-event-many-topics)
> and every link to it re-pointed, across five files. ✅ **It removes two costs** — a non-atomic fan-out,
> and the producer knowing its consumers (a second consumer is now a second subscription) — and **simplifies
> event_architecture Q9**: the shipped `event_config` at 50001 already holds one `event_topic` string, so it
> could be used as it is (⛔ answered the other way — above). The outbox (Q2) is back to closing the commit-to-publish gap only. ⚠ One new
> contradiction in the owner's doc: item 5 still shows `topics: ["stock", "order"]`, a list a `string`
> field cannot hold. No count change.
>
> ✅ **Six event decisions (2026-09-11), four as recommended** — five in one answer, *"for q7, yes, for q10
> yes, for q11 no, for q12 yes, for q13 yes"*, then Q8 on its own: *"for now there is no order key, for race
> condition, its service responsbility"*:
>
> | Q | decision |
> | --- | --- |
> | 8 | ⛔ [ordering-is-each-services-job](technical/event_architecture/context_decision.md#ordering-is-each-services-job) — **against my recommendation**: no ordering key for now; a race between events is the consuming service's |
> | 7 | [typed-fields-for-what-the-library-reads](technical/event_architecture/context_decision.md#typed-fields-for-what-the-library-reads) — `event_id`, `occurred_at`, `aggregate_id` typed on `Event`, beside the owner's `metadata` map |
> | 10 | [one-contract-for-both-handler-types](technical/event_architecture/context_decision.md#one-contract-for-both-handler-types) — `nil` ACKs · an error retries · an unhandled variant returns `nil` · `Claim` in the handler's own transaction |
> | 11 | ⛔ [push-routes-are-open-by-default](technical/event_architecture/context_decision.md#push-routes-are-open-by-default) — **against my recommendation**: no token check, for every adopter |
> | 12 | [one-adopter-checklist-for-both-drivers](technical/event_architecture/context_decision.md#one-adopter-checklist-for-both-drivers) — seven steps: named type, provider, route or `Run(ctx)`, one declaration, own dedup table, a test per variant |
> | 13 | [pull-worker-is-bounded-and-fails-loudly](technical/event_architecture/context_decision.md#pull-worker-is-bounded-and-fails-loudly) — returns only on cancel, and never the client's 1000 handlers at once |
>
> ⚠ **Re-examined for ripples (RULE 11) — three found.** `context.md` lags the decisions at six lines, a
> checklist rather than a question · the guideline nests the metadata in `EventMetadata meta = 1`, so
> [typed-fields-for-what-the-library-reads](technical/event_architecture/context_decision.md#typed-fields-for-what-the-library-reads)
> **overrides** `meta-at-one-payload-at-hundred` — four more stale guideline sites, plus one from the
> one-package brief, eleven in all · and,
> latent in code: liability's *"the ledger's write path has no wire surface"* holds only while liability
> has no push route. Its lever under the decision is **pull**, which has no inbound route to forge.
>
> ⚠ **Q8's ripples.** ✅ Settlement already meets it — every write is a delta and the cascade shifts later
> days, so any arrival order composes to the same report. ⛔ **Liability does not**: a cancel that arrives
> first reverses nothing and ACKs, and the late placement then charges a cancelled order — permanently.
> Latent while liability reads only the dev loopback, and now liability's to fix. And three more guideline
> sites go stale (`topic-per-context`'s ordering rationale, the planned `ordering_key_field`, §6's
> *"absent is an error"*) — fourteen in all.
>
> 🆕 **event_architecture Q2 now has a written proposal** —
> the outbox (⛔ since declined — [no-outbox-the-publish-is-trusted](technical/event_architecture/context_decision.md#no-outbox-the-publish-is-trusted)): two functions a producing
> service opts into, `Enqueue(ctx, tx, event)` inside its own transaction and `RunRelay` after commit. ⚠ It
> **revises my earlier decorator shape** — a decorator implementing `EventSender` cannot reach the caller's
> transaction, since the owner's `EventSender` takes no `ctx` and no `tx`. No count change.
>
> 🆕 **`context.md` gained an adopter recipe per driver, a pull library, and a `metadata` map on `Event` —
> re-examined as each landed.** Three halves are settled in the owner's doc itself, so three questions
> narrowed in place:
>
> | settled by the doc | what is left |
> | --- | --- |
> | the metadata lives on `Event`, as a `map<string, string>` | event_architecture Q7 — typed fields for the three keys the library READS. A misspelt `event_id` in a map reads `""`, and every later event dedups as a duplicate, silently |
> | push and pull get two handler types, one signature — Go converts a handler between them | Q10 — the four rules, written once above both |
> | `ListenSubscriber(subid)` receives, so `InitializeSubscriber` only creates | Q5 — its defaults and its compare-refuse contract |
>
> ⛔ **Three new questions and a contradiction.** The push recipe makes settlement's open webhook
> ([the-event-webhook-is-open](business/settlement/context_decision.md#the-event-webhook-is-open)) **every
> adopter's default** — and liability, the only other consumer with logic, writes its LEDGER from the
> event, on the path its own code says has *"NO WIRE SURFACE AT ALL"*. Settlement's decision rested on
> *"the ledger is not reachable from here"*, and a recipe copies the code without the basis (Q11: verify by
> default, settlement opts out by name). Both recipes stop at the handler — no dedup-table migration, no
> subscription declaration, and no route convention while two already exist (Q12). `ListenSubscriber`
> blocks with no stated lifecycle, and Pub/Sub's client runs **up to 1000 handlers at once** by default,
> on a DB pool with no connection limit (Q13). And line 100's `PushHandler` is the SHIPPED raw-request
> type, not the doc's `EventPushHandler` — reported as a contradiction.
>
> ⚠ **Ripple**: the settlement event spec moved to the owner's map plus the three typed fields
> ([analytic_context_clarify](business/settlement/analytic_context_clarify.md#proposed-design--the-settlement-event)),
> and so did **#6** below. ✅ Its three new questions, and two of the three it narrowed, were decided the
> same day — above.
>
> 🆕 **Then `### Webhook` gained a consumer contract — `EventPushHandler func(ctx, event Event) error`.**
> The library decodes and the handler gets the whole `Event`, which **removes a library contradiction**
> (dispatching on the decoded type is right when that type is always `Event`) and makes a metadata block
> on `Event` reach every handler for free — event_architecture Q7 now has a written proposal
> (✅ since decided — [typed-fields-for-what-the-library-reads](technical/event_architecture/context_decision.md#typed-fields-for-what-the-library-reads)). One new
> question: make it the ONE handler for push and pull, with four rules beside it — the two that fail
> silently are *return nil for a variant you do not handle* and *claim the id in your own transaction*.
>
> 🆕 **Re-examined twice more, and the owner's own doc edits closed a question and a half.**
> `## How Ensure Event Setup Related Properly` now has `InitializeSubscriber` beside `InitializeTopic`, so
> subscriptions are covered — what is left of event_architecture Q5 is the functions' contract, plus a
> naming trap: Pub/Sub's client calls the RECEIVING side a `Subscriber`. And
> `## How Event Received / Subscribed.` opened with two empty sub-sections — `### Webhook` and `### Pull`.
> ✅ That closes *push or pull* in the doc itself: **both**, and the question is deleted. Both
> sub-sections inherit a receive half **built twice and wired once**:
> `san_event.Receiver` (dedup in the handler's transaction, rejection records, a repeated-failure layer) is
> called by nothing, and the path that runs, `event_source.PushHandler`, has none of it. ⛔ **Two defects
> would drop events silently the day a real subscription pushes**, both verified against Google's docs: a
> push carries the FULL subscription path, which `liability_service` matches against short constants — so
> every event falls to `default:` and is ACKed — and `deliveryAttempt` arrives at the top level, which
> `PushRequest` never reads, and is `0` anyway without a dead-letter policy. The dev loopback passes short
> names, which is why none of it has failed. A receive path is proposed for the empty section, and every
> event_architecture question is rephrased so a bare *"yes"* accepts the recommendation.
>
> ✅ **Two event decisions, both against my recommendation, both taken the day they were asked.**
>
> | decision | what it settles | what it leaves |
> | --- | --- | --- |
> | [superseded-one-event-many-topics](technical/event_architecture/context_decision.md#superseded-one-event-many-topics) — one global `Event` in `warehouse.events.v1`, every variant naming its own topics (⛔ multi-topic cancelled later the same day) | **reverses** [superseded-no-global-event-envelope](technical/event_architecture/context_decision.md#superseded-no-global-event-envelope), a day old, by answering its one objection — one `Event`, one topic. Its other three reasons were accepted as costs | ⛔ **fan-out is now one publish per topic, so it is no longer atomic** — the outbox (event_architecture Q2) becomes the fix, not an option · the sketch has no home for the metadata (Q7), no per-topic ordering key (Q8) and a second `event_config` (Q9) · the guideline now disagrees at six sites |
> | [initialize-topic-is-a-function-not-a-flow](technical/event_architecture/context_decision.md#initialize-topic-is-a-function-not-a-flow) — the library ships the function, callers build the flow | who runs provisioning, and when. My `san`-command-at-deploy recommendation is **withdrawn** as a library requirement | what the functions **guarantee** (Q5, narrowed twice) — ✅ the doc has since added `InitializeSubscriber`, so subscriptions are covered. Left: its safe defaults, compare-then-refuse, and whether *Subscriber* means the resource or the receiving client |
>
> ⚠ **Re-examined for ripples, as RULE 11 asks after a decision that touches a shared shape.** Four
> agent-written sites assumed the old envelope and were updated: the settlement event spec
> ([analytic_context_clarify](business/settlement/analytic_context_clarify.md#proposed-design--the-settlement-event) —
> every settlement answer survives, only the wrapper moved), a settlement diagram, the FAQ's event-option
> entry, and **#6** below. ⛔ **The guideline is the one site not updated** — six of its rules describe the
> overridden shape, and it is not mine to edit without an ask.
>
> 🆕 **Found on the way, and still true**: a topic carries almost none of the config that fails — filter
> and ordering are fixed when a subscription is created, a DLQ needs an IAM grant, and a subscription with
> no activity is **deleted after 31 days**, which is exactly what a quiet DLQ triage subscription is · the
> one consumer with logic has **no push route** · the shipped Pub/Sub sender creates a `Publisher` per event
> and never stops one — ⚠ *since corrected*: not a goroutine leak in v2.6.1, but no batching and nothing to flush
> at a deploy ([6d](technical/event_architecture/context_clarify.md#6d--one-publisher-per-topic-and-a-cleanup)).
>
> ⚠ **Two corrections of my own.** A publish handed the request's `ctx` does not *"die"* on a disconnect —
> the send survives and the wait fails, so the caller reports a loss that did not happen. And *"a filter
> change is a data gap"* is avoidable: topic retention lets the replacement subscription seek back.
> → [event_architecture questions](technical/event_architecture/context_clarify.md#question)
>
> 🔧 **This file was repaired too**: the withdrawal line under *Off the display* was cut mid-sentence and
> followed by a stray table row, eleven code links resolved against `docs/` instead of the repo root, and
> one anchor pointed at a renamed section. All fixed.
>
> ✅ **The event package question was answered the same day it was ranked** —
> [superseded-no-global-event-envelope](technical/event_architecture/context_decision.md#superseded-no-global-event-envelope)
> (⛔ reversed a day later — above): **one envelope per context**, no shared `warehouse.events.v1`. It
> **ratified** the guideline rather than overriding it, so no override note was owed, and it was the first
> time the requirement tree and `guidelines/` had been aligned on anything in this area.
>
> ✅ **And the three-docs question went with it** —
> [the-library-doc-is-absorbed](technical/event_architecture/context_decision.md#the-library-doc-is-absorbed):
> `technical/event/library.md` is removed and its content moves into `event_architecture/context.md`.
> ✅ **The removal is DONE** — that file and its clarify are deleted and `docs/technical/event/` is
> gone. Its eight live points were **re-routed, not answered**, into the event_architecture clarify
> beforehand. ⚠ **The guideline stays** — it is a different lane (HARD RULE 7), not a fourth copy.
>
> ⛔ **But the delete ran BEFORE the merge, so the content it held is in git and nowhere else.** The
> push and pull flows, `EventSender`, the dead-letter design and the per-service registration rules
> are not in `context.md` yet — `git show d54b182:docs/technical/event/library.md`. That is a
> **recovery step somebody has to actually take**, not a formality, and this page is where it is
> tracked until it lands.
>
> ⚠ **One inbound link broke and it is the owner's to fix**: `ledger/mutation_and_ledger.md:154`
> says *"we rely `[event_library](../event/library.md)` for processing event"* and now points at
> nothing. Reported in
> [`mutation_and_ledger_clarify.md`](technical/ledger/mutation_and_ledger_clarify.md), never edited
> (RULE 7b). My own two references were repointed.
>
> 🔄 **#6 is RESHAPED and it got worse, not better.** The package half closed in a day; what the two
> decisions left behind is that **the decided envelope cannot be published by the shipped library at
> all**, and an envelope per context has now made the second half unavoidable rather than optional —
> `Register[T]` dispatches on the concrete decoded type, and with an envelope that type is always
> `SettlementEvent`. Both are library work that does not exist, and they interact: unwrapping the
> `oneof` changes the same handler signature `meta` does.
>
> ⛔ **A merge hazard is now tracked as its own section** —
> [what the removed doc held](technical/event_architecture/context_clarify.md#-what-the-removed-doc-held-and-what-must-not-come-back-with-it).
> `library.md` declares `san_event = 50099` while `TopicName()` reads `event_config` at **50001**, so
> an event carrying only the doc's option reports **no topic** — present in the `.proto`, invisible to
> the code. Copied into the authoritative doc during the merge, that stops being a stale sibling and
> becomes the instruction.
>
> 🆕 **Outbox-or-reconcile moved onto this board's active set** rather than being answered. It was
> asked against `library.md`, which is going away, and it is the same question
> [`stock/design_clarify.md`](technical/stock/design_clarify.md) asks of the three stock flows — one
> answer settles both. ⚠ It reaches settlement directly: a lost event is a report that disagrees with
> a log that is already right, which is the one damage class **#3** says nothing can repair.
>
> 🆕 **Settlement's event set is TWO IN and one out — and both inbound events already ship with no
> consumer.** `selling_service` publishes `OrderPlacedEvent` and `OrderCancelledEvent` today, and
> [`events.proto`](../proto/warehouse/selling/v1/events.proto) says so in capitals: *"IT CURRENTLY HAS NO
> CONSUMER, AND IS PUBLISHED ANYWAY … Do not stop publishing it because nothing listens."* Those are
> exactly `initial_total` and `initial_total_cancel`, which `context.md` currently gets by a
> **synchronous RPC from `order_service` whose failure is swallowed** — the seam **#1** is about.
> ⚠ Subscribing instead would replace *"logged loudly, no list of affected orders"* with
> at-least-once plus a DLQ, and it needs nothing new built. Both
> [the-order-commits-without-settlement](business/settlement/context_decision.md#the-order-commits-without-settlement)
> and [a-missing-account-is-fixed-by-hand](business/settlement/context_decision.md#a-missing-account-is-fixed-by-hand)
> were decided the other way deliberately, so this is not a reopening — it is a note that the
> mechanism making them unnecessary is already on the wire, and nothing is built yet.
> ⛔ **Three things to check first**: whether `OrderPlacedEvent.revenue` IS `order.marketplace_total`
> under another name · the two events sit on **two topics**, so a cancel can arrive before its
> placement (the ledger nets out either way, but `order_settlements.initial_total` is a frozen copy,
> not a delta) · and neither event carries `order_created_by_user_id`, which the user report keys on.
>
> ⚠ **A REVERSAL of my own, recorded as a contradiction** (RULE 11):
> [settlement Q3](business/settlement/context_clarify.md#question) recommended a **thin** id-only
> event while the payload spec said carry the row. Resolved **in favour of the row** — the thin
> argument assumed the fold is the only consumer, and the Financial Ledger is a **different service**
> that cannot read `settlement_logs` at all (HARD RULE 3). **The rule that stops it recurring: an
> event's payload is decided against the FURTHEST consumer, never the nearest.**
>
> ➡ **The event doc is scoped to EVENT design, not settlement design** (owner). What was written into
> its clarify as a settlement spec is **re-routed** to
> [`analytic_context_clarify.md`](business/settlement/analytic_context_clarify.md#proposed-design--the-settlement-event) —
> `analytic_context.md` `### Events.` is the doc that can answer what a settlement event carries
> (RULE 7b). What stayed behind is the generic half:
> [four rules that belong in the event doc](technical/event_architecture/context_clarify.md#four-rules-that-belong-here-not-in-each-contexts-doc) —
> a `oneof` variant is a kind of fact and never an enum value · an ordering key names the aggregate
> the **consumer** is keyed on, not the producer's id, and cannot be backfilled · `event_id` is
> derived from the causing row · an event carries the fact whole.
>
> 🆕 **#6 now has a concrete proposal to review**, not just a blocker. Its two non-obvious calls:
> **one variant, not one per `settlement_type`** (the fold runs the same statement for all eight) and
> **the ordering key is the SHOP, not the order** (the fold's key is `(day, shop_id, team_id)` and the
> carry reads the previous day).
> ⚠ **A correction**: I claimed a broker-message-id dedup key makes the replay a no-op. **Withdrawn** —
> [the-replay-cuts-three-tables-on-one-line](business/settlement/context_decision.md#the-replay-cuts-three-tables-on-one-line)
> already gives `settlement_event_logs` a `day` column, so the rebuild clears dedup by range. What
> survives is the **retry**, not the replay: a timed-out publish is retried, the retry mints a new
> message id for the same fact, and the row folds **twice**.
> ⚠ **And nothing publishes anything yet**: `post_entry.go` has no event at all, so the entire fold
> pipeline is designed against a message that is never sent.
>
> ⚠ **My `topic name = the proto package` recommendation is WITHDRAWN** (RULE 11 — a contradiction in
> my file, not the owner's). `event_topic` holds a **logical** name a resolver prefixes per
> environment; a package-shaped topic reads as a resource path. Replaced by `<context>-events`.
>
> ⬇ **`Can a team CONTEST a charge posted on its books?` drops off the display** — promoted last round
> when the webhook question was answered, and pushed off again by the row above. Unanswered and
> unchanged: [balance Q5](business/balance/context_clarify.md#question) ·
> [balance Q6](business/balance/context_clarify.md#question).
>
> ✅ **#3 was answered the same day it was ranked** — `context.md` made `system_adjustment` an eighth
> `settlement_type`, which settles it as a **ledger row** and **withdraws my report-column
> recommendation**. ✅ It also **unblocked #2**: the reconcile stays `Σ change` with no second term.
> 🔄 **The row is reshaped rather than closed**, because the answer left one case unexpressible — damage
> where the log is right and only the fold was lost, which is what every known drift cause produces.
>
> 🆕 **And the same edit reversed two decisions** — `order_id` is nullable
> ([superseded-every-entry-names-an-order](business/settlement/context_decision.md#superseded-every-entry-names-an-order) said
> NOT NULL) and there are now two grains
> ([superseded-the-grain-is-the-order](business/settlement/context_decision.md#superseded-the-grain-is-the-order) said *"the
> order, absolutely"*). ⚠ **Both need renaming with their references grepped** (RULE 12). ✅ It also gives
> the platform WITHDRAWAL a home, which was blocked on exactly that NOT NULL — see the settlement
> clarify. ⛔ **And it leaves the unique index unstated**: `UNIQUE (order_id, unique_id)` with a NULL
> `order_id` admits duplicates silently, and shop-addressed rows are precisely the NULL ones.
>
> ➡ **And #1 has MOVED to the order context** (owner, 2026-09-10): *"for ensure order half success or
> not, its order service responsibility"*. It had been tracked against architecture and settlement, and
> RULE 7b routes it to the doc that can ANSWER it — the order is what is half-done. Architecture Q2 is now
> a pointer, settlement's Awaiting carries one, and what stayed in architecture is a **contradiction**
> rather than a question: [the gate runs before the draw, and that doc says it cannot](technical/architecture/context_clarify.md#the-gate-runs-before-the-draw-and-this-doc-says-it-cannot).
> My `draw → gate → commit → release` recommendation is **withdrawn** — it solved a problem the shipped
> ordering does not have.
>
> 🔄 **#1 REFRAMED after opening the files it is about — the third time this page's own warning has
> paid off.** The row asserted that the repo has no saga, no compensation and settlement on the critical
> path. All three are false: `TeamCreate` compensates, `OrderPlace` compensates, and settlement's leg was
> decided on 2026-09-02. **The pre-commit half is handled with more care than the row credited** — the
> stock pick sits INSIDE the order's transaction. What survives is the post-commit half, and it is not
> *"what happens"* but *"how is it FOUND"*: three legs, all ending at “logged loudly”, and no list anywhere
> of the orders left behind.
>
> 🆕 **#3 is NEW, and it was opened by the answer to the row that closed.** The owner accepted the
> 31-day reach and then said what repairs the rest — a `system_adjustment` — without saying whether it
> is a ledger row or a report row. **That is the first settlement question on this page that blocks a
> BUILD rather than a decision**, because the repair path is now the only route for out-of-window damage
> and the two readings write to different tables.
>
> ⬇ **`Which PRE-CHECKS does a draft run?` drops back off the display** — promoted last round into the
> slot the replay row freed, and pushed off again by #3. Unanswered and unchanged both times.
>
> ⚠ **Three findings this round were the SAME shape**: a new case that never reached the list where
> every case appears together — `source_type` (two values, three shipped), `system_adjustment` (absent
> from `### Field that tracked.`), and the tracked list itself mixing SUM columns with LAST columns under
> one rule. HARD RULE 11 names this exact site, and it is now the most productive place to look.
>
> ✅ **#2 CLOSED — the replay's 31-day reach is accepted deliberately**
> ([the-replay-reaches-31-days-and-that-is-accepted](business/settlement/context_decision.md#the-replay-reaches-31-days-and-that-is-accepted),
> owner 2026-09-10). The owner supplied the premise — *"`AnalyticReplayCompute` is only ever used when
> something is already wrong"* — which was raised as an argument to revisit
> [the-replay-seeks-the-broker](business/settlement/context_decision.md#the-replay-seeks-the-broker) and
> answered the other way: damage older than the window is out of scope. **My `settlement_logs` re-fold
> recommendation is withdrawn.**
>
> ✅ **And that RETIRES this page's only deadline.** The archive subscription was ranked here because
> it was the one thing that could not be added retroactively and was the only way to extend the replay's
> reach. With the reach declared sufficient, **settlement no longer forces it**. ⚠ It is not answered —
> it stays open in [event_architecture](technical/event_architecture/context_clarify.md#critique) on its
> own merits (audit, other services, a definition change needing years), and *"an archive added later
> starts at now"* is still true. Settlement is simply no longer the thing holding its clock.
>
> ⚠ **What the closure did NOT settle**, and it is now a build task rather than a question: accepting
> *"I cannot rebuild February"* is not accepting *"typing February destroys March"*. The two bounds are
> still owed, and the accepted limit is what makes them mandatory rather than optional
> ([analytic Awaiting](business/settlement/analytic_context_clarify.md#awaiting)).
>
> 🆕 **A new context opened — `technical/event_architecture/`, and its doc is three lines.**
> [context.md](technical/event_architecture/context.md) states one decision: *"We use Google Pub/Sub"*.
> [Four questions](technical/event_architecture/context_clarify.md#question) came back with it, none
> displacing a row below — but **one of them reaches straight into #2**. That row's ceiling is
> *"the broker retains 31 days at most"*, and it is a ceiling **only because there is no archive**.
> One archive subscription per topic, writing raw messages to durable storage, is what turns the
> replay's hard floor into a soft one. ⚠ **It cannot be added retroactively** — an archive created
> later begins at *now*, and the months before it do not exist. That makes it the cheapest thing on
> this page and the one with a deadline.
>
> ⚠ **And the broker is decided in two docs that do not agree.**
> The removed `event/library.md` said *"supported is: Google Pub/Sub, local
> sqlite"* with a deferred RabbitMQ constructor — an abstraction over brokers.
> `event_architecture/context.md` says *"We use Google Pub/Sub"* — a choice of one. The difference is
> not stylistic: **a portable interface can only expose the intersection of its brokers**, and
> ordering keys, `dead_letter_policy` and `seek` are all outside that intersection — which is to say,
> the abstraction would forbid exactly the three features #2 depends on.
>
> ✅ **The settlement REPORT TABLES are now fully specified — three decisions in one round, and the
> biggest went against my recommendation.**
> [a-past-date-position-is-a-real-screen](business/settlement/context_decision.md#a-past-date-position-is-a-real-screen):
> a screen does read a shop's position at a past date, so `open_balance` / `close_balance` stay and the
> cascade, the genesis seed, the replay floor and the reseed are all paid for. **My case for dropping
> them is withdrawn.**
>
> ✅ **And what that position MEANS is settled too** —
> [the-position-is-the-shortfall-not-the-wallet](business/settlement/context_decision.md#the-position-is-the-shortfall-not-the-wallet):
> *"we dont care about shop wallet, `shop_settlement_daily_reports` is enough"*. That closed a question
> that was **upstream of the carry decision itself** — the phrase *"a shop's position"* fits both the
> cumulative shortfall and the marketplace wallet, and only the first is in that table.
>
> ✅ **It also DE-ESCALATED the withdrawal question**, which had been about to become blocking. A
> withdrawal is money leaving the wallet, so under the other reading no past-date screen could ship
> without it. With the wallet out of scope, [context Q1](business/settlement/context_clarify.md#question)
> and [architecture Q7](technical/architecture/context_clarify.md#question) stay open **on their own
> merits, at their own pace** — and `fund`'s undecided destination is unblocked the same way, and
> equally unanswered.
>
> ⚠ **The carry answer did not shrink the settlement board — it moved it.** Two of the three findings
> under that question were never about *whether* the columns exist, so they survived and became
> requirements: the number is **two quantities added together** (money still coming, and the cut that
> never will), so the screen's label is bound by
> [hidden-cost-is-left-in-the-balance](business/settlement/context_decision.md#hidden-cost-is-left-in-the-balance)'s
> *"name it hidden cost, not outstanding"*; and the stored copy can **drift from its own definition
> with no invariant able to see it**, which was harmless while nothing read it and is now #3.
>
> ✅ **A contradiction closed with it, and not by being fixed** —
> [the-carry-materialises-the-day-boundary-position](business/settlement/context_decision.md#the-carry-materialises-the-day-boundary-position).
> *"`open_balance` has two definitions"* had stood for three rounds. There was never a second
> definition: the day-boundary position is the **meaning**, the carry is the **storage**, the cascade is
> the bridge. ⚠ What that leaves is a bug class, not a settled point — which is why it is a question
> rather than a deletion.
>
> ✅ **The order seam is settled, and it was smaller than it looked.**
> [the-order-commits-without-settlement](business/settlement/context_decision.md#the-order-commits-without-settlement)
> — a failed `SettlementPost` never fails the order, because `initial_total` records something that
> already happened on the marketplace and a missing account is repairable where a lost order is not.
> [the-creator-is-read-from-the-token-at-placement](business/settlement/context_decision.md#the-creator-is-read-from-the-token-at-placement)
> — `orders.created_by_user_id` from `san_auth.GetIdentity(ctx)`, never client-supplied. ✅ Checked in
> code, two of the three pieces already existed: **`orders.marketplace_total`** is on the model and in
> the proto, and the **idempotency key is solved by accident** — `order_place.go` already derives
> `"order-placed:" + order_id` for its event, explicitly so *"a redelivery and a replay are the same
> logical fact and must collide"*, which is exactly the recipe `SettlementPost.unique_id` needs.
>
> ✅ **And the repair is settled too, by declining machinery**
> ([a-missing-account-is-fixed-by-hand](business/settlement/context_decision.md#a-missing-account-is-fixed-by-hand)):
> a person fixes it on the order detail page. A flag, a `san` repair command and a cross-service
> reconcile were all considered and turned down — **nothing new is built**, because
> [order-detail-manages-the-ledger](business/settlement/context_decision.md#order-detail-manages-the-ledger)
> already put the ledger on that page and CS is already permitted to post `initial_total`. Discovery is
> human: the gap surfaces when somebody reconciles against the marketplace payout report.
> ⚠ **One consequence is now load-bearing** — manual posting *is* the repair path, so the handler must
> refuse a second LIVE `initial_total`. The form hiding the option is a convenience, not a control.
>
> ✅ **The replay's source is DECIDED — it seeks the broker** ([the-replay-seeks-the-broker](business/settlement/context_decision.md#the-replay-seeks-the-broker)),
> against my recommendation of a `settlement_logs` re-fold. What it buys is one code path: the rebuild
> runs the identical handler as live traffic, so a fold bug cannot exist in one and not the other.
> ⛔ **What it requires is a checklist of four, and three are invisible from the code.** **(a)**
> `settlement_event_logs.id` **is** the broker's message id and a seek redelivers the same ids, so dedup
> must become **generation-scoped** (`run_id`) or every replayed message is dropped as a duplicate and
> the rebuild is a no-op. **(b)** **`retain_acked_messages` must be `true`** — it defaults to false, and
> a backwards seek then delivers nothing at all. **(c)** The replay must **not** hold
> `process_event_lock`, or the redelivered messages hit a webhook that rejects them and burn delivery
> attempts toward the dead-letter policy. **(d)** A seek is asynchronous, so the RPC cannot report
> success on a trigger.
> ⚠ **And it accepts a permanent ceiling**: a replay can never reach past the subscription's retention —
> 7 days by default, **31 at most** — which makes the genesis row and its floor **load-bearing** rather
> than prudent, since genesis is the only record of anything older.
> → [analytic Q1](business/settlement/analytic_context_clarify.md#question) ·
> [analytic Q2](business/settlement/analytic_context_clarify.md#question)
>
> ✅ **Six settlement questions answered in one day**, and the fold's design is now essentially closed:
> [init-opening-balance-is-deleted](business/settlement/context_decision.md#init-opening-balance-is-deleted)
> removes the cross-service call held inside the ledger's transaction **and the rollback that let a
> report refuse a payment that genuinely arrived** — the fold's own `INSERT … ON CONFLICT` is now the
> only creator of a daily row, and the race that call guarded is solved by the unique index with no lock
> at all. [superseded-genesis-is-seeded-from-the-state-table](business/settlement/context_decision.md#superseded-genesis-is-seeded-from-the-state-table)
> writes a day-zero row per scope from `SUM(order_settlements.last_balance)`, so no live shop opens at a
> false `0`. [a-replay-deletes-its-range-first](business/settlement/context_decision.md#a-replay-deletes-its-range-first)
> makes `AnalyticReplayCompute` clear `day >= @start_date` and rebuild, which removes the doubling.
>
> ⛔ **And the last two of those, taken together, turned a known gap into a DATA-LOSS bug.** The order's
> creator is carried on the event and stored on no table. A replay now **deletes** `day >= @start_date`
> from both daily tables and rebuilds from `settlement_logs` — which has no user — so
> `user_settlement_daily_reports` rows are removed and **cannot be reproduced**. The repair tool is the
> thing that loses the data. Genesis hits the same wall from the other side: the seed groups by shop and
> team, so the user table has no anchor either. **→ `order_settlements.creator_user_id`, stamped by the
> opening row** — and until it exists, the doc must say replay and genesis cover the **shop table only**.
> → [analytic Q1](business/settlement/analytic_context_clarify.md#question)
>
> ⛔ **A second interaction between the same two decisions**: a `start_date` at or before the genesis day
> **deletes the anchor**, and every rebuilt day then opens at `0` — silently, and it is exactly the
> failure genesis was introduced to prevent. The payload is a bare `start_date`, so nothing stops it.
> **→ Refuse a `start_date ≤` the genesis day**, and keep that day in `settlement_service_metadata`
> rather than as folklore shared between a migration and an RPC.
> → [analytic Q2](business/settlement/analytic_context_clarify.md#question)
>
> ✅ **Three settlement questions were answered in chat, two of them against my recommendation.**
> [dedup-and-compute-share-one-transaction](business/settlement/context_decision.md#dedup-and-compute-share-one-transaction)
> closes the last correctness hole in the live fold — a failed compute now rolls the dedup mark back with
> it, so a redelivery genuinely reprocesses instead of being ACKed as done.
> [the-event-webhook-is-open](business/settlement/context_decision.md#the-event-webhook-is-open) accepts
> an unauthenticated push endpoint; the reasoning that makes it survivable is that a forged POST corrupts
> a **projection**, not the ledger — which promotes `AnalyticReplayCompute` from a maintenance
> convenience to **the repair path for a reachable failure**.
> [the-carry-is-stored-not-derived](business/settlement/context_decision.md#the-carry-is-stored-not-derived)
> keeps `open_balance` / `close_balance` as real columns.
>
> ⛔ **Two of settlement's three remaining questions EXIST because of those answers.** **(a)** A carry's
> first row anchors the whole chain, and every live shop already holds balances — so `open_balance = 0`
> is wrong for all of them, and wrong **silently**, since `close − open = Σ movements` still holds while
> every absolute figure is offset. **→ Seed day zero from `SUM(order_settlements.last_balance)` per scope
> at migration time**, which is cheap exactly once. **(b)** The statements increment, so replay must
> **delete its range before re-folding** or it doubles — and with the webhook open, replay is now the only
> thing that can repair a forged event.
> → [analytic Q1](business/settlement/analytic_context_clarify.md#question) ·
> [analytic Q2](business/settlement/analytic_context_clarify.md#question)
>
> ⚠ **And one decision half-reverses another.**
> [open-and-close-are-log-sums-at-the-day-boundaries](business/settlement/context_decision.md#open-and-close-are-log-sums-at-the-day-boundaries)
> said the two balances are *snapshots aggregated from the log, never carried*. The **definition**
> survives — and becomes the invariant a reconcile verifies — but *"no carry"* and *"any day rebuildable
> alone"* do not. Both entries are annotated rather than silently left standing (RULE 12).
>
> ✅ **The corrected fold SQL was ADOPTED into the owner's doc**, and with it eleven of the defects this
> file was tracking close at once: the syntax runs, `close_balance` has one definition instead of three,
> the late-event cascade is a shift rather than a rebuild, and the `is Event Received late ?` branch is
> gone — a late event is now handled by a `WHERE day > @day` that matches nothing when the event is
> on time. ⛔ **But the same pass dropped `change` from `field that tracked` while both halves of the
> adopted statement still write it** — `ERROR: column "change" does not exist`, so nothing runs. It went
> out beside `balance`, which was the right one to drop.
> ⚠ **And the composite unique is `(day, shop_id, team_id)` while both queries filter equality on
> `shop_id, team_id` with a range on `day`** — the wrong column order for the only two queries in the
> design. `(shop_id, team_id, day)` is free: `ON CONFLICT` infers its index by column *set*, not order.
> → [analytic — what it broke](business/settlement/analytic_context_clarify.md#what-the-previous-round-adopted-and-what-it-broke)
>
> ⛔ **What was NOT adopted is now the largest gap, precisely because the statements are correct.**
> `### Flow` is unchanged: the dedup insert still runs **before** the compute, there is no transaction
> boundary drawn, and there is no advisory lock. Two correct statements in a wrapper that can swallow an
> event is still a fold that loses money — and nothing reports it, because the log has the row and the
> report does not.
> → [analytic Q1](business/settlement/analytic_context_clarify.md#question)
>
> 🆕 **`## How we do AnalyticReplayCompute.` was started and stops mid-word** — *"1. define `start"*.
> It needs nothing new: **lock, `DELETE … WHERE day >= @start_date` on both tables, re-fold from
> `settlement_logs`, unlock.** The carry survives because `start_date − 1` is not deleted, order does not
> matter now that every write is a delta, and it is re-runnable — which is the property the RPC exists
> for. ⛔ Without the delete it **doubles**, because the adopted statements increment and dedup is keyed
> on the message id.
> → [analytic — the replay algorithm](business/settlement/analytic_context_clarify.md#analyticreplaycompute--the-algorithm-your-own-statements-already-imply)
>
> 🆕 **Settlement became THREE docs, and the split answered one of this file's questions.**
> `context.md` kept the ledger; the reports moved to
> [analytic_context.md](business/settlement/analytic_context.md) and a new
> [meta_context.md](business/settlement/meta_context.md) holds a `settlement_service_metadata` key/value
> table. ✅ The drawn `Ledger Updated → Event → Message Broker → http push → Service Webhook` settles the
> last of the three competing architectures: **the fold owns the report, not the writer**
> ([the-fold-owns-the-report-not-the-writer](business/settlement/context_decision.md#the-fold-owns-the-report-not-the-writer)).
> My clarify split with it — the report questions were **re-routed** to
> [analytic_context_clarify.md](business/settlement/analytic_context_clarify.md) and
> [meta_context_clarify.md](business/settlement/meta_context_clarify.md).
>
> ⛔ **The sharpest thing found this round is a corruption produced by two answers that were each
> correct.** `### Idempotency Layer.` keys dedup on the **broker's message id** — right, and it resolves
> the replay collision in the right direction, because `AnalyticReplayCompute` republishes under new ids
> and is therefore deliberately not deduped. But the fold **increments** (`fund += @change`). Put those
> together and **a replay adds every movement in its range a second time** — and the RPC is reached for
> precisely when the rows already hold numbers. Neither half is wrong on its own; the pair is.
> **→ Recompute the day rather than increment it**, and replay becomes harmless. If the increment stays,
> replay must zero the range in the same transaction and the doc must say so.
> → [analytic Q1](business/settlement/analytic_context_clarify.md#question)
>
> ⛔ **And the dedup row is written BEFORE the compute**, so a compute that fails after it commits is
> redelivered, recognised as *already processed*, ACKed — and the movement is never folded, with nothing
> reporting it. ⚠ The fix has a Postgres detail that decides its shape: a raw PK violation **aborts the
> transaction**, so it must be `INSERT … ON CONFLICT DO NOTHING` with a rows-affected check, never a
> caught error inside the transaction that also does the compute.
> → [analytic Q2](business/settlement/analytic_context_clarify.md#question)
>
> ✅ **The user-dimension blocker was answered — for the live fold only.** `### Events.` now carries
> `order_created_by_user_id`, which is where that person comes from. ⛔ **But it is persisted nowhere** —
> not on `settlement_logs`, not on `order_settlements`, and [`orders`](../backend/services/selling_service/selling_service_models/order.go)
> still has no creator column (`AuthorUserID` is on `order_drafts`). So the user table can be folded and
> never **rebuilt**, and every writer must supply it forever on a request that has no such field.
> **→ `order_settlements.creator_user_id`, stamped once by the opening row** — the event may still carry
> it, it just stops being the only copy.
> → [analytic Q3](business/settlement/analytic_context_clarify.md#question)
>
> ⛔ **And a security hole that is not settlement's alone.** The doc specifies a webhook at
> `/event/[sub_id]/push`. [push.go:41](../backend/pkgs/event_source/push.go#L41) reads the body, decodes and
> calls the handler — **no token, no signature, no check of any kind** — and the roling ACL cannot reach
> it, because it reads `request_policy` off a Connect request message and a webhook is not one. Anyone
> who can reach the port POSTs JSON and moves a shop's reported balance. This is the **one write path in
> the system the ACL does not cover**, and every future consumer inherits it.
> → [analytic Q3](business/settlement/analytic_context_clarify.md#question)
>
> ⚠ **One answer went against my last recommendation, and it was right to.** I said delete the
> `is Event Received late ?` branch. The owner instead gave it a mechanism — `update and recount upper
> date` — which is **correct given a stored carry**: a snapshot has no chain to recount, a carry does.
> So the branch was never the question; **stored-or-derived `open_balance` is**, and it is now concrete:
> as drawn, one late event rewrites every later day for that scope while the live fold writes the same
> rows.
> → [analytic Q4](business/settlement/analytic_context_clarify.md#question) ·
> [analytic Contradiction](business/settlement/analytic_context_clarify.md#contradiction)
>
> 🆕 **The fold became SQL, which is the most checkable thing in any of these docs — and it does not
> run.** Four statements: `+=` is not a Postgres operator, `SET d.col` is rejected (the alias is legal
> everywhere except the left of `SET`), and a `VALUES` list cannot see a CTE. Underneath the syntax the
> arithmetic is wrong in five places, two of them silent: `d.fund` appears **twice** in the
> `close_balance` sum, and the update recomputes `close_balance` **without** `open_balance` — so a day is
> correct until its second movement arrives and then loses all prior position, permanently, while still
> looking internally consistent. **Not a question** — the corrections are written out, and two statements
> replace four. ⛔ **What IS a question is the bucket day**: step 1 derives it from `created_at` in GMT+7
> while [posted-on-buckets-the-report](business/settlement/context_decision.md#posted-on-buckets-the-report)
> fixed it on `posted_on`, which is stamped on the **UTC** date with no timezone configured anywhere. The
> two disagree for every movement between 00:00 and 07:00 WIB.
> → [analytic — the write path](business/settlement/analytic_context_clarify.md#the-write-path-checked-statement-by-statement)
>
> **One line in the owner’s doc reversed this file’s own recommendation, and the reversal is worth more
> than the row it changes.** `settlement_context.md` gained `## General.` 1 — *"Design Analytic Principle
> is follow [this](business/analytic/context.md)"* — so the settlement report is built the **pipeline**
> way: log → broker → stream → report table, not a `GROUP BY`
> ([the-report-follows-the-analytic-principle](business/settlement/context_decision.md#the-report-follows-the-analytic-principle)).
>
> ⛔ **This is the first time #7 has been answered by a decision rather than argued about — and it makes
> #7 BLOCKING for a second context.** Settlement’s report now inherits every open question in `analytic`:
> the fold contract, the rebuild path, the midnight reconcile, the dedup layer. A context that had
> finished designing its report in a day is now waiting on the one context that has not started.
>
> ⛔ **And the pipeline has no parts.** Checked against the code: `settlement_v1.Service` takes a
> `*gorm.DB` and no `EventSender`, there is **no settlement event message in the proto**, nothing
> consumes one, there is no report table migration, and there is **no analytic or report service in
> `backend/services/`**. [settlement-publishes-to-the-book](business/settlement/context_decision.md#settlement-publishes-to-the-book)
> was decided long ago and never built — so the *"Source Truth Logs"* box that the whole analytic design
> stands on is, for its one existing log, **a table nobody publishes**.
> → [settlement Q6](business/settlement/context_clarify.md#question)
>
> ✅ **Two answers that turned out to agree.** `## Whats Number to be reported.` lists the seven ledger
> types — which is an **additive basis** for the measure decided hours earlier, not a replacement for it
> (`sales`, `net_received` and `gap` are all derivable from those seven). And `posted_on` fits a stream
> processor better than the alternative would: a fold learns of a row when its event arrives, which is
> what `posted_on` already means.
>
> ⚠ **One contradiction, and it is mine.** The measure decision also asserted *"a fold over facts, not a
> stored table"* — overtaken the same day. The property worth keeping: **a decision about a MEASURE must
> not also assert WHERE it is computed.**
> → [settlement Contradiction](business/settlement/context_clarify.md#contradiction)
>
> ⛔ **Sequencing was answered and then REVERSED, both within the day.** *Query first* was taken and is
> now cancelled — [the-report-is-the-pipeline-from-day-one](business/settlement/context_decision.md#the-report-is-the-pipeline-from-day-one)
> strikes [the-report-ships-as-a-query-first](business/settlement/context_decision.md#the-report-ships-as-a-query-first).
> So **settlement is blocked by `analytic` after all**, and by four missing pieces starting with a
> publisher it does not have. ⚠ **Two things are owed because that phase is gone**, and they are cheap now
> and expensive later: keep the aggregate as a **test oracle** even though it is never an RPC — it was the
> only independent second opinion the folded table would have had — and make the fold **re-runnable from
> the log by cursor**, because Pub/Sub retains messages for days and a definition change needs years.
> **The fourth dimension:** *Group by Customer Service* became **Group by User**
> ([the-fourth-shape-groups-by-user](business/settlement/context_decision.md#the-fourth-shape-groups-by-user)) — so the
> dimension is `actor_id`, which settlement already carries, and the *"a column that exists in no
> table"* blocker is gone without touching `selling_service`. ⚠ What replaces it is narrower: `actor_id`
> is **who wrote the row**, so an imported fee lands on the importer’s PIC rather than on whoever sold.
>
> ⛔ **Then a new section arrived that describes HOW a write happens — and it is where the day’s
> answers stop agreeing with each other.** `# Settlement Ledger.` draws the write protocol: open a
> transaction, lock the state, **call another service’s `InitOpeningBalance` inside it**, and **roll the
> ledger write back if that call fails**. Nothing of it is built — no `InitOpeningBalance`, no
> `settlement_states`, no daily shop report in the repo.
>
> | ✅ what it settles | ⛔ what it opens |
> | --- | --- |
> | **settlement DOES publish** — `Dispatch Event` finally gives [settlement-publishes-to-the-book](business/settlement/context_decision.md#settlement-publishes-to-the-book) a drawn path, which was the missing first part of the pipeline · the write is transactional and the state is **locked**, the right shape for two people on one shop | **a THIRD architecture for one report table** — a `GROUP BY` at read, a stream fold, and now a table the WRITER maintains synchronously · **a network call inside a transaction holding a row lock** · **a report failure rolls back money that really arrived** · an **opening balance**, which the measure decided hours earlier has no place for |
>
> ⚠ **It is also a concrete instance of #1 below, answered in the wrong direction.** One seam up, a
> publish failure must not fail the order — here a report-bootstrap failure fails the ledger write. The
> same question got opposite answers a paragraph apart.
> → [settlement Q7–Q9](business/settlement/context_clarify.md#question) ·
> [the protocol read in full](business/settlement/context_clarify.md#the-ledger-write-protocol--read-against-the-two-decisions-taken-today)
>
> ⚠ **And the state table now has two names** — `settlement_states` in the new section, `order_settlements`
> in the old one, in the migration, in the proto and in a recorded decision. Second time in this context
> that one concept has been written down twice.
> → [settlement Contradiction](business/settlement/context_clarify.md#contradiction)
>
> ⛔ **And then the table itself arrived — with two silent defects.** `## Smallest Grain Reports.`
> names `shop_settlement_daily_report`, unique on `(day, shop_id, team_id)`, carrying per-type movements
> **and** an open/close balance — so the opening-balance question is answered, and answered as **both**
> ([the-smallest-grain-is-the-shop-day-statement](business/settlement/context_decision.md#the-smallest-grain-is-the-shop-day-statement)).
> ✅ The statement shape is only safe because `posted_on` already guarantees a closed day never moves —
> two answers taken hours apart that turn out to depend on each other.
>
> | ⛔ the defect | why it is silent |
> | --- | --- |
> | **`affiliate_fee` is not in the tracked columns** — six of seven types are | an affiliate cut moves `close_balance` while appearing in no column, so `close − open ≠ Σ movements` and the difference has no name. It is the one failure a statement shape exists to make impossible |
> | **there is no USER dimension** | the grain serves shapes 1–3 exactly and **cannot serve shape 4 at all**. ⚠ And the fix is not a wider key: a running position belongs to an ACCOUNT, whose later movements are posted by different people, so a per-user open/close is meaningless — the second table must be **sums only** |
>
> → [settlement Q9](business/settlement/context_clarify.md#question) · [settlement Q10](business/settlement/context_clarify.md#question)
>
> ✅ **Both defects were answered within the hour — one fully, one half.** A second grain table
> `user_settlement_daily_reports` now exists, keyed `(day, user, team)` rather than widening the shop
> table’s key ([the-user-grain-is-a-second-table](business/settlement/context_decision.md#the-user-grain-is-a-second-table)),
> so shape 4 has a source. ⛔ It copies `open_balance` / `close_balance`, which is the half that does not
> transfer: a running position belongs to an **account**, whose later movements are posted by different
> people, so a user’s closing figure is not a position that user holds.
> → [settlement Q9](business/settlement/context_clarify.md#question)
>
> ✅ **And the reason for `InitOpeningBalance` is now stated — a lost update on the window aggregation.**
> The race is real and worth guarding. ⛔ But it justifies **a** guard, not **this** one: the contended
> row is the report’s, so the guard belongs there — serialize the fold on the broker’s ordering key
> `(shop_id, day)`, or `INSERT … ON CONFLICT DO NOTHING` in the report’s own transaction. Neither needs a
> network call held inside the ledger’s transaction, and neither can roll a settlement write back.
> → [settlement Q8](business/settlement/context_clarify.md#question)
>
> ✅ **And the two balance columns turned out to be simpler than the argument about them.** They are
> **snapshots aggregated from the log at the day boundaries**, never carried forward
> ([open-and-close-are-log-sums-at-the-day-boundaries](business/settlement/context_decision.md#open-and-close-are-log-sums-at-the-day-boundaries)).
> No carry means no dependency on a previous row, every day is recomputable from `settlement_logs`
> alone — which is the rebuild path the cancelled query phase was going to supply — and
> `close − open = Σ movements` stops being a convention and becomes an **identity**, which makes the
> missing `affiliate_fee` provable rather than suspected.
>
> ✅ **It is also only well-formed because the date is `posted_on`** — `balance` is stamped in WRITE
> order, so *"the position at the end of day D"* means *"the last row written by D"*, which `occurred_on`
> could not express. **Third time those two answers have turned out to depend on each other**, and worth
> naming as a pattern: this context’s decisions are compounding rather than accumulating.
>
> ⛔ **And it forces an older question.** A shop snapshot partitions the book exactly once; a user
> snapshot only does if the set is *the orders that user opened*. So the user table’s balances cannot
> exist unless shape 4 is attributed to the order’s opener rather than the row’s writer — one answer now
> decides two questions.
> → [settlement Q9](business/settlement/context_clarify.md#question) · [settlement Q5](business/settlement/context_clarify.md#question)
>
> ✅ **`affiliate_fee` landed in both grain tables**, so the identity `close − open = Σ movements` can
> hold and the one defect that would have made a statement silently fail to reconcile is gone.
>
> ⚠ **And two of this context’s questions MERGED**, which is worth more than either being answered:
> shape 4’s grouping and the user snapshot’s set cannot be decided separately, because a snapshot only
> partitions if the dimension owns the account. One answer now settles both — and it is the same shape of
> compounding this context has shown three times already, where a decision taken for one reason turns out
> to constrain something decided hours earlier.
>
> ✅ **And the attribution was answered the consistent way** — *"the user is who created the order"*
> ([the-user-is-the-order-creator](business/settlement/context_decision.md#the-user-is-the-order-creator)).
> Shape 4 is a sales report, the user snapshot partitions the book exactly once, and imported fees stop
> piling onto the importer’s PIC.
>
> ⛔ **It names a person settlement does not record.** `actor_id` is *who wrote the row* and stays that,
> so the creator needs a column — **`order_settlements.creator_user_id`, stamped by the opening row**, is
> the cheap shape, because the fold then joins log → state inside one service. ⚠ And an account whose
> `initial_total` never arrives has **no creator at all**: settlement ignores order status, the exporter
> can post a `fund` first, and a `marketplace_total = 0` order opens no account — real money with nobody
> to attribute it to.
>
> ⚠ **This raises the price of #1 below rather than lowering it.** With no `order_service → settlement`
> call built, nothing stamps a creator on anything, so the user report is not merely empty — it has no
> dimension. The unbuilt seam now blocks two tables.
> → [settlement Q5](business/settlement/context_clarify.md#question)
>
> ⛔ **Then the empty heading was filled — and it disagrees with an answer given an hour earlier.**
> `## How `*_settlement_daily_reports` Created` says today’s row takes the **last row’s `close_balance`**
> as its `open_balance`, or 0 if there is none. But *"open and close balance is sum of balance log of
> start and end of the day"* made those columns a **snapshot aggregated from the log**
> ([open-and-close-are-log-sums-at-the-day-boundaries](business/settlement/context_decision.md#open-and-close-are-log-sums-at-the-day-boundaries)).
> A snapshot and a carry are not the same number, and they diverge in three reachable ways: **`open = 0`
> is wrong for every shop that already trades**, a chain **cannot be rebuilt from one end**, and **one
> missed day poisons every day after it, silently and permanently**. The snapshot has none of those.
> → [settlement Contradiction](business/settlement/context_clarify.md#contradiction)
>
> ⛔ **And `## General.` — the line that chose the architecture — has been DELETED.** *"Design Analytic
> Principle is follow this"* is no longer in the doc, and it is the entire basis of
> [the-report-follows-the-analytic-principle](business/settlement/context_decision.md#the-report-follows-the-analytic-principle).
> ⚠ **A deletion is not a statement**, so it is not recorded as a reversal — but the decision now rests on
> a line that does not exist, and the section that replaced it describes a row **created on demand from
> the previous one**, which is the writer’s path rather than a fold’s. Both moves point away from the
> pipeline, and the query phase was cancelled on the strength of it.
> → [settlement Q7](business/settlement/context_clarify.md#question)
>
> ⚠ **A re-examination with nothing new in the doc — and the finding came from next door.**
> `settlement/context.md` changed by one byte since the last pass and no code has landed since 08-28, so
> none of settlement’s eight questions moved. What moved is the sibling: `analytic` recorded
> [reports-belong-to-the-consumer](business/analytic/context_decision.md#reports-belong-to-the-consumer),
> which relocates *"which numbers, for whom"* to each consuming service — **and cites settlement as its
> proof, on the strength of settlement *"pointing here for the principle"*. That pointer is the
> `## General.` line settlement deleted.** One context has built a decision on a reference the other no
> longer contains, which makes the deleted line a two-context question rather than a one-context one.
> → [settlement Q7](business/settlement/context_clarify.md#question)
>
> ✅ **The deleted line was deliberate: *"because its not mature"*.** Settlement will not bind its
> report to an unfinished design
> ([the-analytic-pointer-is-withdrawn-until-it-is-mature](business/settlement/context_decision.md#the-analytic-pointer-is-withdrawn-until-it-is-mature)),
> so [the-report-follows-the-analytic-principle](business/settlement/context_decision.md#the-report-follows-the-analytic-principle)
> is **withdrawn** and the reason the query phase was cancelled goes with it.
>
> ⚠ **Two of three architectures are now struck, and the survivor is the one the doc actually details** —
> the ledger’s own write path. If that holds, settlement needs **no publisher, no broker and no consumer**
> to have a working report, which is a far smaller build than the last two rounds assumed — and it makes
> the in-transaction guard argument the whole of what is left, because the ledger’s transaction really
> would be doing report work.
>
> ⚠ **This row’s own #7 loses its example.** [reports-belong-to-the-consumer](business/analytic/context_decision.md#reports-belong-to-the-consumer)
> was argued on settlement pointing at analytic *"for the principle"* — the line withdrawn here. The
> decision may still be right; its evidence is not.
> → [settlement Q7](business/settlement/context_clarify.md#question)
>
> ## The round before
>
>
> **The ledger got its first WORKLOAD, and it cannot serve any of it yet.**
> [business/settlement/context.md](business/settlement/context.md) gained `# Settlement Reports.` —
> four report shapes at three grains (team, shop, customer service) over a daterange, at daily /
> monthly / yearly resolution.
>
> | what it settles | what it opens |
> | --- | --- |
> | ✅ **the first concrete answer to #7's demand** — *name the questions a real person asks*. These are real, named, and at a grain the repo already stores · ✅ **and the whole report was settled the same day** — the measure ([the-measure-is-sales-received-and-gap](business/settlement/context_decision.md#the-measure-is-sales-received-and-gap)), the fold ([the-report-is-movement-dated](business/settlement/context_decision.md#the-report-is-movement-dated)) and the date ([posted-on-buckets-the-report](business/settlement/context_decision.md#posted-on-buckets-the-report), ⚠ against recommendation) | ⛔ **"customer service" is a column in no table** — not on `settlement_logs` (its `actor_id` is who *typed the row*), not on `orders` |
>
> ⛔ **Two of the four shapes cannot be authorized as written.** `team_id` is `use_scope` and required
> `> 0` on every settlement request; a report with one row PER team is by definition the thing the
> scope forbids. Either they are declared **admin screens** — ROOT/ADMIN in team 1, the bypass that
> already exists — or a `repeated team_id` becomes a **new authorization primitive**.
> → [settlement C5](business/settlement/context_clarify.md#critique)
>
> ⚠ **And the two docs describing this pipeline still do not cite each other.** Settlement says it
> *serves* these reports — [analytic/context.md](business/analytic/context.md) says a stream processor
> builds them, from the same three grains. **→ Settlement's own `GROUP BY` first**, on the precedent
> named below: `revenue_service` was the pipeline version of exactly this and lost to a plain
> aggregate over fact rows.
> → [settlement C6](business/settlement/context_clarify.md#critique) · [settlement Q5–Q7](business/settlement/context_clarify.md#question)
>
> ## Two rounds back
>
> **Analytic named its audiences, and a re-examination against the code found the precedent nobody
> had cited.** [business/analytic/context.md](business/analytic/context.md)'s `## Responsbility` went
> from *"Provide Analitical Data to user"* to **three named audiences** — Warehouse Team, Selling
> Team, Admin Team.
>
> | what it settles | what it opens |
> | --- | --- |
> | ✅ **half of #7.** *For whom* is answered — and answered better than it looks: all three are **`TeamType` values**, so the audience list is a **scope list**, which lands directly on the report table's grain | ⛔ *which numbers* is still unstated, so #7 stands · 🆕 **one order fact belongs to three of them at once** — `OrderPlacedEvent` carries the selling team, the fulfilling warehouse **and** a supplying team per line, against one `Report Table` box · 🆕 **"Admin Team" has no code path** — the scope bypass is by ROLE in team 1, not by `TEAM_TYPE_ADMIN` |
>
> ⛔ **The foundation is the least-built part of the system.** Of the four *"Source Truth Logs"* the
> ledger doc names and this design stands on, checked against the migrations: **one exists.**
> `settlement_logs` ✅ · `stock_movements` ⚠ close enough · **`expense_records` is not a log** — an
> entity table whose `ExpenseUpdate` rewrites **amount, kind and the month it belongs to** in place,
> publishing nothing · **purchasing has no service and no table at all**. So a folded bucket can go
> wrong twice — the month a cost left and the month it joined — with no message to tell anyone, and
> that is shipped behaviour *before* any pipeline exists.
> → [analytic C13/C14](business/analytic/context_clarify.md#critique)
>
> ⛔ **The finding that should change the argument: this repo already BUILT this design and DELETED
> it.** `revenue_service` was a push subscriber on `order-placed`/`order-cancelled` with its own
> report table and a daily rollup — six issues of work (#74, #75, #78, #153, #164, #171) — removed in
> `0d4cbc4`. Two details matter: it lost to the **actual** data (settlement, at order grain) rather
> than to a better pipeline, and its `RevenueDaily` was a **`GROUP BY` over the fact rows**, not a
> bucket table. The one daily report this repo shipped needed no incremental aggregation at all.
> → [the record](business/analytic/context_clarify.md#the-report-table-this-repo-already-deleted)
>
> ⚠ **A correction to this file's own last round.** It repeated the clarify's claim that *"nothing on
> that diagram has ever run"*. **Wrong** — [liability_service/push_handler.go](../backend/services/liability_service/push_handler.go)
> consumes both order events and charges real ledger fees, so **push is the deployed mode** and the
> doc's "push *and* pull" really reads *"add pull"*. What genuinely does not exist: any **pull**
> subscriber, and any **broker** in the dev server (`event_sender.go` is a synchronous in-process
> loopback, so no retry, redelivery or dead-lettering is exercised anywhere). ⚠ Exactly the failure
> the header warns about, twice in three rounds: a claim carried forward without opening the file.
>
> ## Earlier rounds
>
> **The last unwritten context got a design — and it arrived from the far end.**
> [business/analytic/context.md](business/analytic/context.md) went from seven lines to forty, and all
> forty are architecture: Pub/Sub, push *and* pull, a stream processor, a report table. Its only
> statement of business is still line 8, *"Provide Analitical Data to user"*.
>
> | what it settles | what it opens |
> | --- | --- |
> | analytic is **no longer a blank page** — there is a concrete pipeline to argue with, authored by **Heri** for a lane that is **Toni's** ([analytic-sits-with-stock](business/project/member_decision.md#analytic-sits-with-stock)), with a second design invited for comparison | ⛔ **nobody has said which numbers, for whom** — so no part of the pipeline can be judged · the design **already exists at higher resolution** in [mutation_and_ledger `# Statistic Design.`](technical/ledger/mutation_and_ledger.md), and the two copies **already disagree** · `Source Truth Logs` is one box where [ledger/context.md](business/ledger/context.md) has four, in four services across **both** lanes |
>
> ⛔ **The contradiction is the load-bearing one.** `mutation_and_ledger.md` says statistic is
> *"streaming **and** reconcile every midnight + 1 hour"* — the analytic diagram has **no second path**.
> If reconcile is real the broker is an optimisation and a lost message is self-healing; if the diagram
> is right, the publish-after-commit hole ([mutation_and_ledger C5](technical/ledger/mutation_and_ledger_clarify.md#critique))
> becomes a permanently wrong report with nothing to detect it.
> → [analytic Contradiction](business/analytic/context_clarify.md#contradiction)
>
> ⚠ **It displaces the withdrawal question from the display** (was #7 — unchanged, still open, still
> counted below). The rule at the top is what did it: *"which numbers, for whom"* **stops a lifecycle
> pass** — analytic cannot enter `implementation_analysis` without it — where the withdrawal question
> blocks a reconciliation nothing has built yet and already has a recommended home.
>
> ✅ **Nothing on that diagram has ever run.** `san_event` has the receive half built (`Claim`,
> `Handled`/`Duplicate`/`Rejected`, rejection recording), but **no subscription consumes anything** —
> `inventory_service/push_handler.go` acks every message as a no-op. The pipeline is a proposal, not a
> thing to migrate off.
>
> ## Earlier still
>
> **A new file, and it asks a question of a different KIND: not what the system does, but who
> decides.** [business/project/member.md](business/project/member.md) is the first doc in the repo
> that names a person — Heri, Hendra, Toni — and assigns scope to two of the three.
>
> | what it settles | what it opens |
> | --- | --- |
> | **seven of the eight contexts and 10 of the 12 services** are now assigned — Heri holds 8 services (75 RPC / ~13.1k lines), Toni 2 (60 RPC / ~9.8k) plus two greenfield contexts — `stock`, `product`, `analytic` → Toni · `order`, `settlement`, `balance`, `user` → Heri ([products-follow-the-unit-price](business/project/member_decision.md#products-follow-the-unit-price) · [analytic-sits-with-stock](business/project/member_decision.md#analytic-sits-with-stock) · [identity-sits-with-order](business/project/member_decision.md#identity-sits-with-order)). Hendra is on legacy and **joins later**, so there are **two deciders, not three** ([hendra-joins-later](business/project/member_decision.md#hendra-joins-later)) · the four support services → Heri ([support-services-sit-with-order](business/project/member_decision.md#support-services-sit-with-order)) | ⛔ **`ledger` is the last unowned one** — four producers publish events into it across both lanes, one reader out of it, and **7 of the questions below** sit inside it · no boundary between the two lanes has an owner either · and with two deciders a disagreement has no majority |
>
> ⚠ **The absent member makes it worse, not smaller.** `ledger` cannot be parked on someone who has
> not arrived — a reserved scope and an unowned one are identical for every question asked in
> between — so it needs an owner among the two people here. 🔄 **→ Toni**, reversing this file's
> previous answer: the ledger is a **Pub/Sub subscriber** with four producers spanning both lanes,
> so no producer waits on it and none of them is picked out as its owner — while its **only reader,
> `analytic`, is Toni's**. ⚠ Whoever takes it inherits *purchasing*, a first-class producer in the
> owner's own diagram with **no service and no context doc**
> ([ledger C5](business/ledger/context_clarify.md#critique)).
>
> ✅ **Concurrency is not the constraint.** Exactly **one** in-process import crosses the two lanes
> (`inventory_service` → `liability_service`); everything else crosses over the proto contract. What
> two people actually collide over is generated files and registry lists, all mechanical
> ([member_clarify.md](business/project/member_clarify.md#working-concurrently--the-split-is-fine-the-shared-files-are-the-problem)).
>
> ⚠ **It does not displace a row, and the reason is worth writing down.** Every question below is
> still answerable today, because one person still answers everything — so nothing is *blocked* by
> the routing being unwritten. **The moment three people answer, this becomes #1-shaped**: 16
> `_clarify.md` files address *"the owner"*, and `CLAUDE.md` merges to `main` *"when the owner
> asks"*. Both are now ambiguous in a way no single file can resolve.
> → [member_clarify.md](business/project/member_clarify.md#question)
>
> ## Earlier than that
>
> **Three questions answered, and a re-examination that re-ordered the list.** The owner asked which
> open questions blocked the FRONTEND analysis, was given the triage, and answered all three.
>
> | the question | the answer | |
> | --- | --- | --- |
> | *Summarize All Balance* — screen or tiles? | **the tiles** | [the-summary-is-tiles-on-the-list](technical/balance/team_balance_design_decision.md#the-summary-is-tiles-on-the-list) |
> | where is the DEFAULT terms row edited? | **a dialog on the list** ⚠ against recommendation | [the-default-terms-row-is-a-dialog-on-the-list](technical/balance/team_balance_design_decision.md#the-default-terms-row-is-a-dialog-on-the-list) |
> | does `found` need the owner's acknowledgement? | **no** ⚠ against recommendation | [found-posts-without-a-handshake](business/balance/context_decision.md#found-posts-without-a-handshake) |
>
> ⛔ **One of them moved weight rather than removing it, and it landed at #3.** Refusing `found` a
> handshake makes **dispute** a team's only recourse against a charge asserted in the asserter's
> favour — and dispute does not exist.
>
> ### ⚠ The re-examination finding: this file was ranking questions the CODE had already answered
>
> Four of the seven rows were checked against the source rather than against the docs, and four had
> moved without the file noticing:
>
> | was ranked as | actually |
> | --- | --- |
> | the ledger vocabulary migration, #3 | ⛔ **not a question at all** — migration `00005` shipped the vocabulary, `actor_id` and `liability_logs`. Removed |
> | *freight divides by the EXPECTED quantity*, half of #1 | ✅ **already correct in code** — [restock_request_fulfill.go:210](../backend/services/inventory_service/inventory_v1/restock_request_fulfill.go#L210) divides by what arrived. The owner's DIAGRAM draws it the other way, so the question is about the diagram |
> | *what moment consumes a FIFO layer*, #4 | ⚠ **built the way this file recommended**, unratified. Demoted to #7 as a ratification |
> | *where is the DEFAULT row edited*, #7 | ✅ answered this round |
>
> **The cause is named in [the balance state report](development_state/balance/context.md): contexts here
> were built before they were designed.** A rollup derived from `_clarify.md` alone inherits that — it
> cannot see that the code has taken a position, so a settled question keeps its rank. ⚠ **Code taking
> a position is NOT the owner deciding one** (HARD RULE 8), so none of these is closed by being built.
> But *"nobody has decided and nothing is written"* and *"it is running, please ratify it"* are
> different sizes of open, and only the first belongs near the top.
>
> **→ Every rebuild from here checks the top rows against the code**, not only against the clarify files.
>
> ## Live and not a question
>
> ✅ ~~**Nothing below the contract is verified.**~~ **Stale — removed.** This said migrations had
> never run and every DB-backed test skipped. It has been overtaken: the balance pass records unit,
> integration and e2e green together for the first time
> ([balance state](development_state/balance/context.md)), and `6ae4d55` (2026-08-31) is *"the e2e
> suite is green"*. ⚠ Exactly the failure this file's own header warns about — a claim carried
> forward without being checked against the code.
>
> ⚠ **"Summarize All Balance" is computed over ONE PAGE, and the answer made that binding.** Three of
> the four tiles on `/liability` reduce the loaded 20 rows, so a creditor with 21 counterparties reads
> a headline that omits one — and now the summary is fixed as tiles on a **paginated** list, it can
> never run a whole-set query of its own. The fourth tile, *awaiting confirmation*, already comes from
> the server and is the precedent for the other three
> ([technical balance C16](technical/balance/team_balance_design_clarify.md#critique)).
>
> ⛔ **The 80% warning has TWO homes named in §About Thresholds 1 and is in NEITHER.** One of them, the
> daily report, is parked ([the-daily-report-is-deferred](business/balance/context_decision.md#the-daily-report-is-deferred))
> — and it was the DEBTOR's view, so what survives warns the person who is fine rather than the person
> about to stop trading ([technical balance Q9](technical/balance/team_balance_design_clarify.md#question)).

---

| # | The question | Blocks | Asked in | My recommendation |
| --- | --- | --- | --- | --- |
| **1** | **How is a half-succeeded order FOUND afterwards?** 🔄 **REFRAMED, and the old framing was wrong on three counts.** This row said there is *"no outbox, no saga and no compensation anywhere in the repo"* and that settlement *"sits on the critical path"*. Opening the files: [team_create.go:21](../backend/services/team_service/team_v1/team_create.go#L21) **is** an explicit saga (commit locally, grant remotely, soft-delete on failure) · [order_place.go:246](../backend/services/selling_service/selling_v1/order_place.go#L246) **is** an explicit compensation (`stock.Return`, with `picked` set BEFORE the call because *"a Pick whose result never reached us may well have committed"*) · and settlement's leg is **decided** ([the-order-commits-without-settlement](business/settlement/context_decision.md#the-order-commits-without-settlement)). ✅ **The PRE-COMMIT half is handled**: the pick runs INSIDE the order's transaction, so not enough stock rolls the order back and none exists. ⛔ **What is actually open is the POST-COMMIT half, and it is one gap at three sites** — the `OrderPlacedEvent` publish (liability never charges the order fee), `SettlementPost` (no account opens), and `catalog.Snapshots` (an unresolved owner rides as **0**, which liability reads as *nobody to pay*). All three end at *"logged loudly"*, and **nothing enumerates which orders are in that state**. 🆕 ⚠ And the event architecture now **assumes the publish succeeds** ([no-outbox-the-publish-is-trusted](technical/event_architecture/context_decision.md#no-outbox-the-publish-is-trusted)), so for the event leg the finder is the only detector there is. ⚠ The third is the worst: it logs no failure an operator would act on, so a transient catalogue blip becomes a fee never charged and never surfaced. 🆕 ⛔ **Re-examined against the code (2026-09-15): FIVE sites, not three, and the net is missing.** Cancel has the same gap twice — `OrderCancelled` unsent leaves a cancelled order's fees charged for good, and `CancelSale` failing leaves the account counting a dead sale · `OpenSale` is skipped **without a log line** when `marketplace_total = 0` · a crash between commit and send logs **nothing** · the catalogue failure that writes owner `0` also skips the owners' credit check · and **#187, the reconciliation report six code comments rely on to find all of this, has been open since 2026-07-21 with no RPC and no table**. ⚠ A fix that re-sends `OrderPlaced` with corrected owners is silently dropped — the event id is `order-placed:<id>`, so the event must be **held** until owners resolve. | ⛔ every order whose downstream row silently never appeared — fees uncharged, accounts unopened, cancelled orders still charged, with no list of them anywhere | [order: a-lost-publish-is-not-tracked-on-the-order](business/order/context_decision.md#a-lost-publish-is-not-tracked-on-the-order) (was Q14) — ➡ **re-routed there by the owner (2026-09-10)**, from architecture and settlement, neither of which can answer it | **A finder per leg** — a query listing committed orders with no downstream row. It needs no saga, no outbox and no new mechanism, and all three legs already assume it exists: [the-order-commits-without-settlement](business/settlement/context_decision.md#the-order-commits-without-settlement) flags *⛔ how a missing account is FOUND* as its own undecided half. ⚠ **And record the premise clash**: `architecture/context_clarify.md` says *"the amount is only known AFTER the draw, so the gate cannot run before it — step 7 is the whole design"*, while the shipped code runs the gate FIRST on a `UnitCosts` read and states the trade (*"the staleness that allows is exactly the overshoot the `debt < limit` rule already permits"*). `draw → gate → commit → release` describes an ordering the code deliberately inverted. |
| **2** | **Can the stored carry drift from its own definition without anything noticing?** 🆕 **Opened by the decision that closed the old #2.** [the-carry-materialises-the-day-boundary-position](business/settlement/context_decision.md#the-carry-materialises-the-day-boundary-position) reconciled the two balance decisions that looked like rivals: *"open balance is start balance of the day, close balance is end balance of the day"* is what the number **MEANS**, the stored carry is how it is **KEPT**, and the cascade is the bridge between them. ⛔ **That converts a definitional argument into a bug class.** Any path where the cascade does not run — a partial commit, a replay that skips a day, a genesis seeded wrong — leaves the stored copy unequal to its own definition, and **`close − open = change` still holds on every row**, so no invariant on the table detects it. ⚠ It was harmless while the columns were unread. With [a-past-date-position-is-a-real-screen](business/settlement/context_decision.md#a-past-date-position-is-a-real-screen) it is a wrong figure a person acts on. ⚠ **And a second reader-facing rule is unstated**: a day with no movement has **no row**, so a position query that does not fall back to the last row at or before the date returns "no data" for a day the shop plainly had a position. | ⛔ the correctness of every absolute figure on the one screen that reads them — silently, with the table's own invariant still satisfied | [analytic Q3](business/settlement/analytic_context_clarify.md#question) · [analytic Awaiting](business/settlement/analytic_context_clarify.md#awaiting) | **One reconcile RPC, checking a scope against the log it materialises**: `close_balance(D) = Σ change WHERE posted_on <= D`, same service, no HARD RULE 3 problem. On demand to start with rather than nightly — it is the only check the eager write path cannot perform on itself, and it is the same reconcile pass [mutation_and_ledger.md](technical/ledger/mutation_and_ledger.md) already promises elsewhere. **→ And state the gap-day fallback** (`WHERE day <= @as_of ORDER BY day DESC LIMIT 1`) in the doc rather than leaving it for whoever writes the screen. ⚠ **Also still open beside it**: does the past-date screen exist per **USER**? On `user_settlement_daily_reports` the same columns mean a person's lifetime running total of hidden cost, which only grows — so the newest CS always looks best. Recommend dropping the carry from the user table only, which also halves the cascade on the busier of the two tables. |
| **3** | **How is drift repaired when the LOG is already right and only the FOLD was lost?** 🔄 **Reshaped — the ledger-or-report half was ANSWERED in a day.** `context.md` made `system_adjustment` an eighth `settlement_type`, so it is a **ledger row**, shop-addressed, reaching the report through the broker — against my recommendation, and my report-column proposal is **withdrawn**. ✅ **That also unblocked #2**: with the adjustment in the log, the reconcile stays `close_balance(D) = Σ change` and needs no second term. ⛔ **What survives is the case the design cannot express.** The adjustment moves the log and the report **together, by the same amount** — so it repairs damage where BOTH were wrong, and cannot repair damage where only the report was. ⚠ **And “only the report” is what every known drift cause produces**: a dead-lettered event, a cascade that did not run, a genesis seeded wrong, a replay that skipped a day — in all four the log already holds the truth. Posting an adjustment there overstates the log by exactly the amount it corrects the report by, so the two end up disagreeing permanently and the reconcile reports a difference forever — which is how a check gets switched off. | ⛔ out-of-window report drift, which the replay cannot reach by decision and the adjustment cannot express — and, through the reconcile, the credibility of the only drift detector | [settlement context clarify](business/settlement/context_clarify.md#-system_adjustment-in-the-log-repairs-one-class-of-damage-and-cannot-repair-the-other) | **A targeted DAY RE-FOLD from the log** — re-read one scope's rows for one day and rewrite that day. It reaches **any** date because the log has no retention limit, it needs no adjustment row, and it leaves the ledger true. ⚠ **It is a second reader of the log**, which [the-replay-seeks-the-broker](business/settlement/context_decision.md#the-replay-seeks-the-broker) deliberately avoided — but that decision governed a RANGE replay through the webhook, and this is one day, on demand, for repair. Decide it on its own rather than inheriting that answer. ⚠ **Keep `system_adjustment` for what it is genuinely for**: a fact that was never recorded at all, where log and report are wrong together and move back together. |
| **4** | **Does the courier's TIP belong inside the frozen unit cost?** 🔄 **2026-09-30: my recommendation is reversed — IN, as a separate component.** `stock_thoni`'s proposal keeps it in its own `float` per-unit column, so the floor below is a code defect to fix, not a reason to move the money out; the product formula already says IN ([product Q6](business/product/context_clarify.md#question)). ⚠ **HALVED by re-examination, and the surviving half is verified in code.** This row used to merge a denominator defect and a numerator one. **(a) The denominator is already right** — [restock_request_fulfill.go:210](../backend/services/inventory_service/inventory_v1/restock_request_fulfill.go#L210) divides by `sellableTotal`, what actually arrived with damaged units excluded, and the line cost by `line.quantity`, the received one. The owner's flow diagram draws it the other way round, so [stock Q1](business/inventory/context_clarify.md#question) is a question about the DIAGRAM, not a live defect. **(b) The numerator stands** — `freight := rr.ShippingCost + costLineTotal`, under the comment *"EVERY OUTLAY IS FREIGHT"*, capitalises the incidental fee that `balance_context.md` defines as a courier's *"coffe tip"* into a cost frozen for the life of the batch. ⚠ **And it compounds with a decision taken this round**: a breakage reimbursement pays at COGS, so the warehouse is repaid a tip it charged, and [found-posts-without-a-handshake](business/balance/context_decision.md#found-posts-without-a-handshake) lets it reverse that reimbursement unilaterally. | every batch's frozen unit cost — and therefore COGS, margin, the cross-charge (COGS × markup) and breakage payouts, for the life of the batch | [product Q6](business/product/context_clarify.md#question) · [stock Q1](business/inventory/context_clarify.md#question) | **Take the tip OUT, leave `ShipmentFee` in** — freight is agreed before the journey and is genuinely part of what the goods cost; an unpredictable ask at the door is not. One line — `freight := rr.ShippingCost` — with `costLineTotal` still posting to the balance. ⚠ Note `freightPerUnit` is integer division and **floors**, so a small tip contributes **0 per unit** while being charged in full on the balance: it is already unreliable at exactly the sizes it is described as being. |
| **5** | **🆕 Which markup does the LEDGER charge from?** ⛔ **A live billing discrepancy, found while acting on an owner decision.** The cross-product markup is stored TWICE and nothing keeps the copies equal: `products.cross_markup_bps` is what the product detail QUOTES a borrowing team, and `liability_terms.product_markup_bp` is what [`order_fees.go:144`](../backend/services/liability_service/liability_v1/order_fees.go) actually CHARGES it. Set one to 20% and leave the other at 5% and the quote and the invoice disagree — in whichever direction was edited last, silently, with neither screen able to see the other. ✅ The OWNERSHIP is settled: the rate is `product_service`'s ([the-cross-markup-belongs-to-the-product](business/balance/context_decision.md#the-cross-markup-belongs-to-the-product)), and the balance screens no longer show it. What is open is only which number the posting reads. | every cross-sold order's fee — the amount a team is quoted versus the amount it is billed | [technical balance Q10](technical/balance/team_balance_design_clarify.md#question) · [Contradiction](business/balance/context_clarify.md#two-markups-exist-and-the-screen-and-the-ledger-read-different-ones) | **`order_fees.go` reads the PRODUCT's rate when it freezes the fee, and `liability_terms.product_markup_bp` is dropped in the same migration.** Balance is then told the amount rather than asked to compute the rate — already true of every other cause. ⚠ **Three things land together or the fee breaks**: the read moves, the column goes, and the frontend's pass-through bridge is deleted. |
| **6** | **🆕 Where does a returned parcel land — and does an OWN product go through the cross-product map?** The owner added `## Order Return Flow.` and a second table (`product_return_maps`) to [order_return.md](business/order/order_return.md) on 2026-09-21. ✅ **The diagram parses.** ⛔ **Checked against the build before ranking** (the rule this file learned the hard way), and the configuration it asks for **already ships**: `team_return_configurations` is [`team_infos.return_warehouse_id`](../backend/services/team_service/db_migrations/00001_create_teams.sql) in `team_service`, sitting beside its outbound twin `default_warehouse_id` — **written by no screen and read by no server**, the third instance of the stored-but-unread pattern after `warehouse_infos`' open/close grids and `products.reserved_stock`. ⛔ **And the twin argues the opposite philosophy in its own migration** — *"It is a DEFAULT, not a rule… a fallback applied server-side would quietly undo that refusal"* — while the doc gates order create on a CONFIG ROW. ⛔ **The flow's own-product branch is a live defect**: `is cross --> no --> Set Team Return Configuration --> Get Product Map` sends a product the team already owns to look for a map it can never have, missing, and continuing into `Clone Product` — **a team duplicating its own catalogue once per return**, against [context.md](business/order/context.md)'s own return diagram, which goes straight to `Create Return` ([Contradiction](business/order/order_return_clarify.md#the-own-line-goes-through-the-cross-product-machinery)). ⛔ The map's uniqueness names **`to_product_id`, which is not a column**, and the pair-unique it describes allows two clones of one borrowed product. ⛔ A clone **cannot reuse the lender's code** now that it is composed and globally unique ([the-code-is-composed-from-the-team-code](business/product/context_decision.md#the-code-is-composed-from-the-team-code)), and there is no clone RPC anywhere. ⛔ **No line carries a returned quantity** — a buyer returning 1 of 3 puts back 3. | ⛔ **order create itself** — the gate as written refuses every team, since every `return_warehouse_id` is NULL and no screen sets one · the whole return context, which cannot be built from a flow that clones own products · a duplicate table in a second service | [order_return Q1–Q9](business/order/order_return_clarify.md#question) · [the corrected flow](business/order/order_return_clarify.md#the-return-flow-corrected) · [the map as I would write it](business/order/order_return_clarify.md#the-map-as-i-would-write-it) | **No new table** — keep `team_infos.return_warehouse_id`, add a per-**shop** override in `selling_service` (the platform prints the return address per shop, and the courier follows the label), resolve shop → team on the order form as `default_warehouse_id` is resolved today, and **freeze it on the order** (`orders.return_warehouse_id`) for the reason [00005_order_warehouse.sql](../backend/services/selling_service/db_migrations/00005_order_warehouse.sql) already gives: *"what an order says happened must stay what happened"*. **Gate the REQUEST, not the config row.** The own line joins the payload directly, the map is unique on `(team_id, shared_product_id)`, and `warehouse_id` comes out of it — a catalogue map is not a location fact. Build the editor and backfill **before** the gate: two commits, never one. |
| **7** | **🔄 Can the warehouse's ORDER FEE be written as a contract — now that who owns it is decided?** ✅ **The ownership fork closed the day it opened**: `context.md` §Responsbility 2 — *"warehouse service just give rpc for calculate. how the fee handle and recorded is responsbility of balance and called by order"* — recorded as [warehouse-prices-balance-records](business/warehouse/context_decision.md#warehouse-prices-balance-records). The rate lives where the calculation lives, **balance is told the amount** rather than deriving it, and the number is fixed when the order calls. ✅ It also ratifies the shape of the payload the owner added the same day: `WarehouseFeeCalculate` takes a **basis** (`order_total`), not an `order_id`, and echoes the rate it used. ⛔ **What is left is everything that makes it buildable, and one of them is a live rate.** `liability_terms.handling_fee` **stores a flat per-pair rate and computes from it today** ([`order_fees.go`](../backend/services/liability_service/liability_v1/order_fees.go)) — the decision makes every computing site stale, but nothing says the column is dropped, and leaving it is how a system ends up with **two rates by accident** (⚠ that is **#5 on this page, happening a second time**). ⚠ It also still blocks [technical/balance Q8](technical/balance/team_balance_design_clarify.md#question), which would rename a column that is being deleted. ⛔ **And the payload's types are wrong against the whole system**: every money field is a **`double`** where **no proto in this repo contains a float at all** — money is `int64` whole rupiah, written down as a rule in `expense.proto` ([Contradiction](business/warehouse/context_clarify.md#money-is-a-double-here-and-an-integer-everywhere-else)) · the request names **no selling team**, which drops the per-pair rate balance already charges **and** leaves the message with no `use_scope` field for the access interceptor · `order_total` does not say **which** total (`orders.total` includes shipping, and `subtotal`, `cogs` and `marketplace_total` are three other candidates, the last being `0` on a phone order) · and it prices **one** warehouse per call while echoing `warehouse_id` like a batch. ⚠ **Unrelated to the fee and still true**: `warehouse_infos.receiving_hours` — the open/close grid — has a table, a proto, an editor and a test, and **no caller**, so an order can be placed into a warehouse that is shut. | ⛔ the proto — it cannot be written until the money type, the basis and the scope field are settled, and `buf breaking` in CI makes each of those free this week and a wire break after · the disposal of a rate that is charging money now · the `handling_fee` → `order_fee` rename waiting on it | [warehouse: is-the-old-flat-rate-column-dropped](business/warehouse/context_clarify.md#is-the-old-flat-rate-column-dropped) · [is-the-money-an-integer-rupiah](business/warehouse/context_clarify.md#is-the-money-an-integer-rupiah) · [does-the-request-name-the-selling-team](business/warehouse/context_clarify.md#does-the-request-name-the-selling-team) · [does-order-total-include-shipping](business/warehouse/context_clarify.md#does-order-total-include-shipping) | **Drop `handling_fee` in the same change that adds the warehouse's terms**, and write the payload as `int64` rupiah with `fee_bp` basis points, a `team_id` serving as both the pair key and the scope, a `configured` bool (since `calculated_warehouse_fee = 0` otherwise means both *charges nothing* and *no rate set*), a `min_fee` the doc has no field for, and `repeated` items so the order form can price three candidate warehouses in one call. **The move is five deployable steps and no day charges differently** — [here](business/warehouse/context_clarify.md#the-rate-moves-in-five-steps-and-no-day-charges-differently) — because step 2 backfills each existing flat fee as `fee_bp = 0, min_fee = max_fee = <the flat fee>`, a degenerate percent that reproduces today's charge exactly. ⚠ **Four capabilities must travel with the rate or the move is a regression**: the pair grain and its default row, the actor + required `reason` on every edit, the history RPC, and *nothing configured = charge nothing*. All four are built in balance today and none is in the doc's field list. |

**⤵ Demoted this round:** **is the analytic PATTERN robust — and do its 14 rules hold?** Pushed off by the new
warehouse row, strictly on the ranking rule: its own Blocks column read *⏸ nothing is blocked today — the
deferral was deliberate* ([the-pattern-comes-before-its-consumers](business/analytic/context_decision.md#the-pattern-comes-before-its-consumers)),
while #7 blocks a service nobody can start. **Nothing about it changed and nothing closed** — the contract is
still 14 rules with three already failing (`ExpenseUpdate` rewrites in place, the immutable bucket date, and no
source anywhere has a cursor-paged `LogRead`), the *pattern* still names a `supplier` table, and the structural
question — **is `analytic` a LIBRARY or a SERVICE?** — is still open, with the recommendation unchanged: a report
reading ONE service's log is that service's own, folded in-process with a shared library; a report reading
SEVERAL needs an owner ([analytic Q1–Q3](business/analytic/context_clarify.md#question)).

**⤵ Demoted, unanswered:** **which PRE-CHECKS does a draft run?** — promoted to #7 last round, pushed
off again by #3, and unchanged throughout. The ledger half is settled at finalize; what a *draft* checks
is not ([order: a-draft-runs-no-pre-checks](business/order/context_clarify.md#a-draft-runs-no-pre-checks), was Q4). Recommendation stands: **none of it at
draft** — a draft holds an external SKU, so it has no product, no owner and no cost, and none of the four
are computable. The price: **finalize must re-check and may refuse.** ·
**can one ORDER's true result be read anywhere?** Marketplace money is
settlement's at order grain, the `order_fee` is balance's at pair grain, and `LiabilityLogListFilter`
takes `counterparty_id` and nothing else — so *"what did order 1 make"* has no reader
([balance Q9](business/balance/context_clarify.md#question)). Recommendation stands: **one `order_id`
filter**, never a second copy of the fee.

**⤵ Demoted this round — and its blocker is GONE:** **how does the decided `Event` get PUBLISHED at all?** Its
Blocks column read *"it cannot be written today in any package"*, and that is **stale**:
[backend/pkgs/event_source/](../backend/pkgs/event_source/) ships `sender.go`, `push.go`, `replay.go` and
`setup.go`, settlement injects a real `EventSender` ([service.go:50](../backend/services/settlement_service/settlement_v1/service.go#L50))
and **publishes** ([post_entry.go:483](../backend/services/settlement_service/settlement_v1/post_entry.go#L483)),
and `san pubsub ensure` provisions the topics. `event_architecture` has had **no open questions** for two rounds —
what survives there is a **contradiction**, not a question, and contradictions do not rank here. ⚠ **This is the
exact failure this file warns about in its own header** — a row ranked from the clarify files alone, never
re-opened against the code, for two rounds after the thing it blocked had shipped. Third occurrence of that
pattern, and the reason the return row above was checked against `team_service` before it was written.

**⤵ Off the display, unchanged:** **where does a platform WITHDRAWAL live?** Wallet to bank, naming no
order — so it is none of settlement's seven types, and
[superseded-every-entry-names-an-order](business/settlement/context_decision.md#superseded-every-entry-names-an-order) made
`order_id NOT NULL`, which forbids the obvious workaround. Asked in two docs
([architecture Q7](technical/architecture/context_clarify.md#question) ·
[settlement Q3](business/settlement/context_clarify.md#question)). **→ Answer it once, in the
architecture clarify, and have settlement follow — `order_service`**, because the wallet is fed by that
shop's orders and the withdrawal is reconciled against them. ⚠ Its premise has since moved: `order_id` is
nullable now (recorded under *Before this round*), so the NOT NULL no longer forbids a settlement home —
the question is which home, not whether one exists.

## Where the other 149 are

⚠ **This table is every file's FULL open count, not the residue** — the seven above are rolled up
*from* these files, so the column sums to **156**, the whole set, not to 149 (2026-10-03 14:42: unchanged. 14:39: stock_thoni 12, its restock flow 0 — the photo answered. 14:33: stock_thoni 12, its restock flow 1 — a critique narrowed into a question. 14:20: stock_thoni 12, its restock flow 0 — the last one answered. 14:09: stock_thoni 12, its restock flow 1 — one answered. 14:05: unchanged. 13:54: stock_thoni 12, its restock flow 2 — one new. 13:42: unchanged — stock_thoni 12, its restock flow 1, the one parked item answered. 12:25: stock_thoni 12, its restock flow 1 — two more answered. 12:01: stock_thoni 13, its restock flow 2 — one answered, one parked at the owner's request, one new. 2026-10-02: 144 + stock_thoni's 12 + its restock flow's 4 — the case files were deleted and their 3 questions moved to the flow,
whose row had been missing). Previous rounds left
that ambiguous and the sums never reconciled with the header: two rounds ago it said 116 above and
113 here while the rows added to 119, and last round it said 133 here against a header of 137. Both
are recounted mechanically now — 137 across the pre-existing 23 files, plus excel_readers' 7.

⚠ **Two rows were wrong, in opposite directions, and both are fixed this round.**
`business/stock_thoni/` had never been listed at all, and `business/product/systems_clarify.md` (**1**)
was listed for a file that does not exist. The stock proposal was then rewritten in Indonesian, its
English version deleted, and then answered — so it contributes **7**, not the 8 its old clarify held:
134 − 1 + 7 = **140**.

| File | Open | |
| --- | ---: | --- |
| [business/teams/warehouse/context_clarify.md](business/teams/warehouse/context_clarify.md#question) | 14 | 🆕 **a new context, first pass** — three of its four asks are already built elsewhere: the location + both weekly grids are `team_service.warehouse_infos` (and the grids have **no reader**), the fee is `liability_terms.handling_fee`, **flat** and live. ▲ **+3 the same day**, from the `WarehouseFeeCalculate` payload the owner then added: money as `double` · no selling team in the request · one warehouse per call. See **#7** |
| [business/order/context_clarify.md](business/order/context_clarify.md#question) | 9 | ▼ **−1 (2026-09-21)** what `return` means — it is a CLAIM, and the owner added a ninth status `return_completed` for the receipt · ▼ −1 the half-finished order is NOT tracked (owner, 2026-09-17) · ▼ −6 pruned 2026-09-17, overtaken by the day's decisions (draft pre-checks, SKU mapping, review reject, the synchronous take, the cross line's cost, what placement means) · ▲ +1 re-routed from shipment: an order cannot be created without a channel. ▲ was 14 — rewritten after the owner's 2026-09-15 edits: six decisions recorded, −2 closed, +4 opened. ⚠ **Counted as `###` headings now** — its questions are named, not numbered |
| [business/order/order_creation_clarify.md](business/order/order_creation_clarify.md#question) | 1 | ▼ was 5 — four answered 2026-09-17: a take reduces stock and placement (its shelf half re-routed to inventory Q11) · rupiah is `double` · the take is never retried · inventory computes the markup. Left: which team `team_id` is |
| [business/order/order_return_clarify.md](business/order/order_return_clarify.md#question) | 9 | ▲ **+13 (2026-09-21)**, ▼ **−10 decided the same day** — incl. ✅ the own-line branch FIXED in two passes (the first left a junk map write that read as a fix) and ✅ a ninth status `return_completed`, which superseded the eight-status decision (the map’s key · written once · never partial · a return may land in another warehouse · **the return warehouse is per TEAM** · **it is read when the return happens, not frozen on the order** — the last two both reversed my recommendations, and together they mean the whole configuration is a column that already ships and the order carries nothing about returns). ✅ **The whole return-warehouse cluster is now CLOSED** — five decisions, three of which reversed my recommendation, and what is left to build is an **editor** and a **reader** for a column that already ships. ⛔ The open successor is **who creates the return** — CS from an office or the receiving warehouse — which decides the screen and decided the last argument — incl. ⛔ **the return warehouse is a SECOND warehouse**: stock is keyed `(warehouse_id, product_id)`, so a unit taken from the fulfilling warehouse returns onto a DIFFERENT pile, and nothing moves it back, ▼ **−3 decided the same day** — the map’s key and its stale `to_product_id` · a map is written once · **a return is never partial** (which reversed my own recommendation and made the owner’s qty-less flow correct as drawn). ▲ +1 successor: a short-delivered parcel is now neither a return nor completed. — the owner added `## Order Return Flow.` and a second table, `product_return_maps`. ✅ Its diagram **parses**. ⛔ The own-product branch routes through the cross-product map and ends in `Clone Product`, so a team **duplicates its own catalogue** on every return · the map's uniqueness names `to_product_id`, **not a column** · the warehouse is read twice, two ways, in one picture · a clone needs a `product_code` nobody generates now that the code is composed · no line carries a returned **quantity**. ⛔ **And `team_return_configurations` already exists as `team_infos.return_warehouse_id`** in another service, unread and with no editor. **See #6** |
| [business/shipment/context_clarify.md](business/shipment/context_clarify.md#question) | 0 | ▼ was 3 at the start of 2026-09-16 — ✅ every question closed: −10 decided (identity · soft delete · root-only · courier grain · deleted resolves by id · the app maps courier text · restore not recreate · handover deferred · the list needs no login · ByIDs public too), tracking parked, unknown-courier re-routed to order. Then the three critique rows accepted (immutable `code` · seed the three · `updated_at`) — the context is fully decided |
| [technical/architecture/context_clarify.md](technical/architecture/context_clarify.md#question) | 11 | ⚠ **counted 10 here last round and 11 mechanically** — the row said "count unchanged" while one had been added. 🔄 2026-09-17: re-examined against the built shipment context — every `shipping_service` proposal rewritten, Q8 (region) reworded to *does region_service stay separate*, +1 Contradiction: its line 13 still describes the old shipping service. Count unchanged. ▼ was 11 — Q2 became a pointer to order's half-finished-orders question. What stayed is a contradiction, not a question |
| [business/balance/context_clarify.md](business/balance/context_clarify.md#question) | 8 | ▼ was 9 — `found` needs no handshake |
| [business/inventory/context_clarify.md](business/inventory/context_clarify.md#question) | 11 | ▲ +1 re-routed from order_creation: a stock count between create and pick re-adds a taken unit · ▲ was 7 — `stock/` merged into `inventory/` ([stock-merges-into-inventory](business/inventory/context_decision.md#stock-merges-into-inventory)) · +3: purchasing boundary, what inventory does NOT own, Toni's proposal |
| [business/ledger/context_clarify.md](business/ledger/context_clarify.md#question) | 7 | |
| [technical/balance/team_balance_design_clarify.md](technical/balance/team_balance_design_clarify.md#question) | 6 | ▲ which markup does the ledger charge from |
| [business/product/context_clarify.md](business/product/context_clarify.md#question) | 12 | +6 |
| [business/business_level_clarify.md](business/business_level_clarify.md#question) | 6 | |
| [business/user/context_clarify.md](business/user/context_clarify.md#question) | 5 | |
| [business/analytic/context_clarify.md](business/analytic/context_clarify.md#question) | 8 | ▲ the `### Why` section landed — it argues the pattern's case but names the wrong coupling, and it opens a structural one: is `analytic` a LIBRARY or a SERVICE |
| [technical/stock/design_clarify.md](technical/stock/design_clarify.md#question) | 4 | 🆕 counted for the first time |
| [business/stock_thoni/context_clarify.md](business/stock_thoni/context_clarify.md#question) | 12 | ▼▲ 0 at 2026-10-03 14:09 — the flow checks `ongoing` again, so the database guard is a backup once more. ▼▲ 0 at 2026-10-03 13:54 — the flow's lock step is now deleted, so the database guard stays the only one. ▼▲ 0 at 2026-10-03 13:42 — with the flow's lock step commented out, the `UNIQUE (tx_id) WHERE status IN (approved, cancelled)` guard is the ONLY guard against a double receipt again, not a backup. ▼▲ 0 at 2026-10-03 12:45 — the per-column `"unique"` markers are gone and statement rows are written in `sku_id` order (recorded), which closes both statement critiques. ▼▲ 0 at 2026-10-03 12:36 — the ERD note now reads `UNIQUE (sku_id, warehouse_id)` and the `lock insert` sentence is gone: the queueing is done by the unique key itself, per pair, as recommended (notes added to both decisions). Left as critiques: the per-column `"unique"` markers in the ERD box, and writing statement rows in `sku_id` order so two restocks holding the same SKUs in opposite order cannot deadlock. ▼ −1 at 2026-10-03 12:25 — `team_id` left `SKU_STATEMENT` and the key is `(sku_id, warehouse_id)` again (recorded; dropping the column differs from my recommendation and is accepted — a team's stock is read through its SKU list). A new line says two writes to one statement row queue, the second waiting for the first (recorded). Two critiques, no new question: `lock insert` locking the whole table would queue every warehouse behind every other, and a row lock cannot lock a row that does not exist yet — UNIQUE plus one upsert gives exactly the owner's sentence, per pair · and two restocks holding kaos and celana in opposite order deadlock — recommend writing statement rows in `sku_id` order. ▲ +1 at 2026-10-03 12:01 — the ERD note now keys `SKU_STATEMENT` on `sku_id`, `team_id` and `warehouse_id`, "create if the combination is missing, add if it exists" (create-or-add recorded). But a SKU has exactly one team, so the third column adds nothing while data is right — and while the SKU's team still comes from the request, a wrong team silently makes a SECOND row for one SKU in one warehouse. Recommend the unique key stays `(sku_id, warehouse_id)`, with a plain index on `team_id` if teams search by it. It is also still a "composite index", not UNIQUE, which `ON CONFLICT` needs. ▼ −1 at 15:34–15:50 — the flow's formula divides shipping by every unit SENT, which answers the landed-cost question (recorded); broken and lost prices lost their silent `default 0` (recorded). ▼▲ 0 at 15:27 — `supplier_id` now rides with broken and lost units (recorded); their prices still default to 0. ⏸ −4 at 15:17 — the owner took `ADJUSTMENTS` out of the ERD to rethink it, so the four adjustment questions are parked, not counted. Broken and lost split back into two tables (recorded, reversing the one-table decision); the split dropped `supplier_id` from both and gave their prices a silent `default 0`. ▼▲ 0 at 14:36 — the anomaly rack is optional again, so ERD and flow agree and the rack contradiction closes. ▼ −1 at 2026-10-02 14:29 — the flow now sends broken and lost units in the receipt (recorded), closing the three-numbers question; but the flow sends no rack for them while the ERD requires one, so a receipt with any broken or lost unit cannot be saved. ▼ −1 at 2026-10-01 12:45 — the owning team is sent again and now STORED in `TRANSACTIONS.team_id` (recorded, reversing 18:04), so the team question closes; what is left of it — a SKU owned by another team must be refused at creation — moved to the first case's file as a critique. ▼▲ 0 at 2026-10-01 10:32 — the ERD marked `warehouse_id` "unique" too: read as a PAIR, recorded, and the one-column contradiction closes; but two per-column markers read to a migration author as two separate rules (one statement row per warehouse), so the open point is now how it is written — `UNIQUE (sku_id, warehouse_id)` in the note under the ERD. An adjustment may now carry zero anomaly rows (recorded); the left end of that line still contradicts the owner's own `adjustment_id "nullable"`. ▼▲ 0 at 17:49–18:04 — `cancelled` is final (recorded; two parked cancel items answered by the owner, two still parked). The ERD marked `SKU_STATEMENT.sku_id` "unique" — a step toward UNIQUE, but on one column: a SKU could never have a statement in a second warehouse (new contradiction; recommend `UNIQUE (sku_id, warehouse_id)` in the note under the ERD). One adjustment may now carry several broken/lost rows (recorded), with the line still drawn to the old tables and too strict on both ends. The case now takes the creator from the login token (recorded) and DROPS `team_id` — reversing 17:34, against my recommendation: one person may hold roles in several teams, and this system reads the team from the request body. ▼ −1 at 17:44 — a `cancel` status now exists and a received transaction cannot be cancelled (recorded), which closes the status question and the cancel contradiction. ⏸ The rest of cancel — is it final, how on-the-way falls, who may cancel — is PARKED at the owner's request until the cancel case is written; listed at the top of Question, not counted. ▼▲ 0 at 17:27–17:34 — context.md now states the status rule: `ongoing` then `approved`, each once, `approved` final (recorded — the double-receipt hazard answered as a RULE; the database still has to hold it, `UNIQUE (tx_id, status)`). The status question narrows to cancel, and a new contradiction: the same doc lists a *Restock cancelled* case while its rule has no cancelled status. The CS now sends one `team_id` per restock (recorded), so the one-team question narrows to its column and rejecting other teams' SKUs. ▲ +1 at 17:00–17:20 — the message to billing now lists its fields (recorded), which exposes that its `team_id` — who reimburses — has no column: `TRANSACTIONS` stores the CS person, not a team, and a restock mixing two teams' SKUs would give one courier fee two owners (+1: one restock, one owning team, stored at creation). The announce question narrows to broken, lost and found. ▼▲ 0 at 16:52 — *"it only records bills; billing is another service's"* confirms my reading (the courier's charge is recorded, no debt between teams), so the announce question keeps two parts: what the message carries, and the same message for broken, lost and found. ▼▲ 0 at 16:34–16:46 — the case now tells the billing service when a receipt carries extra shipping (recorded), so the announce question narrows to what the message carries, the same message for broken, lost and found, and one ambiguous word: *"it only records bills"* — read as recording the courier's charge, not a debt between teams. ▲ +1 at 16:33 — context.md now bounds the service: it *"handles no bills at all"* (recorded — it matches balance, which already owns the incidental fee, broken, lost and found). +1: balance still has to LEARN of each fact, and may not read inventory's tables — recommend inventory announces an event per money fact. New contradiction: the courier's ask at the door has three names in three docs (`additional_shipping_fee`, balance's decided `incidental_fee`, product's `AdditionalWarehouseFee`) — recommend `incidental_fee`. And my product Q6 recommendation (take it out of unit cost) is withdrawn. ▼▲ 0 at 15:41 — the case now writes "no extra shipping" as 0, not empty (decided, as recommended), so the three-column question narrows to the ERD: `NOT NULL DEFAULT 0` and one generated sum. ▲ +1 at 14:38–15:30 — `SKU` left the inventory ERD (decided, as recommended — which also removed the wrong one-statement-per-SKU line); the item now stores supplier and the line's purchase TOTAL, and the per-unit price and shipping are computed at receipt (both decided). Shipping splits EVENLY across all units (decided, against my by-value recommendation — the cost is recorded: in a mixed-price parcel a 500 item carries 40% shipping). The shipping-split question narrows to units sent vs arrived. +1: a unit's value now lives in THREE slot columns and the case leaves the third "empty" — NULL makes the sum NULL; recommend all three `NOT NULL DEFAULT 0` plus a generated `unit_cost`. Contradiction: the stale-text entry closed (supplier and price are now stored at creation). ▼ −1 at 14:15 — the shipping-per-unit column renamed `unit_shipping_cost` and no longer nullable (decided, as recommended), so `unit_cost` keeps one meaning across the system: the whole cost of the goods, as in the order. ▲ +1 at 2026-09-30 14:02 — the ERD added `unit_cost` beside `unit_price` on the item, slot and anomaly rows, and the case fills it with 1.000 = shipping 10.000 ÷ 10 units: shipping per unit kept in its own column (recorded — it beats my one-column *landed* price, because supplier prices stay comparable). But in the order `unit_cost` is the WHOLE cost of the goods, so a take that hands the slot's `unit_cost` to the order would book COGS at 1.000 instead of 11.000 — and the name was my own earlier suggestion, meant as price plus shipping. +1 (rename it `unit_shipping_cost`, `NOT NULL DEFAULT 0` — `10.000 + NULL` is NULL) · the landed-price question narrows to how shipping splits across several SKUs in one parcel (recommend by value — split per unit, a 500 item gets 40% dearer). ▼ −1 on 2026-09-30 13:29 — the statement is now one row per SKU **per warehouse** (decided, as recommended; it supersedes the per-SKU decision, so it carries a new name), with a "composite index" that still has to be UNIQUE. ▼▲ 0 on 2026-09-30 13:15 — `ADJUSTMENT` renamed `ADJUSTMENTS`, and the ERD began STORING on-the-way in the statement: recorded as a decision that half-reverses `ongoing-dihitung-dari-status` (the old definition survives as what the stored number is reconciled against); its questions live in the case's clarify. ▼ net −1 at 15:24–15:53 — the owner switched to worked CASES (a restock traced from request to rows), and one case exposed what the ERD hid (see the next row). −1 decided (SKU = product — so `reserved_stock` and the shared lock have a source, and OrderCreation is 7 of 10) · also recorded: broken and lost merged into one `SKU_ANOMALY_SLOT`, and a received restock is `approved` — the word an older decision said adds NO stock, now the moment that does · −1 re-routed to the case's own clarify (price on the item) · +1 (is a slot's `count` frozen at arrival, or the remainder a FIFO take can lock?). Contradictions: +2 (a lost unit now lives in a table with a `rack_id` — recommend a CHECK · `approved` flipped meaning), −1 (the cross markup under two names, gone with SKU = product). ▲ net +1 at 13:52: the owner answered *historical or statement* with `SKU_STATEMENT`, one summary row per SKU (recorded) — ⛔ but it has **no warehouse**, while a SKU lives in several (a restock picks its target, a return may land elsewhere) and the take asks *enough in THIS warehouse?*; and it is a second current number, not a history — a stock-card test reproduces 2 of 5 events. The statement is kept and promoted: keyed per warehouse and locked first, it becomes the take's one-row gate. −1 decided (four adjustment types — `opname`, `broken`, `lost`, `found`; `move` dropped) +2 (statement per warehouse · how a rack move is recorded). `ready_stock` was renamed `good_stock` while the statement says `stock_ready` — folded into the good-vs-ready question, now recommending both numbers per slot in the owner's own words; it also left a recorded decision quoting a dropped column (a new contradiction). ▼▲ net 0: asked *historical or statement* for stock counts — recommended BOTH in one DB transaction (a lockable current number with `CHECK >= 0`, plus a log row carrying `after_balance`, like a bank statement), because a `SUM` over history cannot be locked and two CS selling the last unit in the same second would both succeed. The broken-and-lost question folded into it. ▲ +2: the owner asked which adjustment types — five recommended (`opname`, `broken_good`, `lost_good`, `found`, `move`), the money words reused from balance · and a gap it exposed: an owner pulling goods out of the warehouse has no path except an order, so it would read as `lost_good` — warehouse money. ▼ net −1 at 13:20: −2 decided (who bears is read from `adjustment_id` · lost units get `SKU_LOST_SLOT`, with no rack — the owner kept the name, and the missing rack answers why I wanted it changed) +1 (are `broken_stock` and `lost_stock` current counts or frozen facts). ⚠ The three stock tables are complete and **nothing records a move between them** — take, a breakage and a found unit all fall into the same hole, which one `SLOT_LOGS` closes. ▲ +1 at 13:12: `SKU_BROKEN_SLOT` filled in (decided, as recommended), but broken-at-receipt (the owner pays) and broken-on-the-shelf (the warehouse pays) now look identical — recommend a nullable `adjustment_id`. ▼▲ net 0 at 13:06 — a new ERD: −1 decided (broken gets its own table, the owner's idea over my `kondisi` column) +1 (lost is not in the model at all — dropped, or not drawn yet?) · also decided: a transaction is born with an item and a status row, and a SKU must have an image. ▼▲ net +1: `ADJUSTMENT` got its own table and `TRANSACTIONS` stayed whole (decided, as recommended) · the owner asked how a lost unit FOUND during opname works — +3 (the shape of an adjustment, which open loss a found unit closes, a surplus with no loss to close) −2 (the split, and the reshaped adjustment question). ⚠ It corrected a claim of mine: a found unit goes to the rack where it was FOUND, not back to its source slot. ▲ +2: the owner plans to split `TRANSACTIONS` into restocks, returns and adjustments — adjustments yes, restock and return no (one door for the warehouse, one slot origin, no UNION for the incoming queue), which would reverse `transaksi-adalah-barang-masuk`. ▲ +1: where do lost and broken live — 🔄 the owner proposed separate tables and it beat my `kondisi` column (a stock reader that forgets a filter can no longer sell broken goods): `SKU_BROKEN_SLOT` agreed, the lost one renamed `SKU_LOSSES` because it has no rack. ▲ +2 net, 2026-09-29 — the owner asked how receiving can be PARTIAL: +3 (three counts per line, one parcel per transaction, surplus in the parcel) · −1 decided (`ref_order_id` names the returned order). ▲ +1 2026-09-29, later: `order_id` is the restock's purchase number, so a return names no order — which order was returned? ▼▲ 2026-09-29: −1 decided (on-the-way is counted, not stored) · +1 the status list vanished with the column (and never had a cancel) · a take is not a `TRANSACTIONS` row, so *where is it recorded* replaces *is it a transaction*. ▼▲ ERD revised the same afternoon: −3 decided (slot born on arrival · owner is the team · the cross price is a percent) · +3 successors (price entered at restock creation · landed or purchase price · on-the-way counted, not stored). ▲ +2 the same day, from the owner's ERD (`model.md`): is SKU the product · is a take a transaction. ✅ `SKU_SLOT` reversed my batch-plus-placement recommendation. 🆕 **row added 2026-09-28 — it had been claimed but never listed.** Rewritten after the doc was reshaped to connect to OrderCreation: the outbound take section is **empty**, the SKU carries a stored second price (a third source for the cross markup — see #5), `stock_ongoing` is a counter every path must compensate, and the business restock record disagrees with the author's own `batches` in technical/stock. Three old questions fell with the deleted text (status mix, adjustment vocabulary, `approved`/`completed`) |
| [business/stock_thoni/restock_flow_clarify.md](business/stock_thoni/restock_flow_clarify.md#question) | 0 | ▼▲ 0 at 2026-10-03 14:42 — `stock_ongoing` is now added once, in the recording step, and the stale photo name is gone. The restock flow has no question, no contradiction and one cosmetic critique (rejected paths not drawn). ▼ −1 at 2026-10-03 14:39 — the courier-receipt photo is a link, like the broken-goods photo (recorded); creation names its `TRANSACTIONS` lock "rows with the same resi"; statement numbers are written for all three steps. Two small leftovers: the creation step now adds `stock_ongoing` in two places (lines 70 and 82), which read step by step doubles it — and line 153 still names the photo by its old field name. ▲ +1 at 2026-10-03 14:33 — closing critiques one by one: the cost formulas now divide by the transaction's items, and the extra fee is `double value` (recorded). The naming critique narrows to one question for the owner — is the courier-receipt photo sent as a file or a link (recommend a link, like the broken-goods photo). New critique: creation now locks "the `TRANSACTIONS` row" again without saying which — harmless if it means rows with the same resi, a whole-table lock if read literally. ▼▲ 0 at 2026-10-03 14:27 — the stray `TRANSACTIONS` lock and the second resi check left the creation steps, as recommended. Five small critiques remain; no question, no contradiction. ▼ −1 at 2026-10-03 14:20 — creation now locks the statement rows before checking the resi, so a double Save queues and the second is refused (recorded); a resi is never shared between couriers, so the resi alone identifies a parcel (recorded, differing from my per-courier recommendation and accepted). Cancellation has its own DB transaction box. No open question left in the restock flow. One new critique: the creation steps also say "lock the `TRANSACTIONS` row" for a row that does not exist yet — it locks nothing, and read literally it invites a whole-table lock that would queue every warehouse. ▼▲ 0 at 2026-10-03 14:17 — the owner asked why the resi question is still open: explained with the double-Save race (two restocks for one parcel, 10 units on the way forever). My recommendation changed — the owner's own pattern (lock the statement rows, then check the resi) closes it without a second status column; the database `UNIQUE` is now option B. Still asked: is a resi unique per courier. ▼ −1 at 2026-10-03 14:09 — receipt and cancellation both now lock the statement rows and refuse unless the restock is still `ongoing` (recorded, superseding the transaction-row lock), which answers the `ongoing` question and closes the contradiction. The restock flow has no blocker left; the owner moves on to returns. Left: the resi guarded by the database, and six non-blocking critiques. ▼▲ 0 at 2026-10-03 14:05 — receipt now locks the `SKU_STATEMENT` rows first (recorded — my older statement-first recommendation), so two receipts of one restock queue. The `ongoing` question narrows to half a sentence: after the lock, nothing yet asks whether the restock is still `ongoing`, so the second receipt queues and then writes anyway — and cancellation neither locks nor asks. That is the only blocker before the owner moves on to returns; the other critiques do not block. ▲ +1 at 2026-10-03 13:54 — the staff check and the billing message are now their own steps, outside the DB transaction box (recorded), closing that critique. But the lock-and-recheck-`ongoing` step is now DELETED, not just commented, so no server step checks `ongoing` at all — asked directly (+1): if it went because the box covers it, it does not; if because a row lock is too technical for a business doc, agreed for the LOCK, but the RULE "refuse unless still `ongoing`" belongs in the flow. Cancellation is still drawn in the receipt box. ▼▲ 0 at 2026-10-03 13:42 — the diagram now draws two *DB Transaction* boxes (creation · receipt-from-validation-to-recording), which closes both transaction critiques: cancellation is one DB transaction, and the extra shipping fee is written inside the receipt transaction, so a failed receipt no longer leaves it behind (recorded). A parcel arriving after cancellation is received through a NEW restock with the same resi (recorded — the parked item is answered, nothing is parked any more). ⛔ But the lock-and-recheck-`ongoing` step was COMMENTED OUT in both receipt and cancellation: a DB transaction is all-or-nothing, not one-at-a-time, so two simultaneous receipts both pass again (20 units for 10), and an approved restock can be cancelled — a contradiction with four recorded decisions. Also: cancellation is drawn in the same box as receipt (two requests, two transactions), and the User/Team Service staff check and the billing message sit inside the box although no DB transaction can undo another service. ▼▲ 0 at 2026-10-03 12:54 — receipt and cancellation now lock the transaction row and re-check `ongoing` first (recorded), closing the double receipt. Two new critiques: the cancellation is not yet one DB transaction, so its lock holds nothing · and line 147 writes the extra shipping fee during validation, before the DB transaction opens, so a failed or refused receipt still leaves its fee on the transaction. ▼▲ 0 at 2026-10-03 12:46 — a receipt naming any `item_id` that is not its transaction's is refused whole (recorded). Most dangerous left: the server does not re-check `ongoing` inside the receipt's DB transaction, so two simultaneous receipts both succeed. ▼ −1 at 2026-10-03 12:23 — the server now checks the receiving staff, read from the login token, is a member of the transaction's warehouse via User or Team Service (recorded); built here with `warehouse_id` as the request's scope field, compared to the transaction's. Left: `resi` guarded by the database. ▼ −2 at 2026-10-03 12:00–12:01 — the statement write is "create if missing, add if it exists" (recorded; built as one `INSERT … ON CONFLICT`, which closes the atomic-write question) · the warehouse page now lists only that warehouse's restocks (recorded), but the receipt RPC carries only `tx_id`, so the server must still refuse a staff member from another warehouse · ⏸ a parcel arriving after cancellation is parked at the owner's request, not counted. ▼▲ 0 at 2026-10-03 11:52 — one comment added: `item_id` comes from `TRANSACTION_ITEMS.id`. It matches the recorded decision and names where the id comes from, not whose it is — an item of another transaction is also a `TRANSACTION_ITEMS.id`, so that critique stays open. Line references shifted +2 and were updated. ▼▲ 0 at 16:02 — the receipt step now writes the `approved` log, the statement and the goods in one DB transaction, then bills (recorded); receipt lines point at `item_id`; the statement is named in all three steps (recorded). Left: an `item_id` from another transaction, and the server re-checking `ongoing` at receipt. ▼▲ 0 at 15:50 — the flow is complete. Matching per item via SKU and supplier closes the item-pointer question (recorded); cancellation by CS or admin is written (recorded), and the parked cancel questions return as one new question — a package that arrives after cancellation. Blocking: the receipt step writes no `approved` log, so a received restock stays `ongoing` and can be received again; and `SKU_STATEMENT` appears in no step. ▼▲ 0 at 15:30 — the receipt now rejects empty values — an unset variant, rack 0, count 0 (recorded); one copy slip puts a number rule on the free-text `notes`, which would fail every receipt with a lost line. ▼▲ 0 at 15:03 — three placement variants replace the type enum; a broken unit must have a rack again (recorded, reversing 14:46 — which also closes the discarded-unit critique). An unset variant and rack `0` still pass as empty values. ▼▲ 0 at 14:46 — a broken unit may be shelved or thrown away at the door, the staff's call (recorded, differing from my recommendation and accepted); a discarded unit must then not count in `stock_broken`. ▼▲ 0 at 14:43 — a broken unit now carries its rack and photo (recorded), and the resi rule now says in words that `approved` closes a resi too; "a broken unit must have a rack" is still only a comment. ▼▲ 0 at 14:32 — the anomaly type now rejects 0 (recorded); left open: a broken unit's rack and photo are not sent. ▼▲ 0 at 14:29 — one receipt list where each line is a rack placement or a broken/lost unit; its type enum puts BROKEN at 0, so an unset type silently reads as broken. ▲ +2 at 14:12–14:14 — the owner deleted the restock cases and their clarify: the flow is now the only source. The case's three receipt questions moved here (−3 there, +3 here); the SKU-team question was answered "from the request for now, Product Service later" (recorded, against my recommendation); the resi question narrowed to "the database guards it, per courier". The photo contradiction closed by dropping the `CHECK` — reversing a decision, against my recommendation. 🆕 2026-10-02 — the owner's new single-picture restock flow, written up to receipt validation. Four decisions recorded (CS or team Admin may create, a SKU of another team refuses the whole restock, partial receipt allowed, one resi per open restock). Open: the SKU's team is compared against a number the screen sends, and a resi frees up after `approved` with only text guarding it. One contradiction: the flow makes the courier-receipt photo optional while the ERD's `CHECK` still requires it. |
| [business/project/member_clarify.md](business/project/member_clarify.md#question) | 5 | 🆕 who DECIDES, rather than what the system does. ▼ progress reporting is settled |
| [technical/development/workflow_clarify.md](technical/development/workflow_clarify.md#question) | 4 | |
| [business/settlement/context_clarify.md](business/settlement/context_clarify.md#question) | 5 | ▲ was 3 — 🔨 **the build added two** (Q4 `marketplace_total = 0`, Q5 the live sale), both built as recommended; Q3 is built too. Before that: ▼ was 5 — the ledger's mechanics are all settled. What is left: where a platform WITHDRAWAL lives, whether `problem funding` is `marketplace_adjustment`, and who PUBLISHES a ledger change (re-routed from the analytic clarify, which the owner scoped to receiving). 🆕 **Three new contradictions this round, no new questions** — `context.md` is doc-lagging the shipped tables, and two of the five stale sites were in the clarify itself |
| [business/settlement/analytic_context_clarify.md](business/settlement/analytic_context_clarify.md#question) | 6 | ▲ was 5 — 🔨 Q6 from the build: topic retention for the replay's seek. Before that: ▼ was 6 — `system_adjustment` decided as a ledger row in a day. What is left of it is **#3**, reshaped |
| [business/settlement/meta_context_clarify.md](business/settlement/meta_context_clarify.md#question) | 1 | 🆕 `settlement_service_metadata` — `analytic_status` is gone, `process_event_lock` replaced it — is this table CONFIG (human-set) or STATE (service-set)? |
| [technical/ledger/mutation_and_ledger_clarify.md](technical/ledger/mutation_and_ledger_clarify.md#question) | 3 | 🆕 counted for the first time |
| [technical/event_architecture/context_clarify.md](technical/event_architecture/context_clarify.md#question) | 0 | ▼ was 1 — ✅ **every question closed**: Q6, Q14 and Q15 all decided part by part, on top of Q1–Q13. **Twenty-three decisions**, the newest being the required `oneof`, one decoder, breaking the old protos accepted, `identity` settled in four parts, and CI on `dev` with `buf breaking` — applied. ⛔ **What blocks the first event here is a contradiction, not a question** — the shipped library cannot publish the decided envelope, and `context.md` lags its own decisions. See **#6** |
| [technical/cost/design_clarify.md](technical/cost/design_clarify.md#question) | 2 | ⚠ listed in *what changed* last round but never added to this table |
| [technical/packages/excel_readers/context_clarify.md](technical/packages/excel_readers/context_clarify.md#question) | 7 | 🆕 **a new technical package, first pass** — the Shopee/TikTok settlement file reader, measured against all 25 sample workbooks rather than read off the spec. ⛔ **Two findings are load-bearing beyond this package**: TikTok's column set is **not fixed** (three layouts across 13 files — `Flat fee` and `Sales fee` vanish, `GMV Max ad fee` appears), and **neither platform gives a per-row unique key**, which contradicts settlement's `hash(date + order_ref_id)`. ▼ **The Shopee half of that closed the same day** — the owner added a `### Shopee Contract` with a `GenerateUniqueID` (md5 over six fields), and it survived testing: **0 collisions in 3788 rows** across 12 files, both duplicate-row pairs distinct, and **141/141 stable** across a re-save through another tool. What is left is TikTok, whose `Order/adjustment ID` repeats. ⚠ The new contract opened three of its own, all about that hash being taken over `json.Marshal` of a struct that will change — and it **corrected one of my recommendations into a recorded contradiction**: I proposed `int64` rupiah in a `technical/` doc against [rupiah-is-floating-point](business/order/context_decision.md#rupiah-is-floating-point), which was decided system-wide in the *order* tree and had already rejected that same recommendation once. The other five are scope and typing: verbatim strings or an enum · is Tokopedia a *format* or a *column* · fixtures or real values (`wderror`, `x`) · what timezone is stored · does the package read only settlement reports. ⚠ Also non-design: **`examples/` is untracked and not gitignored**, and the workbooks carry real seller usernames and revenue into a PUBLIC repo |

> **Counted from each file's Question section, at either heading level.** Previous rebuilds matched
> `## Question` only, and five technical clarifies write theirs as `# Question` — so **17 open
> questions were silently excluded**, all six of technical balance's among them. ⚠ **Worth fixing at
> the source:** one heading level across every clarify makes this count mechanical instead of a
> judgement call.
