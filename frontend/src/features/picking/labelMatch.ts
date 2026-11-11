import type { Order } from "../../gen/warehouse/selling/v1/order_pb";

// WHETHER AN ORDER IS A SCANNED LABEL — the pure half of lookupLabel, kept apart so it is unit-tested without a server.
//
// A label carries several barcodes and the gun lands on any of them (a-label-scan-reads-the-ref-or-the-receipt): the code
// is the order's tracking number, its marketplace ref, or — typed off a screen — its id. EQUAL, never a substring, and
// regardless of case: a scanner reads a code as printed, a person types it as they like.

const MAX_ID = 18_446_744_073_709_551_615n;

/** The code as an order id, when it is one — digits only, within a uint64. */
export function labelId(code: string): bigint | undefined {
  const digits = code.trim();
  if (!/^\d{1,20}$/.test(digits)) return undefined;

  const id = BigInt(digits);
  return id > 0n && id <= MAX_ID ? id : undefined;
}

/** Whether the order IS this label: its tracking number, its marketplace ref or its id equals the code. */
export function carriesLabel(
  order: Pick<Order, "id" | "receiptCode" | "orderExternalRefId">,
  code: string,
): boolean {
  const wanted = code.trim().toLowerCase();
  if (wanted === "") return false;

  return (
    order.receiptCode.trim().toLowerCase() === wanted ||
    (order.orderExternalRefId ?? "").trim().toLowerCase() === wanted ||
    order.id === labelId(wanted)
  );
}
