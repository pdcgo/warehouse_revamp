import { ConnectError } from "@connectrpc/connect";

import {
  OrderTransactionRefusalReason,
  OrderTransactionRefusalSchema,
} from "../../gen/warehouse/inventory/v1/order_transaction_pb";

// WHY THE WAREHOUSE REFUSED AN ORDER'S TAKE — read off the error OrderCreate or OrderDraftPromote answered with.
//
// Placing an order draws its goods in the same transaction (#149), so a refusal of the take IS a refused order. The
// take answers with ONE reason and every line it names (a-refusal-names-its-reason-and-every-line), as an
// `OrderTransactionRefusal` detail on the Connect error, and selling passes that error through unchanged — its code and
// its detail. Decoding it here is what lets the form say "Kopi: wants 3, the warehouse holds 1" instead of a status
// code. Shared by the two screens that place orders, so they cannot read it two ways.

/** One line the take refused. `available` is only meaningful for not-enough-stock; 0 otherwise. */
export interface RefusedLine {
  productId: bigint;
  wanted: bigint;
  available: bigint;
}

export interface TakeRefusal {
  reason: OrderTransactionRefusalReason;
  lines: RefusedLine[];
}

/** The take's refusal carried by `err`, or `undefined` when the error is anything else. */
export function takeRefusalOf(err: unknown): TakeRefusal | undefined {
  const [refusal] = ConnectError.from(err).findDetails(OrderTransactionRefusalSchema);
  if (!refusal) return undefined;

  return {
    reason: refusal.reason,
    lines: refusal.lines.map((line) => ({
      productId: line.productId,
      wanted: line.wanted,
      available: line.available,
    })),
  };
}

/** The reason as the i18n catalogue names it — `orderForm.refusal.<kind>`. */
export type RefusalKind = "notEnoughStock" | "notAllowed" | "keyUsed" | "other";

export function refusalKind(reason: OrderTransactionRefusalReason): RefusalKind {
  switch (reason) {
    case OrderTransactionRefusalReason.NOT_ENOUGH_STOCK:
      return "notEnoughStock";
    case OrderTransactionRefusalReason.NOT_ALLOWED:
      return "notAllowed";
    case OrderTransactionRefusalReason.KEY_USED:
      return "keyUsed";
    default:
      return "other";
  }
}
