// THE SHAPE OF ONE ORDER'S SETTLEMENT, and nothing about where the numbers came from.
//
// ⚠ THIS IS A DESIGN PROTOTYPE (`implementation_analysis`, docs/development_lifecycle.md). Nothing
// here is wired to a service and there is no proto behind it yet — deliberately. `settlement_service`
// does not exist, and the name is currently taken by the team-debt service that becomes
// `liability_service` (docs/business/settlement/context_decision.md). Writing
// `warehouse.settlement.v1` today would put two things called settlement in one checkout, which is
// how the wrong one gets imported.
//
// So the screens come first and the contract is derived FROM them (HARD RULE 6). These types ARE the
// proposed contract, in TypeScript, where they can be previewed before anything is generated.
//
// ── The one idea the whole screen is built on ───────────────────────────────────────────────────
//
// `initial_total` is a frozen copy of `order.marketplace_total` — **what the buyer actually paid**.
// ⚠ It is a FACT, not a prediction (`marketplace-total-is-a-fact-not-an-estimate`). What is estimated
// is only the EXPECTATION that all of it will reach us; the estimate lives in the comparison, never
// in the column.
//
// That is what makes the balance sharp rather than fuzzy. Measured against a fact, the gap is not
// "drift from a guess" — it is exactly:
//
//     how much of what the buyer paid never reached us
//
// which is the platform's take, literally. Per `hidden-cost-is-left-in-the-balance` the platform does
// not itemise it, so the gap is the only measure of it we will ever have.
//
// Which is why there is no `settled` flag anywhere below, and no "outstanding" anything: nothing will
// ever reach zero, nobody is going to collect it, and a screen that implies otherwise would be wrong.

/**
 * One of the SEVEN (`context.md` §Settlement Log Ledger Shapes 2, widened by
 * `a-cancel-is-an-opposite-row`). APPEND ONLY.
 *
 * ⚠ `initial_total_cancel` is in this union but NOT in `MANUAL_TYPES` below, and the difference is
 * the point: the ledger must DISPLAY a cancel — a machine posts them — while no form may OFFER one
 * (`only-machines-post-the-cancel`). A union that omitted it would render a real row as `other`.
 */
export type SettlementType =
  | "initial_total"
  | "initial_total_cancel"
  | "fund"
  | "external_ads_fee"
  | "affiliate_fee"
  | "marketplace_adjustment"
  | "other";

/**
 * How the row arrived (§Shapes 3, widened by `the-third-source-is-order`). THREE write paths, and the
 * row records which.
 *
 * ⚠ `order` is separate from `exporter` even though both are machines. It is what makes "only
 * order_service may post a cancel" a check the write API can make, and it keeps `manualEntries()` —
 * the design's only review surface — meaning what it says.
 */
export type SourceType = "exporter" | "manual" | "order";

/**
 * Who is looking at the form. DECIDED — `the-write-set-is-cs-and-up`.
 *
 * Only the roles that can write appear here; everybody else gets `canPost = false` and never sees the
 * form at all. `team_admin` is separated from the rest because it is the ONE role that may post every
 * type except `initial_total`.
 */
export type PostingRole = "root" | "admin" | "team_owner" | "team_admin" | "customer_service";

/**
 * The types a PERSON may post from the order page — DECIDED, and it depends on the role.
 *
 * ⚠ `initial_total` IS HAND-POSTABLE, by root, admin, team_owner and customer_service
 * (`initial-total-is-postable-by-cs-and-owners`). This reverses the earlier proposal that nobody may
 * type it, and the reasoning is the marketplace relationship: CS is who talks to the platform and
 * reads what the buyer actually paid, so authoring that fact is their job. `team_admin` is the
 * operational role and never touches it.
 *
 * ⚠ IT IS NOT A REPLACEMENT — it is another row. A second `initial_total` ADDS to the account
 * (`UNIQUE (order_id, unique_id)` cannot see that two rows mean the same thing), so posting one where
 * the automatic row already exists DOUBLES the sale and reads as catastrophic loss. `canPostInitialTotal`
 * is therefore two conditions, not one — see `context_clarify.md`'s critique on the duplicate sale.
 */
