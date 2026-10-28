import { Marketplace } from "../../../gen/warehouse/marketplace/v1/marketplace_pb";
import { checkLabel } from "../../shipment/receiptCheck";
import type { LabelResult } from "../../shipment/receiptCheck";

// WHAT IS CHECKED BEFORE AN ORDER IS PLACED (owner) — in one file.
//
// They are separated from the screen on purpose: every one of them is a QUESTION ABOUT THE DATA, not
// about a layout. A pure function here is a function a server can be handed later without a component
// coming with it.
//
//   1. the receipt file names an order id and a tracking number → autofill, then verify  (API: ReceiptCheck)
//   2. the order id's shape SUGGESTS which marketplace it is — an offer, never a check     (local rule)
//   3. the estimated profit must clear the floor                                         (local rule)
//
// ⚠ NOT CHECKED, both by the owner's decision:
//   - whether the order id and the tracking number differ — some marketplaces use the order id AS the tracking number
//     (the-order-id-may-be-the-tracking-number);
//   - whether either number has its courier's or its marketplace's FORMAT — the table was written from what we had
//     seen and warned on real J&T numbers, and the receipt file check reads both numbers off an attached label
//     (the-form-does-not-check-number-formats).
//
// ⚠ TWO SEVERITIES, AND THEY ARE NOT THE SAME CONVERSATION. A WARNING can be overruled — a thin order is taken
// deliberately, a label is read wrong. An ERROR cannot, and the dialog offers only a way back. Every check above is a
// warning today; the severity stays for a rule that is wrong every time.

export type CheckLevel = "error" | "warning";

export interface CheckFinding {
  /** Stable id — the i18n key under `orderForm.checks.<id>` and the test handle. */
  id: string;
  level: CheckLevel;
  /** Values for the message's placeholders. */
  values?: Record<string, string>;
}

// ── 2. what the order id's shape suggests ───────────────────────────────────────────────────────

/**
 * What a marketplace's order id usually looks like — read ONLY to offer which marketplace it is. Nothing warns when
 * an id does not match (the-form-does-not-check-number-formats): a shape we have seen is a hint, not a rule.
 */
const MARKETPLACE_REF: Partial<Record<Marketplace, RegExp>> = {
  [Marketplace.SHOPEE]: /^[0-9A-Z]{12,14}$/,
  [Marketplace.TOKOPEDIA]: /^INV\/\d{8}\/[A-Z0-9/]+$/i,
  [Marketplace.TIKTOK]: /^5\d{17,18}$/,
};

/**
 * The marketplace whose reference shape this order id matches, when exactly ONE does.
 *
 * ⚠ ONLY WHEN IT IS UNAMBIGUOUS. Two marketplaces matching the same string is not a suggestion, it
 * is a coin toss — and a picker that fills itself in with the wrong storefront is worse than one that
 * says nothing, because nobody re-reads a field that looks answered. It is an OFFER the person applies.
 */
export function suggestMarketplace(orderRefId: string): Marketplace | undefined {
  const ref = orderRefId.trim();
  if (ref === "") return undefined;

  const hits = (Object.entries(MARKETPLACE_REF) as [string, RegExp][]).filter(([, pattern]) => pattern.test(ref));

  return hits.length === 1 ? (Number(hits[0]![0]) as Marketplace) : undefined;
}

function normalise(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]/g, "");
}

// ── 3. the profit floor ─────────────────────────────────────────────────────────────────────────

/**
 * The floor: an order under this much margin is questioned before it is placed. ONE number for every team
 * (the-margin-floor-is-35-percent-for-every-team) — the margin panel reads it from here, so the two cannot drift.
 */
export const MINIMUM_MARGIN_PCT = 35;

export function checkProfitFloor(sellPrice: bigint, orderTotal: bigint): CheckFinding | null {
  // No sell price is not a thin order — it is an order nobody has priced, and Create already refuses it
  // (platform-total-is-required-at-finalize).
  if (sellPrice <= 0n) return null;

  const pct = Number(((sellPrice - orderTotal) * 10000n) / sellPrice) / 100;
  if (pct >= MINIMUM_MARGIN_PCT) return null;

  return {
    id: "profitBelowFloor",
    level: "warning",
    values: { pct: pct.toFixed(1), floor: String(MINIMUM_MARGIN_PCT) },
  };
}

