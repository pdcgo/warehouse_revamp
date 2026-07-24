# mocks/ — mock-first UI previews

Design a screen **before** it is built. Each file here is a **standalone, self-contained HTML
mockup** of one screen: hardcoded sample data, inline CSS, no build step and no running app. Open
it straight in a browser — that is the whole point, a preview anyone can look at and react to before
a line of real React is written (#201).

> **Start at [`index.html`](index.html)** — a grouped, clickable front door to every mock, so you can
> explore by flow (Receiving · Warehouse product & stock · Selling team) instead of by filename. It
> is the one file here that is *not* a screen; every other file is. Add a card to it when you add a mock.

## The rules

- **One file per screen**, named for the screen: `accept-rack.html`, not `accept/rack.html`. Flat,
  like `frontend/src/pages/`. **Exception — a team subfolder when names would collide:** a screen that
  is one *team's* take on something the other team also has (the selling team's restock queue vs the
  warehouse's `restock-list.html`) lives in a team folder — `selling/restock-list.html` — so the two
  same-named screens don't clash. The folder names the audience, not a URL nesting.
- **Self-contained, with ONE exception: Tailwind.** Everything else is inline — no external CSS,
  fonts, or images, and no build step. The single allowed external dependency is the **Tailwind Play
  CDN** (`<script src="https://cdn.tailwindcss.com">`), which every mock loads to style itself with
  utility classes. That means a mock now needs the **network** (not a server) to render — open it in
  a browser that's online. Tailwind's theme is mapped onto the shared `:root` tokens (below), so the
  mocks keep matching the app; each file carries an identical `tailwind.config` — see
  [`app-shell.html`](app-shell.html) for the canonical `<head>`.
- **Fake data, real jobs.** The data is invented, but the screen shows the actual task a real person
  is trying to finish. A mock that skips the hard case (a short count, a broken item, an unplaced
  line) is a mock that designs the easy screen.
- **Not the design system.** These are throwaway previews to argue about layout, not the app —
  styled with **Tailwind utilities** (via the CDN above), which is deliberately NOT the app's stack.
  When a mock is agreed, the real screen is built from **Chakra** and the shared components (see
  `CLAUDE.md` — "The design system"), and the mock has done its job. Tailwind here is a fast styling
  layer for previews; it never graduates — only the token set does.
- **Shared tokens (#213).** The one thing that DID graduate from the mocks is their token set — the
  `:root` palette (colors + dark variants), radii, shadows, the system font stack. It now lives in
  `frontend/src/theme.ts` as Chakra `semanticTokens`; the mock-var → theme-token mapping is
  [`plans/design-tokens.md`](../plans/design-tokens.md). Keep a mock's `:root` values in step with it.

## What is here

| File | Screen | Notes |
| --- | --- | --- |
| [app-shell.html](app-shell.html) | The app shell — layout, sidebar & TeamSwitcher | The layout every screen renders inside: sidebar nav, the **TeamSwitcher** (warehouse / selling / root teams), top bar, and a sample warehouse Overview. Proposes the nav grouping; nav is **team/role-scoped**. Auth shown but unwired. Nav links launch the other mocks. |
| [restock-list.html](restock-list.html) | Warehouse inbound work queue (restocks) | The warehouse team's list of incoming restocks — shipped-onward only (In transit → Arrived → Accepted, + Cancelled). The job is to find **Arrived** ones and Accept them onto racks (→ `accept-rack`); Accepted ones link to their receipt. Receive-only. Search + filter (status / team / supplier / date). Paginates. |
| [selling/restock-list.html](selling/restock-list.html) | Restocks — **selling team** (the owner's inbound) | The *other* side of the warehouse queue: the catalogue owner **originates** a restock, so this spans the WHOLE lifecycle — **Draft → Ordered → In transit → Arrived → Received** — as **status tabs**, with a **New restock** action (the warehouse list is receive-only). Owner-facing columns (destination warehouse, ETA/landed, committed value); a received line short of ordered is flagged, because you're billed on what landed (#74). Rows open `selling/restock-detail`. Search + warehouse/supplier/date filters. Paginates. |
| [selling/restock-detail.html](selling/restock-detail.html) | Restock detail — **selling team** | One restock the owner raised, the rich hard case — **received short with damage**. A lifecycle **timeline** (Drafted → Ordered → In transit → Arrived → Received, dated + who), a discrepancy callout, a line table **reconciling ordered vs received / damaged / missing**, shipping (courier, tracking, ETA vs actual), and a **cost basis** settled on the received count, posting to the supplier `liability`. Links to the warehouse `batch-receipt`. |
| [accept-rack.html](accept-rack.html) | Accept a delivery onto racks | A redesign of the wired `restock-accept` screen (#157), leaning into rack put-away — counting a delivery and naming which shelf each line goes on, in one step. |
| [print-labels.html](print-labels.html) | Print labels after accepting a restock | The step after `accept-rack`: one sticker per shelved unit (or per shelf), with a QR (`product-code/batch-id`) + rack, so pickers can find and scan it. Broken/lost pcs are excluded — they never entered stock. Has a real print stylesheet. |
| [stock-move.html](stock-move.html) | Move stock between shelves (dialog) | The `Move` action from `warehouse-product-detail`. Relocate one delivery's units from one rack to another — a pair that nets to zero (#136), carrying the batch (stock is tracked per shelf **and** per batch). Live before/after balances. |
| [stock-adjust.html](stock-adjust.html) | Correct a shelf's count (dialog) | The `Adjust` action from `warehouse-product-detail`. Reason drives the model: a **Recount** reconciles the whole shelf (no single batch → "—"), while **Damaged / Lost / Found** touch specific units and carry a batch. Live delta preview. |
| [batch-list.html](batch-list.html) | Warehouse-wide list of every stock batch | Search + filter (supplier / expiry) to find expiring or depleted stock across all products; each row drills into `batch-detail`. A batch = product × delivery, so one delivery lists as several batches. Paginates (HARD RULE 9). |
| [batch-detail.html](batch-detail.html) | A single batch's living detail page | Drilled into from a delivery on `warehouse-product-detail`'s Batches tab. A batch = one product's units from one delivery (frozen cost): its identity, lifecycle (arrived → damaged → used → ready), where its ready units sit now, and its own history. Links to the receipt; Move/Adjust act on it. |
| [batch-receipt.html](batch-receipt.html) | Goods-received receipt for one delivery (batch) | The printable *document* behind a batch — reached from `batch-detail`'s Print receipt. What arrived: per-product arrived / damaged / accepted / unit cost / rack, who received it, with a print stylesheet. Sits between `accept-rack` and `print-labels`. |
| [liability-list.html](liability-list.html) | Settlement payables & receivables — what teams owe each other | The **Liability** nav's first screen (settlement §5.1 A, #185): one row per counterparty, **payable & receivable** in one list. Direction is named (never a bare sign), and **ageing is the point** — the *oldest unsettled* column, coloured by age, is what a manager chases. A *payable limit* meter shows headroom before a creditor blocks the next order (an absent limit reads as **No limit**, never a zero — §3.5). A count badge (nav + per-row) surfaces payments awaiting this team's confirmation, with an *Awaiting my confirmation* filter. `Unsettled only` on by default; a row opens the counterparty's history. Paginates. |
| [expense-list.html](expense-list.html) | A team's cost list — what it spent that no order caused | The `expense_service` first screen (cost §4.1, #161): everything a team spent no order asked for — **ads / payroll / operational / other**, a proto enum so cross-team totals mean the same thing. Each row is **typed by a person** and carries the **date the cost belongs to**; a **date range** (the primary control, and the span `/profit` subtracts on) totals everything in it, and each row **names who entered it**. Any kind may name an optional **shop** (an ads row usually does; payroll does not). Summary tiles total the range by kind and **exclude voided rows**. Row actions behind a kebab: **Edit** (a mistype is fixable) and **Void** (a `ConfirmDialog` — it moves profit, so it confirms) — a voided row is kept, struck through, out of every total, never deleted (#164 spirit). Paginates (HARD RULE 9). Manager-only (owner/admin). |
| [liability-detail.html](liability-detail.html) | Settlement counterparty detail — one relationship's running history | Drilled into from a `liability-list` row (settlement §5.1 B, #185): a **page**, not a dialog. The header summary shows the **net** position plus the two gross sides — *Receivable* (they owe you) and *Payable* (you owe them). Four tabs over the one relationship: **Receivable / Payable** are the ledger (every entry **names what caused it** — a typed `(source_type, source_id)` like *Product fee · order #412*, never a note; a **sign is legitimate here** as an entry is a movement; a cancelled order's fee and its reversal are **both kept, netting to zero**), and **My payments / Team payments** are the payment records (`Recorded → Confirmed → Reversed`). The two actions live here: **Confirm Payment** (a `ConfirmDialog` — it posts to the ledger) and **Record a Payment** (a form dialog; no ledger effect until confirmed). Paginates. |