const EVERY_MANUAL_TYPE: SettlementType[] = [
  "fund",
  "external_ads_fee",
  "affiliate_fee",
  "marketplace_adjustment",
  "other",
];

/** The five types every posting role may write, whatever the account already holds. */
export const MANUAL_TYPES: SettlementType[] = EVERY_MANUAL_TYPE;

/** The roles that may author the sale figure. `team_admin` is deliberately absent. */
export const INITIAL_TOTAL_ROLES: PostingRole[] = [
  "root",
  "admin",
  "team_owner",
  "customer_service",
];

/**
 * Whether THIS person may post `initial_total` on THIS account.
 *
 * Both halves matter. The role decides who may author the sale; the account decides whether there is
 * a sale to author. An order whose automatic row already landed has one, and a second is not a
 * correction of it — it is a duplicate that no constraint can catch.
 */
export function canPostInitialTotal(role: PostingRole, settlement: OrderSettlement): boolean {
  return INITIAL_TOTAL_ROLES.includes(role) && !hasLiveInitialTotal(settlement);
}

/** Whether the account already holds an `initial_total` that has not been reversed. */
export function hasLiveInitialTotal(settlement: OrderSettlement): boolean {
  return settlement.entries.some(
    (e) =>
      e.settlementType === "initial_total" &&
      e.reversesId === undefined &&
      !isReversed(settlement, e),
  );
}

/** The type list this person sees on this account — the five, plus the sale when both halves allow. */
export function manualTypesFor(role: PostingRole, settlement: OrderSettlement): SettlementType[] {
  return canPostInitialTotal(role, settlement)
    ? ["initial_total", ...EVERY_MANUAL_TYPE]
    : EVERY_MANUAL_TYPE;
}

/** One row of the log. IMMUTABLE — `a-correction-is-a-new-row`. */
export interface SettlementEntry {
  id: string;
  /**
   * The idempotency key, unique with `orderId`. Generated by the CALLER —
   * `the-unique-id-is-generated-outside-settlement`. Shown on screen because it is the only thing
   * that explains why a re-import wrote nothing.
   */
  uniqueId: string;
  settlementType: SettlementType;
  /** Signed. Positive is money toward us. Whole rupiah. */
  change: bigint;
  /** The running position AFTER this row. */
  balance: bigint;
  sourceType: SourceType;
  /** Who is answerable — the PIC (`actor-id-is-the-pic`). Resolved to a name for display. */
  actorName: string;
  /** The day the platform says it belongs to. */
  occurredOn: string;
  /** The day we learned it. Equal to `occurredOn` on same-day rows; later on a late fee. */
  postedOn: string;
  /** Set when this row undoes an earlier one — a compensating entry, never an edit. */
  reversesId?: string;
  note?: string;
}

/** The state row, `order_settlements` (§Settlement State). */
export interface OrderSettlement {
  orderId: bigint;
  /** The marketplace's own id, for a human to recognise the order by. Display only. */
  orderRef: string;
  shopName: string;
  teamName: string;
  /**
   * What the buyer paid — a frozen copy of `order.marketplace_total`. Stored POSITIVE.
   *
   * ⚠ 0 means NOT RECORDED, not "sold for nothing" (`order.proto:224`). A missing fact, not a zero
   * one — so nothing can be measured against it and the screens refuse rather than compute.
   *
   * ⚠ The SIGN is an open question. The log's `change` for `initial_total` is NEGATIVE (−120.000);
   * this column holds the sale (+120.000). Positive makes `netReceived = lastBalance + initialTotal`
   * read as an addition and matches what the field is named after.
   */
  initialTotal: bigint;
  /** The current position. Negative means part of what the buyer paid never reached us. */
  lastBalance: bigint;
  /** What the goods cost us, frozen on the order. Needed for true margin; settlement never stores it. */
  cogs: bigint;
  entries: SettlementEntry[];
}