// ── 1. what the receipt file says ───────────────────────────────────────────────────────────────

/**
 * What shipment's ReceiptCheck read off the label file. `""` = the label did not carry it — and both
 * numbers are `""` for every result but `read`, so a file that is not a label fills nothing and
 * contradicts nothing.
 */
export interface ReceiptScan {
  result: LabelResult;
  orderRefId: string;
  trackingCode: string;
}

/**
 * THE RECEIPT FILE, READ BACK (owner) — shipment's `ReceiptCheck`, run on the FILE the person picked,
 * beside its upload (receipt-check-takes-the-file-bytes), never on the stored document.
 *
 * Two things then happen, and they are deliberately different:
 *
 *   • AUTOFILL — but only into an EMPTY field (`applyScan`). A person's typing is never overwritten
 *     by a machine reading a file.
 *   • VERIFY — at submit time, what was typed is compared with what the file says, and a mismatch is
 *     a warning the person can overrule (`checkScanMatches`). The SERVER never verifies
 *     (receipt-check-returns-what-the-library-reads), so nothing refuses an order on it.
 *
 * The recipient the label prints (name, phone, address) is read too and NOT used here yet: whether it
 * may fill the customer card is the order form's question, not the check's.
 */
export async function scanReceipt(file: File): Promise<ReceiptScan | null> {
  const reading = await checkLabel(file);
  if (!reading) return null;

  return { result: reading.result, orderRefId: reading.orderRefId, trackingCode: reading.receipt };
}

/** Fills ONLY what is still empty — see `scanReceipt`. */
export function applyScan(
  scan: ReceiptScan,
  current: { orderRefId: string; trackingCode: string },
): { orderRefId: string; trackingCode: string } {
  return {
    orderRefId: current.orderRefId.trim() === "" ? scan.orderRefId : current.orderRefId,
    trackingCode: current.trackingCode.trim() === "" ? scan.trackingCode : current.trackingCode,
  };
}

/** What was typed against what the file says. One finding, naming whichever half disagrees. */
export function checkScanMatches(
  scan: ReceiptScan | null,
  typed: { orderRefId: string; trackingCode: string },
): CheckFinding | null {
  if (!scan) return null;

  const refOff = scan.orderRefId !== "" && normalise(scan.orderRefId) !== normalise(typed.orderRefId);
  const codeOff =
    scan.trackingCode !== "" && normalise(scan.trackingCode) !== normalise(typed.trackingCode);

  if (!refOff && !codeOff) return null;

  return {
    id: refOff && codeOff ? "scanBothOff" : refOff ? "scanRefOff" : "scanCodeOff",
    level: "warning",
    values: { ref: scan.orderRefId, code: scan.trackingCode },
  };
}

// ── The gate ────────────────────────────────────────────────────────────────────────────────────

/**
 * Everything that has something to say about this order, in the order a person should read it:
 * what cannot pass, then what they may decide to accept.
 *
 * ⚠ ONE DIALOG, NOT SIX. Six rules answered one modal at a time is six interruptions for an order
 * somebody is trying to place; the findings are collected and shown together, and the dialog offers
 * "place anyway" only when every one of them is a warning.
 */
export function runOrderChecks(input: {
  orderRefId: string;
  trackingCode: string;
  scan: ReceiptScan | null;
  sellPrice: bigint;
  orderTotal: bigint;
}): CheckFinding[] {
  const findings = [
    checkScanMatches(input.scan, {
      orderRefId: input.orderRefId,
      trackingCode: input.trackingCode,
    }),
    checkProfitFloor(input.sellPrice, input.orderTotal),
  ].filter((f): f is CheckFinding => f !== null);

  return [
    ...findings.filter((f) => f.level === "error"),
    ...findings.filter((f) => f.level === "warning"),
  ];
}

export function hasBlocking(findings: CheckFinding[]): boolean {
  return findings.some((f) => f.level === "error");
}
