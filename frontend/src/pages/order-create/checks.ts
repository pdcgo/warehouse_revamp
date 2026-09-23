import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";
import type { ReceiptValue } from "../../components/orders/ReceiptUpload";

// WHAT IS CHECKED BEFORE AN ORDER IS PLACED (owner) — six rules, in one file.
//
// They are separated from the screen on purpose: every one of them is a QUESTION ABOUT THE DATA, not
// about a layout, and three of them will move behind an API. A pure function here is a function a
// server can be handed later without a component coming with it.
//
//   1. the receipt file names an order id and a tracking number → autofill, then verify  (API, stubbed)
//   2. the tracking number's FORMAT belongs to the chosen courier                        (local rule)
//   3. the order id / tracking number's format belongs to the chosen marketplace         (local rule)
//   4. …and when it does not, the format SUGGESTS which marketplace it is                (local rule)
//   5. the order id and the tracking number must not be the same, or near it             (API, stubbed)
//   6. the estimated profit must clear the floor                                         (local rule)
//
// ⚠ TWO SEVERITIES, AND THEY ARE NOT THE SAME CONVERSATION. A WARNING can be overruled — formats
// change, a courier prints something unusual, a thin order is taken deliberately. An ERROR cannot:
// an order id that is also the tracking number is a transcription mistake every time, and placing it
// means an order nobody can find again on either side.

export type CheckLevel = "error" | "warning";

export interface CheckFinding {
  /** Stable id — the i18n key under `orderForm.checks.<id>` and the test handle. */
  id: string;
  level: CheckLevel;
  /** Values for the message's placeholders. */
  values?: Record<string, string>;
}

// ── The provisional format tables ───────────────────────────────────────────────────────────────
//
// ⚠ PROVISIONAL, AND THE SCREEN SAYS SO (mark: `formatRules`). These are patterns, not law: they are
// what the checker matches on, they are the owner's to correct, and they live as DATA in one place so
// correcting one is an edit to a line rather than a change to a function.
//
// A courier or marketplace that is NOT listed never produces a finding — an unknown format is not a
// wrong format, and a checker that complains about everything it has not been taught is a checker
// people switch off.

interface FormatRule {
  /** Matches the value the field holds. */
  pattern: RegExp;
  /** For the message: what the shape is, in words. */
  shape: string;
}

/** `Shipping.code` → what its tracking number looks like. */
const COURIER_TRACKING: Record<string, FormatRule> = {
  jnt: { pattern: /^JP\d{10,14}$/i, shape: "JP + 10–14 digits" },
  jne: { pattern: /^\d{12,16}$/, shape: "12–16 digits" },
  sicepat: { pattern: /^\d{12,15}$/, shape: "12–15 digits" },
  anteraja: { pattern: /^\d{12,14}$/, shape: "12–14 digits" },
};

/** Marketplace → what ITS order reference looks like. */
const MARKETPLACE_REF: Partial<Record<Marketplace, FormatRule>> = {
  [Marketplace.SHOPEE]: { pattern: /^[0-9A-Z]{12,14}$/, shape: "12–14 digits and capitals" },
  [Marketplace.TOKOPEDIA]: { pattern: /^INV\/\d{8}\/[A-Z0-9/]+$/i, shape: "INV/<date>/…" },
  [Marketplace.TIKTOK]: { pattern: /^5\d{17,18}$/, shape: "5 + 17–18 digits" },
};

// ── 2. the tracking number against the courier ──────────────────────────────────────────────────

export function checkTrackingAgainstCourier(
  trackingCode: string,
  shippingCode: string,
): CheckFinding | null {
  const code = trackingCode.trim();
  const rule = COURIER_TRACKING[shippingCode.toLowerCase()];

  if (code === "" || !rule || rule.pattern.test(code)) return null;

  return { id: "trackingCourier", level: "warning", values: { shape: rule.shape } };
}

// ── 3. the references against the marketplace ───────────────────────────────────────────────────

export function checkRefAgainstMarketplace(
  orderRefId: string,
  marketplace: Marketplace,
): CheckFinding | null {
  const ref = orderRefId.trim();
  const rule = MARKETPLACE_REF[marketplace];

  if (ref === "" || !rule || rule.pattern.test(ref)) return null;

  return { id: "refMarketplace", level: "warning", values: { shape: rule.shape } };
}