// ── The four numbers a person actually reads ────────────────────────────────────────────────────

/**
 * What actually reached us, net of everything: `lastBalance + initialTotal`.
 *
 * A SINGLE-ROW READ, which is the whole reason `order_settlements` keeps the estimate beside the
 * balance. On the worked example: `−10.000 + 120.000 = 110.000`, which is `100 − 10 + 20`.
 */
export function netReceived(s: OrderSettlement): bigint {
  return s.lastBalance + s.initialTotal;
}

/**
 * How much of what the buyer paid never reached us. Positive = a loss.
 *
 * The headline. `a-residual-balance-is-normal` says this is almost never zero and that is fine — so
 * it is presented as a fact about the order, never as a queue item or something to clear.
 */
export function loss(s: OrderSettlement): bigint {
  return -s.lastBalance;
}

/**
 * The part of the take NOBODY ITEMISED — `initialTotal − Σ(fund)`.
 *
 * The platform pays a number and does not say what it kept. This is that number, and per
 * `hidden-cost-is-left-in-the-balance` it is the closest thing to a take-rate this system can
 * produce. Summed across a shop's orders it answers *"what does this marketplace actually cost us"*.
 */
export function hiddenCost(s: OrderSettlement): bigint {
  const funded = sumOf(s, "fund");
  return s.initialTotal - funded;
}

/**
 * The part somebody DID itemise — every row that is neither the estimate nor a payout.
 *
 * Signed: negative is a charge, positive a reimbursement. `loss = hiddenCost − namedAdjustments`,
 * which is what lets the panel show the loss as a breakdown rather than a single unexplained figure.
 */
export function namedAdjustments(s: OrderSettlement): bigint {
  return s.entries
    .filter((e) => e.settlementType !== "initial_total" && e.settlementType !== "fund")
    .reduce((total, e) => total + e.change, 0n);
}

/** `netReceived − cogs` — the number no service in this system could produce before settlement. */
export function trueMargin(s: OrderSettlement): bigint {
  return netReceived(s) - s.cogs;
}

function sumOf(s: OrderSettlement, type: SettlementType): bigint {
  return s.entries
    .filter((e) => e.settlementType === type)
    .reduce((total, e) => total + e.change, 0n);
}

// ── Presentation rules that are decisions, not styling ──────────────────────────────────────────

/**
 * Whether a row's money moved toward us. Drives the colour, and nothing else.
 *
 * ⚠ `initial_total` is deliberately NEITHER. It is an accrual, not a movement — colouring it red
 * beside a real charge would read as "the platform took 120.000 from us", which is the opposite of
 * what the opening sale means.
 */
export function direction(e: SettlementEntry): "in" | "out" | "opening" {
  if (e.settlementType === "initial_total") return "opening";
  return e.change >= 0n ? "in" : "out";
}

/** A late fee is one that arrived after the day it belongs to — `two-dates-occurred-and-posted`. */
export function isLate(e: SettlementEntry): boolean {
  return e.postedOn > e.occurredOn;
}

/**
 * Rows a person typed, newest first.
 *
 * The only review this design can support: nothing detects a wrong amount arithmetically
 * (`a-residual-balance-is-normal`) and nothing can remove one (`a-correction-is-a-new-row`), so
 * *who typed what* has to be on screen rather than in an audit table nobody opens.
 */
export function manualEntries(s: OrderSettlement): SettlementEntry[] {
  return s.entries.filter((e) => e.sourceType === "manual");
}

/** Whether this row has already been undone by a later one. */
export function isReversed(s: OrderSettlement, entry: SettlementEntry): boolean {
  return s.entries.some((e) => e.reversesId === entry.id);
}
