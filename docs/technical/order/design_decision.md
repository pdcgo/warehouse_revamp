# Decisions — order `design.md`

> ⚠ **EVERY DECISION BELOW IS ABOUT THE SELLING TEAM'S ORDER LIST AND ORDER DETAIL.** The warehouse reads `/orders`
> from the other end and keeps the screen it had — see
> [the-two-ends-are-two-screens](#the-two-ends-are-two-screens). Nothing here has been applied to it,
> and the owner has not designed it yet.

| decision | what it settles |
| --- | --- |
| [status-colours-are-carried-over-verbatim](#status-colours-are-carried-over-verbatim) | every status keeps the hue it had, collisions included |
| [one-context-per-column-and-never-three-lines](#one-context-per-column-and-never-three-lines) | pairing is only for one fact read twice — it REPLACES the six-paired-cells decision |
| [the-row-shows-total-beli-and-total-mp](#the-row-shows-total-beli-and-total-mp) | two totals: what it cost us, and what the platform paid — it REPLACES an-order-total-is-goods-plus-fulfilment |
| [the-margin-is-mp-minus-total-beli](#the-margin-is-mp-minus-total-beli) | margin and its percentage are both measured against the MARKETPLACE price |
| [the-ongkir-is-the-warehouses-to-set](#the-ongkir-is-the-warehouses-to-set) | shipping is priced by the building that ships it, so it is absent from the create screen |
| [every-date-gets-its-own-column](#every-date-gets-its-own-column) | three dates, three columns — it REPLACES two-dates-and-two-totals-with-ours-leading |
| [a-filtered-status-shows-its-own-date](#a-filtered-status-shows-its-own-date) | the third date appears only under the tab it answers |
| [harga-beli-team-and-gudang-are-on-the-row](#harga-beli-team-and-gudang-are-on-the-row) | all three earn a place, none of them a column of its own |
| [the-action-menu-is-a-table-keyed-by-status](#the-action-menu-is-a-table-keyed-by-status) | what you can do to an order, per state, in one place |
| [a-deadline-is-loud-or-it-is-nothing](#a-deadline-is-loud-or-it-is-nothing) | four urgency bands, and an overdue order tints its whole row |
| [the-preview-became-the-order-list](#the-preview-became-the-order-list) | a seller's `/orders` IS this screen now — the preview page is gone |
| [the-two-ends-are-two-screens](#the-two-ends-are-two-screens) | the warehouse keeps its old list — almost nothing on the seller's row is a fact a picker acts on |
| [the-order-detail-is-one-page-of-sections](#the-order-detail-is-one-page-of-sections) | the detail is one page of sections with a scrolling left nav — not three tabs |
| [the-order-detail-lines-are-priced-at-harga-beli](#the-order-detail-lines-are-priced-at-harga-beli) | the item table shows what we PAID, so the perincian adds up to the list's figures |
| [the-detail-margin-is-mp-minus-system](#the-detail-margin-is-mp-minus-system) | margin = total MP − total sistem, the list's formula read from the detail |

---

## status-colours-are-carried-over-verbatim

> Owner, in chat (2026-09-24): the old system's thirteen statuses with their colours, then — on each
> of the three collisions raised — *keep it*.

**The verdict.** The eight statuses take the old system's hues, folded the same way the statuses
were. Nothing was re-picked.

| status | hue | from |
| --- | --- | --- |
| `pending` | **amber** | `created` — Menunggu Diproses |
| `processed` | **sky** | `process` — Diproses Gudang, the umbrella |
| `shipped` | **blue** | `courrier_shipped` — Dikirim |
| `completed` | **green** | `completed` — Selesai |
| `problem` | **purple** | `problem` — Bermasalah |
| `lost` | **purple** | `return_problem` — Lost |
| `return` | **pink** | `return_completed` — Retur Diterima |
| `cancel` | **rose** | `cancel` — Batal |

**Why verbatim.** People have been reading these colours for years. A fresh palette would spend that
recognition to buy consistency nobody asked for.

### The three collisions, raised and accepted

Recorded so they are not "fixed" later by somebody who sees them as mistakes:

| | accepted because |
| --- | --- |
| `problem` and `lost` are **the same purple** | both say *something is not right*; the label carries which. ⚠ Two badges side by side in a table are not distinguishable by colour alone |
| `cancel` is **rose — the app's own accent**, worn by every primary button | the tone is shared, the step is not: a badge sits at `rose.100`, a button at `rose.600`. ⚠ A Cancelled badge beside a primary button reads as one family |
| `processed` (sky) and `shipped` (blue) are **adjacent pale blues** | they ARE adjacent — in the warehouse, then on the road. The same reasoning `OrderStatusBadge` already uses for picking and packed sharing orange |

### What had to change in the theme to write this honestly

`amber`, `sky`, `indigo` and `rose` were reachable only through `warning`, `info`, `primary` and
`brand`. CLAUDE.md says a status is written as a **hue** (an order's lifecycle step is its own example
of categorical colour) and never as a **role** — but the only spelling available was the role, so
colouring a status amber meant writing `warning`, and the day the warning tone moved a status nobody
thought was a warning would have moved with it.

The four ramps are now registered under their own names in
[theme.ts](../../../frontend/src/theme.ts) as well. Same ramps, no new colours —
`colorPalette="amber"` is a statement about the hue and `colorPalette="warning"` one about the role,
and they can no longer be confused.

```mermaid
flowchart LR
  R["one ramp — Tailwind amber"] --> A["colorPalette amber — a HUE, categorical"]
  R --> W["colorPalette warning — a ROLE, says 'careful'"]
  A --> S["order status"]
  W --> T["alerts, fields, toasts"]
```

---

## one-context-per-column-and-never-three-lines

> Owner, in chat (2026-09-28): *"1 line lebih dari 2 baris"* · *"konteks berbeda di satukan (toko dan
> gudang), beli.margin tidak masalah"* · *"tanggal bedakan saja columnnya, status belum kamu bedakan
> jadi tidak lurus kebawah"*.

⚠ **This REPLACES `the-row-is-six-cells-not-twelve-columns`.** That decision paired twelve facts into
six cells and treated pairing as the way to fit a wide table. Two rules replace it:

| | |
| --- | --- |
| **1. No cell is more than two lines** | one row of the table is one row of reading |
| **2. One context per cell** | pairing is for ONE FACT READ TWICE, never for two questions |

**What was wrong with the old pairing** is not that it was dense — it is that it answered two questions
in one place. Toko and Gudang are not one fact; somebody scanning for *which warehouse* had to read past
a shop name to get there.

```mermaid
flowchart TB
  subgraph before["six paired cells"]
    A["Toko + Gudang"]
    B["#id + ref + status + resi"]
    C["dibuat + MP date + status date"]
    D["Beli + margin"]
  end
  subgraph after["one context per column"]
    A1["Toko + its badge"] --- A2["Gudang dropped"]
    B1["#id alone"] --- B2["ref + status"] --- B3["Resi"]
    C1["dibuat + oleh"] --- C2["Tgl MP + deadline"] --- C3["Tgl status"]
    D1["Beli"] --- D2["Total MP + margin"]
  end
  A --> A1
  B --> B1
  C --> C1
  D --> D1
```

⚠ **THE RULE IS THE TEST, NOT THE PAIRS.** Which facts count as one took several rounds, and every
pairing below had to earn its second line by being the SAME fact read twice — the marketplace's name for
the order and where that order stands; the storefront's order time and the deadline it starts. A pair
that merely had room is what the rule rejects.

**The columns, in order** — nine, and only four carry a second line:

| | column | line 1 | line 2 |
| --- | --- | --- | --- |
| 1 | ID Order | the marketplace's reference, **copyable** | the status badge |
| 2 | Resi | the tracking number, **copyable** | |
| 3 | Toko *or* Tim | the shop's name | its marketplace badge |
| 4 | Dipesan | our date | `oleh <nama>` |
| 5 | Tgl MP | the storefront's order date | **the ship-by deadline** |
| 6 | Tgl `<status>` | **only while a status is filtered** | |
| 7 | Beli | total beli | |
| 8 | Total MP | what the platform paid | **the margin · %** |
| 9 | Aksi | the kebab | |

**What came OFF the row, and why.** Both answer *tell me about this order* rather than *which order do
I want* — which is the test a column has to pass:

| dropped | |
| --- | --- |
| **Penerima** (owner) | the search box already reaches the customer's name, so finding one never needed a column to look at |
| **Gudang** (owner) | a seller's orders nearly all ship from the same building, and the crew reading its own queue would see its own name twenty times |
| **`#id`** (owner) | nothing reads it. The marketplace reference is what a buyer, a shop and a courier all quote; our number survives as the row's link target and its testid, not as a column |

**Where each pair landed, and why it is ONE fact rather than two:**

| pair | why they belong together |
| --- | --- |
| ID Order / status | the marketplace's name for the order, and where that order has got to |
| Toko / marketplace badge | two storefronts often share a name — the pair IS the identifier |
| Tgl MP / deadline | **causal**: the ship-by window runs FROM the storefront's order time |
| Total MP / margin | the margin is `harga MP − total beli`, measured against the figure above it |
| Dipesan / `oleh` | one event: when we wrote it down, and who did |

⚠ **THE STATUS MOVED TWICE, and the second move is not a reversal of the first.** It began on the second
line of the `#id` cell, where the badges did not line up down the page. A column of its own fixed that;
under the marketplace reference it is line 2 on *every* row, so they line up there too — and it costs no
column.

⚠ **THE TWO COPYABLE FIELDS ARE THE TWO THAT LEAVE THE APP.** The marketplace reference is pasted into
the platform's dashboard and the resi into a courier's tracking page or a reply to a buyer. Our `#id` is
quoted across a room, not pasted, so it is not copyable. Both stop the row's navigate — without that,
copying a number would also leave the page and nobody would see it happen.

⚠ **THE DEADLINE SAT UNDER THE RESI FOR ONE ROUND, and moved because the premise was wrong.** The pairing
there assumed a resi appears only at handover, so the two would never coexist — but *"resi pasti ada"*
(owner): the marketplace prints the label at confirmation, which is exactly why the action table offers
*Edit Resi* on `created` and `process`. The resi answers *which parcel*, the deadline *when it has to go*.

⚠ **The price is a wider table, and that is accepted.** The page still never scrolls sideways — the table
scrolls inside its own box (measured at 400px). Five of the nine columns are a single line.

⚠ **One column appears and disappears**: the status date only exists under the tab that asks for it,
because a permanently blank column is one people learn to skip.

## the-row-shows-total-beli-and-total-mp

> Owner, in chat (2026-09-28): *"sistem lama total itu ada 2, total dari beli yang dimaksud adalah
> subtotal produk + biaya dan total dari mp"*.

⚠ **This REPLACES `an-order-total-is-goods-plus-fulfilment`.** That one read the earlier instruction
as *selling subtotal + fee* — a third figure that is neither of the owner's two totals, and the one a
margin cannot be taken from. There are **two** totals and they are opposite sides of the trade:

| | | in the contract |
| --- | --- | --- |
| **total beli** | `subtotal produk` (what the goods COST) `+ biaya` (the warehouse's fee) | `cogs` + a fee nothing carries |
| **total MP** | what the buyer paid the platform | `marketplace_total` |

```mermaid
flowchart LR
  C["cogs — what the goods cost"] --> B["TOTAL BELI"]
  F["biaya gudang"] --> B
  M["marketplace_total<br/>TOTAL MP"]
  M --> G["margin"]
  B --> G
```

⚠ **`Order.total` is on neither side.** It is `subtotal + shipping_cost` — our own quote plus postage
— and the row never reads it. See [the contradiction](design_clarify.md#contradiction) for the four
sites that decision touched.

⚠ **The `biaya` half is a SAMPLE.** Nothing carries a warehouse fee per order: it is a liability row
keyed by `source_id = order id`, and `LiabilityLogListFilter` takes a counterparty and nothing else
(balance Q9). The cost half is real `cogs`; the fee is invented and the column carries a mark.

⚠ **A `cogs` of 0 makes the whole cell refuse.** It is UNKNOWN, not free (`order.proto`), so total
beli is an em-dash rather than a fee-only figure that would read as a suspiciously cheap order.

## the-margin-is-mp-minus-total-beli

> Owner, same message: *"persentase adalah dari margin ke harga mp, margin adalah harga mp - total
> beli"*.

```
margin     = harga MP − total beli
persentase = margin ÷ harga MP
```

**Three things follow, and each is a trap if it is missed:**

| | |
| --- | --- |
| the revenue is the PLATFORM's figure, not ours | dividing by our `subtotal` would flatter every discounted order |
| the fee is INSIDE the cost | leaving it out overstates every order by the whole warehouse bill |
| the percentage is of the REVENUE | `margin ÷ beli` is a mark-up — a different number that reads the same |

⚠ **It needs TWO facts, so it has TWO ways to be unknown** — and that broke the summary strip the
first time it was rendered. An order missing either one is unmeasurable, and the two absences are
unrelated: fixture 107 has no cost, 108 has no marketplace figure.

```mermaid
flowchart TD
  A{"cogs recorded?"} -->|no| U["unmeasurable"]
  A -->|yes| B{"marketplace_total recorded?"}
  B -->|no| U
  B -->|yes| M["margin = MP − beli"]
  U --> D["em-dash, and counted in the strip's note"]
```

**What it changed, beyond the cell:**

| | |
| --- | --- |
| the strip's unknown marker | `cost_unknown` → **`margin_unknown`**: counting only the cost left the strip claiming **Rp 780.384** where the rows beneath summed to **Rp 599.980** |
| the census columns the strip needs | Σ `subtotal` → **Σ `marketplace_total`**, plus **Σ fees** |
| *nilai belanja* on the strip | now total beli (cost + fees), so the strip and the Beli column mean the same thing by the same word |

⚠ **It contradicts the proto's own margin** — `margin = total − cogs − shipping_cost`, which measures
our quote against our cost and never looks at what the platform paid. One formula lives in
`features/orders/margin.ts` and both the strip and the row read it, so they cannot disagree.

⚠ **The strip still lands ~11% above the sum of its rows, and that is now a documented limit rather
than a bug to tune.** The census gives the sample Σ `total` and a count, so an excluded order can only
be charged the pile's average size — and the excluded one here (#108) is the largest of the nine. Only
the server knows the size of what it left out, which is the argument for making these columns real.


## the-ongkir-is-the-warehouses-to-set

> Owner, same message: *"ongkir harusnya yang set adalah gudang, jadi di tampilan create tidak ada"*.

Shipping is priced by the building that ships it. Two consequences, both already visible:

1. **The order-create screen has no shipping field.** Its `shippingCost` pending entry was reasoned
   as *"nothing prices a shipment yet"*; the real reason is stronger — **it is not the seller's to
   price**, so the field would not belong there even once a courier catalogue exists.
2. **"Jadikan Dikirim" is the warehouse's action.** `OrderShip` takes the WAREHOUSE's team id and the
   handler finds the order by `(order_id, warehouse_id)`, so a seller pressing it calls on a team it
   is not a member of. Handing the parcel over and pricing its shipment are one side of the job.

## every-date-gets-its-own-column

> Owner, in chat (2026-09-28): *"tanggal bedakan saja columnnya"*.

⚠ **This REPLACES `two-dates-and-two-totals-with-ours-leading`.** The dates and the totals were stacked
two-to-a-cell with ours leading; three dates in one cell was the three-line row the owner rejected, and
each date answers a different question anyway.

| column | what it answers | real? |
| --- | --- | --- |
| **Dibuat** | when WE wrote the row — `created_at_unix`, and `oleh <nama>` under it | the date yes, the author no |
| **Tgl MP** | when the buyer ordered on the storefront | no field at all |
| **Tgl `<status>`** | when it entered the status being filtered | `OrderEvent` has the shape, the list never sends it |

**`oleh` stays paired with the created date** because it is the same event: who wrote it down, and when.
That is one fact read twice, which is exactly what the pairing rule allows.

⚠ **THE TWO ABSENCES ARE DIFFERENT, and the row must not conflate them:**

```mermaid
flowchart TD
  R{"order_external_ref_id"}
  R -->|"empty"| P["a PHONE order — no MP date, no MP total"]
  R -->|"set"| M{"marketplace_total"}
  M -->|"0"| N["a marketplace order nobody costed — MP date, NO MP total"]
  M -->|"greater than 0"| B["both"]
```

An empty reference means the order never came from a storefront; a `marketplace_total` of 0 means only
that nobody wrote down what the storefront took (`order.proto` — *0 = not recorded, not "sold for
nothing"*). Keying the DATE off the amount would hide a real order date on the strength of a missing
figure; fixture 108 is that case, kept deliberately.

## a-filtered-status-shows-its-own-date

> Owner: *"jika filter status aktif, akan ada tanggal sesuai perubannya kapan, misal saja dikirim
> selain 2 tanggal di atas ada juga tanggal dikirim"*.

A third line appears in the Dipesan cell **only while a status tab is selected**, reading
`<status> <date>`. "When did this ship" is a question you only ask while looking at shipped orders,
so carrying it on every tab would be a mostly-blank column.

⚠ **The shape exists and the list cannot read it.** `OrderEvent` is already `kind` + `at_unix`,
which is exactly this — but events are populated by `OrderDetail` only. The fix is not a new field,
it is the list carrying the one event the active filter asks about.

## harga-beli-team-and-gudang-are-on-the-row

> Owner, in chat (2026-09-27): *"harga beli, team dan gudang? … 3nya diputuskan untuk ada"*.

All three are on the row, and none of them took a column of its own:

| fact | where it landed |
| --- | --- |
| harga beli | headline of the **Beli · Margin** cell — it IS total beli (cost + fees); the margin and the percent are its second line |
| team | the **first cell's headline** for any reader who is not a SELLING team — a warehouse, root or admin. Only a selling team owns shops, so only there does a shop name tell two rows apart |
| gudang | **its own column**, withheld when it is the reader's own building |

⚠ **A crew does not need its own name twenty times.** A warehouse's rows all ship from itself, so the
whole Gudang COLUMN is absent for that reader — the same rule that puts Tim in the Toko position
there.

⚠ **The row's owner and the shop FILTER are two questions, and they had one answer.** The filter is
offered to anyone but a warehouse (a deliberate earlier call); the COLUMN now follows "is this a
selling team", so root and admin get Team instead of a Shop column that would be blank on every row.

⚠ **"root bisa liat team" is NOT BUILDABLE TODAY.** `scopedOrders` is
`(team_id = ? OR warehouse_id = ?)` with no root bypass, so a reader in the root team matches neither
and sees an empty list — the column would be correct and the table empty. That is a server change,
not a column; it is open in the clarify file.

## the-action-menu-is-a-table-keyed-by-status

> Owner, in chat (2026-09-28) — the per-status action list, given in the OLD status names.

The menu is a rendering of one table, so "what can I do to a returned order" is read rather than
traced through branches. Mapped onto the decided eight:

| stage | actions | built? |
| --- | --- | --- |
| pending | Batalkan Order · Edit Resi | cancel is real |
| processed | Edit Resi — **and at the handover step** — Jadikan Dikirim · Retur Barang · Selesaikan Order | ship is real, warehouse only |
| shipped | Retur Barang · Selesaikan Order | neither |
| completed | Edit Withdrawal | no |
| problem | Selesaikan Sengketa | no |
| return | Jadikan Lost · Selesaikan Order (only when `wd_total` is above zero) | neither, and no `wd_total` |
| lost · cancel | — | the owner listed none, and both are ends |

**Two of the owner's rows fold into one stage**, and this is the only judgement call:

```mermaid
flowchart LR
  A["old — shipped, handed over"] --> B["new — processed, LAST STEP"]
  C["old — courrier_shipped, moving"] --> D["new — shipped"]
  B -.-> E["Jadikan Dikirim · Retur · Selesaikan"]
  D -.-> F["Retur · Selesaikan"]
```

⚠ **The step it needs has no enum value**, so the gate falls back to `PACKED` — the last
representable step before handover. A packed order that has not yet been handed to the courier is
offered "Jadikan Dikirim" one step early until the enum lands. Same cause as the four dead tabs, so
it carries the same mark rather than a new one.

⚠ **Six of the nine items do nothing yet**, and each says so twice: the ⚠ on the item, and a toast
naming the reason when it is pressed. A menu item that silently does nothing reads as a broken app
rather than an unfinished one.

## a-deadline-is-loud-or-it-is-nothing

> Owner, in chat (2026-09-28): *"sama jika order punya deadline aku ingin dia mencolok"*.

A ship-by deadline is not a date to look up — it is the app telling somebody to act, so it is the one
thing on this table allowed to shout.

| band | when | how it reads |
| --- | --- | --- |
| **overdue** | past | SOLID error badge, **and the whole row is tinted** |
| **urgent** | within 6 hours | SOLID warning badge |
| **today** | within 24 hours | quiet warning badge |
| **later** | beyond that | plain text, in the gray of any other date |

```mermaid
flowchart LR
  D["deadline"] --> O{"passed?"}
  O -->|yes| R["solid error + row tint"]
  O -->|no| S{"within 6h?"}
  S -->|yes| W["solid warning"]
  S -->|no| T{"within 24h?"}
  T -->|yes| Q["quiet warning"]
  T -->|no| P["plain gray"]
```

- **The row tint is the only whole-row colour on this table**, which is what keeps it meaning one
  specific thing. A badge in one column is visible; a tinted row is unmissable while scanning.
- **The colour is a ROLE, never a hue** — `error` / `warning`, so a palette change reaches it. This is
  also the one cell where those roles are earned: every other cell states a fact, this one raises an
  alarm.
- **It reads in hours under a day and days above it.** "4 hari lagi" is what somebody plans around;
  "97 jam lagi" is a number they would have to divide first.
- **A shipped, completed or cancelled order shows nothing.** The clock stops when the parcel leaves,
  and a column that stayed red on orders already out of the building is a column people learn to
  ignore.

⚠ **NOTHING CARRIES A DEADLINE.** Not `Order`, not `ShipmentChannel` (no lead time), and not
`OrderEvent`, which records what HAPPENED rather than what is due. The real thing this stands in for is
the marketplace's own ship-by clock, which is per storefront — so the field it needs is a deadline ON
the order, written when the order is imported.

⚠ **The two boundaries are a GUESS and should be the owner's** — 6 hours as "not for the next shift",
24 as "today's problem". They are named in one place (`deadlineMock`) so there is a single line to
change.

## the-preview-became-the-order-list

> Owner, in chat (2026-09-29): *"sudah bisa diterapkan ke order list aslinya"*.

The screen was built as `pages/orders-next/`, reachable only from Storybook, so it could be argued over
without touching the running app. It is now **`pages/orders/SellerOrders.tsx`**, on the `/orders` route
for a selling team, and the preview directory is deleted.

⚠ **A WAREHOUSE STILL GETS THE OLD LIST** — see [the-two-ends-are-two-screens](#the-two-ends-are-two-screens).

| | |
| --- | --- |
| moved | the page as `SellerOrders.tsx` · `components/*` · `pending.ts` · `stages.ts` · `rowActions.ts` · the three mocks |
| kept | the old page as `WarehouseOrders.tsx`, with its `OrderStatRow` — untouched |
| new | `index.tsx`, a picker: team type chooses which |

⚠ **THE OLD SCREEN'S TESTS CAME ACROSS, NOT ITS CODE.** Twenty-five `play()` rules already described
what an order list must do — a warehouse sees another team's order, a tab narrows the table but never
the counts, an empty search says *nothing matched* rather than *no orders*, the drafts tab leaves. Those
are facts about the screen, not about its markup, so they were re-pointed at the new one rather than
rewritten. Eight failed on the move and each failure named a real change:

| failed because | now |
| --- | --- |
| `orders-stat-*` | the strip is `order-summary-row-<stage>` |
| `orders-tab-count-placed` · `orders-tab-packed` · `orders-tab-cancelled` | the owner's eight: `pending` · `processed` · `cancel` |
| `orders-clear-filters` | the shared FilterBar's own `orders-filters-clear` |
| clicking the customer's name to open a row | Penerima is off the row — it clicks the date cell |

⚠ **AND ONE FAILURE WAS NOT A RENAME.** *"The status tab narrows to one stage of the crew's work"*
asserted that choosing Diproses hides the pending orders. It does not, and cannot: the owner folded four
steps into one status while `OrderListFilter.status` takes exactly one enum value. That became
`DiprosesCountsButOnlyAStepCanNarrow` — **the `statusSet` mark written as an assertion**, so the day a
single `PROCESSED` value lands it fails and the step filter's reason for existing is re-read.

⚠ It was written on the warehouse's stories and MOVED to the seller's when the warehouse list reverted.
Worth saying plainly: restoring a file quietly takes its tests with it, and this one was the only thing
holding that gap down.

⚠ **THE PENDING MARKS CAME WITH IT.** Fourteen entries in `pages/orders/pending.ts`, on a screen people
now actually use — which is the point: the marks exist so a live screen can say what it cannot do yet
rather than quietly lying about it.

## the-two-ends-are-two-screens

> Owner, in chat (2026-09-29): *"warehouse order list page kembalikan, aku belum mau menyentuh itu,
> konteksnya beda soalnya"*.

`/orders` is read from both ends (#151) and was one screen with a few columns swapped. It is now two,
chosen by team type in `pages/orders/index.tsx`.

```mermaid
flowchart LR
  R["/orders"] --> P{"team type"}
  P -->|WAREHOUSE| W["WarehouseOrders — the old list, untouched"]
  P -->|SELLING, ROOT, ADMIN| S["SellerOrders — rebuilt around the money"]
```

**And the context really is different**, which is why this is a split and not a flag:

| the seller's row | the warehouse's job |
| --- | --- |
| ID Order · Tgl MP · Total MP · Beli · Margin | what to pick, from which shelf, by when |
| what a shop is owed and what it earned | what a crew is holding |

⚠ **A WAREHOUSE SHOWING ANOTHER TEAM'S MARGIN IS SHOWING IT SOMEBODY ELSE'S BUSINESS.** The list already
spans sellers — a building sees orders from every team that ships through it — so the money columns are
not merely unhelpful there, they are a disclosure.

⚠ **IT IS A JS BRANCH, NOT CSS.** Same rule as the app shell (`layouts/Layout.tsx`): rendering both and
hiding one would mount two tables, two sets of queries and two of every `data-testid` the e2e reach for.

⚠ **THE TEAM TYPE, NOT A ROLE.** Who you are inside a team does not change which list this is — a
warehouse admin and a warehouse picker both read the building's queue. Root and admin fall through to
the seller's screen, which is where the Tim column lives.

⚠ **THE WAREHOUSE'S SCREEN IS NOT DESIGNED YET, only preserved.** It still carries the old stat row and
the old three columns; nothing on this page has been asked of it.

## the-order-detail-is-one-page-of-sections

> Owner, in chat (2026-09-29): *"oke detail aku setujui"* — approving the preview
> `Pages/Order/OrderDetailNextPage` after a round of changes.

The order detail is **one page of sections**, not the built page's three tabs, with a left navigation
that scrolls to each. The question it answers — *what happened with this order* — is usually answered by
two sections at once, and tabs put exactly those pairs on opposite sides of a click.

```mermaid
flowchart TB
  H["sticky header — order no. copyable, stage badge, deadline, per-status actions as buttons"]
  S["stepper — the journey, or a branch off it"]
  T["four tiles — Total MP, Total sistem, Margin tinted, Item — each copyable"]
  I["Info order — resi and marketplace id first, then team, marketplace, created, warehouse"]
  subgraph wide["at xl and up"]
    M["main — Item order with perincian and bar, Timeline, Pengiriman, Withdrawal"]
    D["side — Catatan, Penerima"]
  end
  H --> S --> T --> I --> wide
```

| part | the spec |
| --- | --- |
| **header** (sticky, one line) | `Pesanan #id` with the number copyable · stage badge · deadline badge · the list's per-status actions as **buttons**, folding into `⋯` only past three (never a `⋯` of one; destructive ones fold first) |
| **navigation** | left column on a desktop, chips inside the sticky block on a phone; short labels (`Withdrawal`), the card keeps its full title; the same icon on the card and the nav item; click scrolls the section just below the header; scrolling lights the section being read — in two columns, the main column only |
| **stepper** (not sticky) | Menunggu → Diproses → Dikirim → Selesai; an off-journey status is a branch in its own hue, cancel from Menunggu, the rest from Dikirim |
| **tiles** | Total MP · Total sistem · Margin (success/error by sign) · Item; each copies a plain number (`245000`, not `Rp 245.000`) |
| **Info order** | full width; the resi (courier + number) and the marketplace order id first and a size larger, both copyable; a return resi only when a return exists |
| **Catatan** | its own section: a list, newest first, of `system` and `user` notes; user notes editable, system notes never; `Order.note` is the first user note |
| **Item order** | per line: the marketplace's own title (as on the draft) above our product — image, name, SKU — then team, **harga beli**, qty, line total |
| **perincian** | full-width panel: total produk + biaya = total sistem, total MP, margin — and a bar across harga MP split into produk · biaya · margin (a loss draws as a red overflow; no bar without both facts) |
| **Timeline** | status changes on a dotted rail, newest first — the same rail as the courier trail |
| **Pengiriman** | two legs of one shape, side by side: order (courier · resi · deadline · trail) and return (only when there is one) |
| **Penerima** | name, address, and the phone as a copy button |
| **Withdrawal** | the owner's columns, invented rows — its home is still open (see the clarify file) |
| **WD summary** | under the withdrawal table: total WD · penyesuaian · bersih diterima · % of total MP — the per-order figures the old system reported, summed from the rows |
| **build marks** | every ⚠ sits BESIDE the label or title it belongs to, as on the order form and the list — never pushed to a card's far edge, where the withdrawal table's mark read as belonging to nothing. `EveryDeclaredGapIsMarkedOnScreen` fails if a declared gap has no badge on screen |

⚠ **Still a preview.** It is not routed; `/orders/:id` opens `pages/order-detail` until it is applied, the
way the order list was. Every invented figure keeps its ⚠ mark.

## the-order-detail-lines-are-priced-at-harga-beli

> Settled by approving the preview, which prices the lines at harga beli; was open as *is the order
> detail's "harga" what we PAID or what we CHARGED?*

The item table's price column is **what we paid** (`OrderItem.unit_cost`), and the perincian under it
sums those. That is what makes the detail's percentage the SAME as the list's: the list's margin is
`harga MP − (cogs + biaya)`, so the detail's total sistem has to be `cogs + biaya`.

```mermaid
flowchart LR
  L["line: harga beli x qty"] --> P["total produk"]
  P --> S["total sistem = total produk + biaya"]
  B["biaya gudang"] --> S
  S --> M["margin = total MP − total sistem"]
  MP["total MP"] --> M
```

## the-detail-margin-is-mp-minus-system

> Settled by approving the preview; was open as *the subtraction is written the other way up — which is
> it?* The owner had written *"total sistem dikurangi lagi dengan total mp"*.

**`margin = total MP − total sistem`**, as a share of total MP — the list's formula
([the-margin-is-mp-minus-total-beli](#the-margin-is-mp-minus-total-beli)) read from the other end. The
written order was word order: taken literally it negates the margin and every healthy order reads as a
loss.
