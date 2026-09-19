import { Badge } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { OrderStatus } from "../../gen/warehouse/selling/v1/order_pb";

// The standard label + colour for each order status, in one place, so a status looks the same
// everywhere it is shown (#68).
//
// The label is an i18n KEY rather than the English word, and that is what lets the order list's status
// TABS carry the same names as the badges in the rows beneath them. Two hardcoded lists would have
// been two chances to call the same state different things on one screen.
function statusMeta(s: OrderStatus): { labelKey: string; color: string } {
  switch (s) {
    case OrderStatus.PLACED:
      return { labelKey: "orders.statusName.placed", color: "blue" };
    case OrderStatus.CONFIRMED:
      return { labelKey: "orders.statusName.confirmed", color: "green" };
    case OrderStatus.CANCELLED:
      return { labelKey: "orders.statusName.cancelled", color: "red" };

    // The warehouse's states (#150/#151). They share a palette on purpose: the three of them are one
    // journey through the building, and colouring each differently would suggest they are unrelated
    // outcomes rather than consecutive steps. The label carries which step.
    case OrderStatus.PICKING:
      return { labelKey: "orders.statusName.picking", color: "orange" };
    case OrderStatus.PACKED:
      return { labelKey: "orders.statusName.packed", color: "orange" };
    case OrderStatus.SHIPPED:
      return { labelKey: "orders.statusName.shipped", color: "purple" };
    default:
      return { labelKey: "orders.statusName.unknown", color: "gray" };
  }
}

// OrderStatusBadge renders an order's status as a Chakra Badge in its standard colour (#68).
export const description = "An order's status as a standard-coloured Chakra Badge (placed=blue, confirmed=green, cancelled=red; the warehouse's picking/packed steps share orange, shipped=purple).";

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useTranslation();
  const { labelKey, color } = statusMeta(status);

  return (
    <Badge colorPalette={color} data-testid={`order-status-${status}`}>
      {t(labelKey)}
    </Badge>
  );
}
