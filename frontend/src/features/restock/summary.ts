import type {
  RestockRequest,
  RestockRequestItem,
} from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";

// What a restock's LINES add up to — the numbers both restock lists put in a row.
//
// They live here rather than in either page because the selling list and the warehouse list ask the
// same arithmetic of the same message, and two copies of "sum the lines" is how one screen starts
// counting damaged units and the other does not.

// How many pieces were ASKED FOR, across every line.
export function askedQuantity(items: RestockRequestItem[]): bigint {
  return items.reduce((sum, item) => sum + item.quantity, 0n);
}

// How many pieces actually ENTERED STOCK, across every line. 0 until the warehouse has counted, so
// it only says anything once the request is FULFILLED — see shortfall().
export function receivedQuantity(items: RestockRequestItem[]): bigint {
  return items.reduce((sum, item) => sum + item.receivedQuantity, 0n);
}

// What the GOODS cost — the line totals as typed off the invoice (#140), with no freight in them.
export function goodsTotal(items: RestockRequestItem[]): bigint {
  return items.reduce((sum, item) => sum + item.totalPrice, 0n);
}

// What the whole restock has COMMITTED — goods plus every freight charge on them.
//
// `cod_shipping_fee` is 0 until a warehouse accepts and enters what the courier charged at the door
// (#155), so this is the ordered value while pending and the landed value once accepted. It is
// deliberately NOT re-based on what arrived: the stored line total is the number off the invoice,
// and scaling it by received/asked would invent a per-piece rounding nobody typed. A short delivery
// is reported as a SHORTFALL beside the value instead — see below.
export function committedValue(request: RestockRequest): bigint {
  return goodsTotal(request.items) + request.shippingCost + request.codShippingFee;
}

// How many pieces the delivery came UP SHORT, or 0.
//
// Only a FULFILLED request can be short: before acceptance `received_quantity` is 0 on every line,
// which is the absence of a count and not a delivery of nothing — reading it earlier would flag
// every pending restock as a total loss.
//
// Over-delivery (11 against 10 asked) is real and returns 0 here rather than a negative: this
// answers "did I get less than I paid for", which is the question a buyer chases a supplier about.
export function shortfall(request: RestockRequest): bigint {
  if (request.status !== RestockRequestStatus.FULFILLED) return 0n;

  const short = askedQuantity(request.items) - receivedQuantity(request.items);

  return short > 0n ? short : 0n;
}
