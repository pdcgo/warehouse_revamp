import type { OrderStatResponse } from "../../gen/warehouse/selling/v1/order_pb";
import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";

// What the header above the order list needs, derived from OrderStat's census in ONE place.
//
// The server returns the raw per-status census and the 30-day money, and nothing else. Everything the
// tiles show beyond that — the work-queue groupings and the average order — is arithmetic over those
// numbers, done HERE rather than server-side: a tile that adds up rows the reader can also see cannot
// disagree with them, whereas a second server-computed figure could drift the moment either
// definition moved.
export interface OrderStatSummary {
  /** count per status; a status with no orders is absent from the response and reads as 0 here. */
  count: (status: OrderStatus) => number;
  /** Placed — nobody on the selling side has accepted these yet. */
  toConfirm: number;
  /** Confirmed, picking or packed — handed over, not yet gone. */
  inWarehouse: number;
  /** Shipped — out of the building. */
  shipped: number;
  orders30d: number;
  revenue30d: bigint;
  /** revenue ÷ orders, whole rupiah. 0 when there were no orders — never a division by zero. */
  avgOrder: bigint;
}

// The statuses that mean "the warehouse has this". CONFIRMED is in here deliberately: the selling side
// has finished with it and it is waiting on the crew, which is the same answer to "who is this
// sitting with" as picking and packed.
const IN_WAREHOUSE = [OrderStatus.CONFIRMED, OrderStatus.PICKING, OrderStatus.PACKED];

export function summariseOrderStat(res: OrderStatResponse | undefined): OrderStatSummary {
  const counts = new Map<OrderStatus, number>();

  for (const row of res?.byStatus ?? []) {
    counts.set(row.status, Number(row.count));
  }

  const count = (status: OrderStatus) => counts.get(status) ?? 0;

  const orders30d = Number(res?.preview?.orders30d ?? 0n);
  const revenue30d = res?.preview?.revenue30d ?? 0n;

  return {
    count,
    toConfirm: count(OrderStatus.PLACED),
    inWarehouse: IN_WAREHOUSE.reduce((sum, s) => sum + count(s), 0),
    shipped: count(OrderStatus.SHIPPED),
    orders30d,
    revenue30d,
    avgOrder: orders30d > 0 ? revenue30d / BigInt(orders30d) : 0n,
  };
}
