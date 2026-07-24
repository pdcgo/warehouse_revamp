import { Badge } from "@chakra-ui/react";
import { OrderStatus } from "../gen/warehouse/selling/v1/order_pb";

// The standard label + colour for each order status, in one place, so a status looks the same
// everywhere it is shown (#68).
function statusMeta(s: OrderStatus): { label: string; color: string } {
  switch (s) {
    case OrderStatus.PLACED:
      return { label: "Placed", color: "blue" };
    case OrderStatus.CONFIRMED:
      return { label: "Confirmed", color: "green" };
    case OrderStatus.CANCELLED:
      return { label: "Cancelled", color: "red" };

    // The warehouse's states (#150/#151). They share a palette on purpose: the three of them are one
    // journey through the building, and colouring each differently would suggest they are unrelated
    // outcomes rather than consecutive steps. The label carries which step.
    case OrderStatus.PICKING:
      return { label: "Picking", color: "orange" };
    case OrderStatus.PACKED:
      return { label: "Packed", color: "orange" };
    case OrderStatus.SHIPPED:
      return { label: "Shipped", color: "purple" };
    default:
      return { label: "Unknown", color: "gray" };
  }
}

// OrderStatusBadge renders an order's status as a Chakra Badge in its standard colour (#68).
export const description = "An order's status as a standard-coloured Chakra Badge (placed=blue, confirmed=green, cancelled=red; the warehouse's picking/packed steps share orange, shipped=purple).";

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { label, color } = statusMeta(status);

  return (
    <Badge colorPalette={color} data-testid={`order-status-${status}`}>
      {label}
    </Badge>
  );
}
