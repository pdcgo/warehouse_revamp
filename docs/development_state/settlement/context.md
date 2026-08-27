# Development state — settlement

**Pass:** business analysis (2026-08-27). **Stopped at:** the clarify gate, one question from
implementation. **Nothing was built.** No proto, no migration, no screen.

## Read this first

⚠ **`settlement` names two different things in this checkout, and the owner has split them.**

| | |
| --- | --- |
| **`backend/services/settlement_service/`** — SHIPPED, and **misnamed** | what **teams owe each other**. 9 RPCs, 3 migrations, screens at `/liability`. **This is `liability_service` now.** |
| **[docs/business/settlement/context.md](../../business/settlement/context.md)** — NOT BUILT | what the **marketplace pays us** for an order. This is what `settlement_service` means from here on. |

⚠ **Settlement is much smaller than an early reading suggests.** It is an **order-scoped ledger with a
write API** — nothing else. File import, per-marketplace parsing, matching a platform reference to an
order, and the unmatched tray all belong to a deferred **`export_service`**.

## What was decided

Nine, all in [context_decision.md](../../business/settlement/context_decision.md), each with its spec.
**One is reversed** — read the index table there first.

| decision | what it means for code |
| --- | --- |
| [the-name-settlement-moves-to-the-payout](../../business/settlement/context_decision.md#the-name-settlement-moves-to-the-payout) | the shipped service renames to **`liability_service`** — folder, packages, proto dir and package, 9 RPCs, 4 tables, goose version table, `features/settlement/`, i18n keys. Routes `/settlement` and `/settlement/:counterpartyId` **deleted** (superseded pages), freeing those paths. **Must land before any `warehouse.settlement.v1` payout file exists.** |
| [the-grain-is-the-order](../../business/settlement/context_decision.md#the-grain-is-the-order) | scope is **`order_id`**. ⚠ its shop-level-charge warning is superseded |
| ⛔ ~~every-marketplace-order-carries-a-unique-platform-ref~~ | **REVERSED** — see the next row |
| [settlement-publishes-to-the-book](../../business/settlement/context_decision.md#settlement-publishes-to-the-book) | the log **is** the `Settlement Log`. Write in its own transaction, then publish; broker is the ledger's only path in. **DLQ required.** |
| [the-account-opens-at-order-creation](../../business/settlement/context_decision.md#the-account-opens-at-order-creation) | first row is `initial_total` = **−`order.marketplace_total`**, on order creation |
| [the-log-is-order-scoped-with-six-types](../../business/settlement/context_decision.md#the-log-is-order-scoped-with-six-types) | row = `order_id`, `shop_id`, `team_id`, `settlement_type`, `change`, `balance`. Types: `initial_total`, `fund`, `external_ads_fee`, `affiliate_fee`, `marketplace_adjustment`, `other` |
| [settlement-keys-on-our-order-id](../../business/settlement/context_decision.md#settlement-keys-on-our-order-id) | ⛔ **reverses the ref decision.** Settlement never sees the platform's reference — `export_service` resolves it to an `order_id` first. Whether `Order.order_external_ref_id` should be unique is now purely an `order_context` matter |
| [importing-is-not-settlements-job](../../business/settlement/context_decision.md#importing-is-not-settlements-job) | statements, the parser, matching and the unmatched tray → `export_service` (deferred). Settlement drops from **six screens to two** |
| [a-residual-balance-is-normal](../../business/settlement/context_decision.md#a-residual-balance-is-normal) | the balance **does not reach zero** and that is expected. It is a **VARIANCE**, not a receivable. ⚠ **No "settled" flag on `balance = 0`, and no worklist of non-zero balances** |
| [settlement-ignores-our-order-status](../../business/settlement/context_decision.md#settlement-ignores-our-order-status) | nothing is gated on `OrderStatus`; a row can post anytime. `initial_total` depends on the order **existing**, never on where it has got to |

## What blocks the next pass

[settlement Q1](../../business/settlement/context_clarify.md#question) — **what is settlement's write
interface, and where does the idempotency key come from?** It is **#1** in
[biggest_question.md](../../biggest_question.md).

Two decisions combined into a correctness hole: `importing-is-not-settlements-job` took away the file,
so settlement cannot dedupe on a line reference it never sees — and `a-residual-balance-is-normal`
removes the only detector, because **a doubled fee looks exactly like an ordinary unexplained
residual**. A statement imported twice doubles every fee, forever, with nothing to catch it.

Recommendation: a `SettlementPost` RPC taking a caller-supplied `idempotency_key`. `initial_total`
needs that RPC today, before `export_service` exists, so the contract can be settled now.

## What does not exist

- **The write RPC** — the blocker above.
- **`platform_fee` / `shipping_fee` types**, though §2 names both, so marketplace commission is
  unreportable. Depends on whether `fund` is gross or net.
- **A rule for `marketplace_total = 0`** — a phone order would open at 0 and every `fund` would push
  its balance positive.
- **`occurred_on` / `posted_on`** — the owner's shape has one `At` column doing two jobs, and §3 says
  fees arrive the next day.
- **`export_service`** — named in §General Brief 3, absent from `architecture/context.md`, explicitly
  deferred.
- **Anywhere for a withdrawal.** Wallet to bank names no order and is not one of the six types.

## Contradictions standing

- **`marketplace_total` is documented as the field nothing computes from** (`order.proto:216`) and
  settlement now opens every account from it. The ⚠ on line 226 (*never in margin or revenue*) is still
  correct and must stay; the "nothing computes" half is stale.
- **`liability_service` and `balance_service`** (`architecture/context.md:7`) are the same box under two
  names, and the architecture clarify proposes splitting the shipped service into a `balance_service` it
  believes does not exist yet. `export_service` has the same problem in advance — named in one doc,
  absent from the one that names services.

⚠ The `COMPLETED` contradiction **left this file**: `settlement-ignores-our-order-status` resolved it
for settlement. `OrderStatus` still stops at `SHIPPED` while `order_context.md` draws `completed` and
`problem` — that is now `order_context`'s to carry.
