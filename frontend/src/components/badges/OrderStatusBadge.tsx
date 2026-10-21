import { Badge } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";

// THE ELEVEN STATUSES, named and coloured in ONE place, so a status looks the same everywhere it is shown
// (#68) — the status diagram's own (the-status-move-is-the-only-journey), in its order.
//
// The label is an i18n KEY rather than the English word, and that is what lets the order list's status
// TABS carry the same names as the badges in the rows beneath them. Two hardcoded lists would have been
// two chances to call the same state different things on one screen.
//
// ⚠ EVERY HUE IS THE OWNER'S, and they are CATEGORICAL — a hue, never a role: they tell steps apart, they do
// not say good or bad. Eight were given on 2026-09-24 (status-colours-are-carried-over-verbatim), the rest
// on 2026-10-21:
//
//   picked              sky, with processed — both are the order inside the building
//   shipping            cyan — handed to the courier; sky → cyan → blue runs in journey order
//                       (shipping-is-cyan-and-picked-is-sky)
//   return              red — claimed, coming back, nothing settled
//   return_completed    pink — Retur Diterima's colour, moved with its meaning
//                       (pink-follows-retur-diterima-to-return-completed)
//
// ⚠ `lost` SHARES `problem`'s purple, and `cancel` shares the app's rose accent — both raised and kept by
// the owner. Do not "fix" either.
export type OrderStatusId =
  | "pending"
  | "processed"
  | "picked"
  | "shipping"
  | "shipped"
  | "completed"
  | "problem"
  | "lost"
  | "return"
  | "return_completed"
  | "cancel";

export interface OrderStatusMeta {
  status: OrderStatus;
  id: OrderStatusId;
  color: string;
}

/** Every status, in the status diagram's order: the journey, then its ways off. */
export const ORDER_STATUSES: OrderStatusMeta[] = [
  { status: OrderStatus.PENDING, id: "pending", color: "amber" },
  { status: OrderStatus.PROCESSED, id: "processed", color: "sky" },
  { status: OrderStatus.PICKED, id: "picked", color: "sky" },
  { status: OrderStatus.SHIPPING, id: "shipping", color: "cyan" },
  { status: OrderStatus.SHIPPED, id: "shipped", color: "blue" },
  { status: OrderStatus.COMPLETED, id: "completed", color: "green" },
  { status: OrderStatus.PROBLEM, id: "problem", color: "purple" },
  { status: OrderStatus.LOST, id: "lost", color: "purple" },
  { status: OrderStatus.RETURN, id: "return", color: "red" },
  { status: OrderStatus.RETURN_COMPLETED, id: "return_completed", color: "pink" },
  { status: OrderStatus.CANCEL, id: "cancel", color: "rose" },
];

/** A status's id and colour — undefined for UNSPECIFIED or a value this build does not know. */
export function orderStatusMeta(status: OrderStatus): OrderStatusMeta | undefined {
  return ORDER_STATUSES.find((item) => item.status === status);
}

/** The i18n key of a status's name. */
export function orderStatusLabelKey(status: OrderStatus): string {
  const meta = orderStatusMeta(status);

  return meta ? `orders.stage.${meta.id}` : "orders.stage.unknown";
}

// OrderStatusBadge renders an order's status as a Chakra Badge in its standard colour (#68).
export const description =
  "An order's status as a standard-coloured Chakra Badge — the eleven of the status diagram, each in the owner's hue (pending amber; processed and picked sky; shipping cyan; shipped blue; completed green; problem and lost purple; return red; return_completed pink; cancel rose). A screen whose tabs use other names for the same states passes `label`, so the badge in the row reads what the tab above it says — the colour stays the status's.";

export function OrderStatusBadge({
  status,
  label,
}: {
  status: OrderStatus;
  /**
   * The name to show instead of the status's own — the warehouse reads PENDING as "Perlu konfirmasi",
   * because that is what its tab is called (`the-warehouse-tabs-are-the-processed-steps`). The colour
   * stays the status's, so a status still looks the same everywhere.
   */
  label?: string;
}) {
  const { t } = useTranslation();
  const color = orderStatusMeta(status)?.color ?? "gray";

  return (
    <Badge colorPalette={color} data-testid={`order-status-${status}`}>
      {label ?? t(orderStatusLabelKey(status))}
    </Badge>
  );
}
