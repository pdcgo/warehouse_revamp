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
    default:
      return { label: "Unknown", color: "gray" };
  }
}

// OrderStatusBadge renders an order's status as a Chakra Badge in its standard colour (#68).
export const description = "An order's status as a standard-coloured Chakra Badge (placed=blue, confirmed=green, cancelled=red).";

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { label, color } = statusMeta(status);

  return (
    <Badge colorPalette={color} data-testid={`order-status-${status}`}>
      {label}
    </Badge>
  );
}
