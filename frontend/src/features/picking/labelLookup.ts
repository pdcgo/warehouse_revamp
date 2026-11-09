import { Code, ConnectError } from "@connectrpc/connect";

import { orderClient } from "../../api/clients";
import type { Order } from "../../gen/warehouse/selling/v1/order_pb";
import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";
import { orderListRowData, ordersFromList } from "../orders/adapt";
import { NO_ORDER_FILTERS, orderListFilterMsg } from "../orders/queries";
import { carriesLabel, labelId } from "./labelMatch";

// WHICH ORDER A SCANNED LABEL IS — asked of the SERVER, among this warehouse's orders, every time the gun fires.
//
//   scan ──▶ OrderList q (as this warehouse) ──▶ the rows whose tracking number, marketplace ref or id IS the code
//                                                 ├ live      — every one shown; one opens, several open none
//                                                 └ cancelled — skipped (two-orders-on-one-label-are-shown-not-chosen)
//
// A label carries several barcodes and the gun lands on any of them, so the code is compared with the tracking number
// AND the marketplace ref (a-label-scan-reads-the-ref-or-the-receipt) — and with the order id, which a crew may type off
// the screen. Scan Label (scan-label-opens-the-pick-page) and the handover scan share this one lookup.
//
// ⚠ THE SEARCH IS OrderList's OWN `q`, as Receive a Return asks it — so the server's scope decides what is found: the
// orders shipping from here, and the returns coming back to it. `q` is a SUBSTRING search (it matches names and phones
// too), so its rows are narrowed here to the ones that EQUAL the code, ignoring case. It reads one page of
// LABEL_LOOKUP_LIMIT; only a code that is a substring of more fields than that could push an exact match off it, and
// for an id — a short number inside many phone numbers — the order is then asked by id (OrderDetail, the same scope).

/** How many of `q`'s rows are read for one scan — far more than a full tracking number or ref ever matches. */
export const LABEL_LOOKUP_LIMIT = 100;

/** OrderListFilter.search's cap — a longer code is no label's, and is matched by nothing. */
const SEARCH_MAX = 100;

export interface LabelMatches {
  /** The orders the label is, cancelled ones skipped — one opens, several are only shown. */
  live: Order[];
  /** The cancelled orders that carry it too — never opened, never handed over. */
  cancelled: Order[];
}

/** The orders of this warehouse a scanned label is — see the header. Throws when the server cannot be asked. */
export async function lookupLabel(warehouseId: bigint, rawCode: string): Promise<LabelMatches> {
  const code = rawCode.trim();
  if (code === "" || code.length > SEARCH_MAX) return { live: [], cancelled: [] };

  const res = await orderClient.orderList({
    teamId: warehouseId,
    filter: { status: OrderStatus.UNSPECIFIED, ...orderListFilterMsg({ ...NO_ORDER_FILTERS, search: code }) },
    dataRequest: orderListRowData(),
    page: { page: 1, limit: LABEL_LOOKUP_LIMIT },
  });

  const found = ordersFromList(res.items, res.ids).filter((order) => carriesLabel(order, code));

  // AN ID PUSHED OFF THE PAGE by the substring rows it shares (a short number inside many phones): ask for it by id.
  const id = labelId(code);
  const truncated = Number(res.pageInfo?.totalItems ?? 0n) > LABEL_LOOKUP_LIMIT;
  if (id !== undefined && truncated && !found.some((order) => order.id === id)) {
    try {
      const detail = await orderClient.orderDetail({ teamId: warehouseId, orderId: id });
      if (detail.order) found.push(detail.order);
    } catch (err) {
      // Not this warehouse's, or no such order — the label is not it.
      if (!(err instanceof ConnectError && err.code === Code.NotFound)) throw err;
    }
  }

  return {
    live: found.filter((order) => order.status !== OrderStatus.CANCEL),
    cancelled: found.filter((order) => order.status === OrderStatus.CANCEL),
  };
}