// ── 4. …and what the format suggests instead ────────────────────────────────────────────────────

/**
 * The marketplace whose reference format this order id matches, when exactly ONE does.
 *
 * ⚠ ONLY WHEN IT IS UNAMBIGUOUS. Two marketplaces matching the same string is not a suggestion, it
 * is a coin toss — and a picker that fills itself in with the wrong storefront is worse than one that
 * says nothing, because nobody re-reads a field that looks answered.
 */
export function suggestMarketplace(orderRefId: string): Marketplace | undefined {
  const ref = orderRefId.trim();
  if (ref === "") return undefined;

  const hits = (Object.entries(MARKETPLACE_REF) as [string, FormatRule][]).filter(([, rule]) =>
    rule.pattern.test(ref),
  );

  return hits.length === 1 ? (Number(hits[0]![0]) as Marketplace) : undefined;
}

// ── 5. the order id and the tracking number are not the same thing ──────────────────────────────

/**
 * ⚠ AN ERROR, NOT A WARNING (owner). One number pasted into both boxes is a transcription mistake
 * every time — and the order it creates cannot be found again from either side, because neither
 * reference is the one the storefront or the courier knows it by.
 *
 * Equal is the obvious case; NEAR-equal is the one that actually happens — a digit dropped off the
 * end, or a prefix typed onto one of them. The authoritative comparison is meant to be an API
 * (`refsDistinct` in `pending.ts`); this is what stands in until it exists.
 */
export function checkRefsAreDistinct(orderRefId: string, trackingCode: string): CheckFinding | null {
  const a = normalise(orderRefId);
  const b = normalise(trackingCode);

  if (a === "" || b === "") return null;
  if (a === b) return { id: "refsIdentical", level: "error" };
  // One contained in the other catches the dropped digit and the added prefix in one comparison.
  if (a.includes(b) || b.includes(a)) return { id: "refsNearlyIdentical", level: "error" };

  return null;
}

function normalise(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]/g, "");
}

// ── 6. the profit floor ─────────────────────────────────────────────────────────────────────────

/** The floor the owner set: an order under this much margin is questioned before it is placed. */
export const MINIMUM_MARGIN_PCT = 35;

export function checkProfitFloor(sellPrice: bigint, orderTotal: bigint): CheckFinding | null {
  // No sell price is not a thin order — it is an order nobody has priced. The margin panel already
  // says so, and blocking on it would stop every phone order.
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

/** What the (future) receipt check reads off the file. `""` = the file did not carry it. */
export interface ReceiptScan {
  orderRefId: string;
  trackingCode: string;
}

/**
 * THE RECEIPT FILE, READ BACK (owner) — a STUB standing in for the API that will do it.
 *
 * The real call takes the uploaded document and answers with the order id and the tracking number
 * printed on it. Two things then happen, and they are deliberately different:
 *
 *   • AUTOFILL — but only into an EMPTY field (`applyScan`). A person's typing is never overwritten
 *     by a machine reading a photo.
 *   • VERIFY — at submit time, what was typed is compared with what the file says, and a mismatch is
 *     a warning the person can overrule (`checkScanMatches`).
 *
 * Until the API exists this returns the file's own name when it looks like a reference, and nothing
 * otherwise — enough to exercise both paths on a real screen without inventing numbers that would
 * then be "verified" against a person's correct typing.
 */
export async function scanReceipt(receipt: ReceiptValue): Promise<ReceiptScan | null> {
  if (!receipt.documentId) return null;

  const stem = receipt.filename.replace(/\.[a-z0-9]+$/i, "");
  const parts = stem.split(/[_\s]+/).filter((p) => /^[A-Z0-9/]{8,}$/i.test(p));

  if (parts.length === 0) return null;

  return { orderRefId: parts[0] ?? "", trackingCode: parts[1] ?? "" };
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
  shippingCode: string;
  marketplace: Marketplace;
  scan: ReceiptScan | null;
  sellPrice: bigint;
  orderTotal: bigint;
}): CheckFinding[] {
  const findings = [
    checkRefsAreDistinct(input.orderRefId, input.trackingCode),
    checkScanMatches(input.scan, {
      orderRefId: input.orderRefId,
      trackingCode: input.trackingCode,
    }),
    checkTrackingAgainstCourier(input.trackingCode, input.shippingCode),
    checkRefAgainstMarketplace(input.orderRefId, input.marketplace),
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
