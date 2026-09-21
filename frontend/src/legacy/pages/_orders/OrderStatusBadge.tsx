import { ToneBadge } from "../../components/badges/ToneBadge";
import type { Tone } from "../../components/tone";
import type { OrderStatus } from "../../fixtures";

// The STANDARD tone for each order status, shared by every screen in the order family.
//
// It lives under `pages/_orders/` rather than in `legacy/components/`: it is shared by several
// screens of ONE domain, which is the `features/` case in this app's placement rule. Promoting it to
// the design system would make it look app-wide when it is keyed to the legacy status vocabulary.
//
// ⚠ NOT the same as `components/badges/OrderStatusBadge` in the live system — that one is keyed to
// this repo's own `OrderStatus` enum. Two vocabularies, deliberately not merged: merging them would
// mean inventing a mapping between two systems' state machines, which is a design decision and not a
// rendering one.
//
// The grouping is by WHAT THE OPERATOR MUST DO:
//   active   — work is outstanding (created, packing) → the accent, because these are the queue
//   success  — it left and arrived (shipped, delivered)
//   error    — it came back or vanished (returned, lost) → loud; these need someone to act
//   plain    — nothing to do (draft, cancelled)
function statusTone(status: OrderStatus): Tone {
  switch (status) {
    case "created":
    case "packing":
      return "active";
    case "shipped":
      return "info";
    case "delivered":
      return "success";
    case "returned":
    case "lost":
      return "error";
    default:
      return "plain";
  }
}

const LABEL: Record<OrderStatus, string> = {
  draft: "Draft",
  created: "New",
  packing: "Packing",
  shipped: "Shipped",
  delivered: "Delivered",
  returned: "Returned",
  cancelled: "Cancelled",
  lost: "Lost",
};

export const description =
  "An order's status in its standard tone, grouped by what the operator must DO — outstanding work in the accent, returns and losses loud, nothing-to-do neutral.";

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <ToneBadge tone={statusTone(status)} data-testid={`order-status-${status}`}>
      {LABEL[status]}
    </ToneBadge>
  );
}
