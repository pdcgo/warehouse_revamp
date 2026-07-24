import { Badge } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { RestockRequestStatus } from "../gen/warehouse/inventory/v1/restock_request_pb";

// The standard label key + colour for each restock status, in one place, so a status looks the same
// everywhere it is shown (#125). PENDING is the actionable state (blue), FULFILLED is a positive
// terminal state (green), CANCELLED is inert (gray).
//
// Unlike OrderStatusBadge, the label is an i18n KEY, not English: this badge was lifted out of
// RestockRequestsPage, which already translated its statuses, and a shared component must not
// silently drop that.
function statusMeta(s: RestockRequestStatus): { key: string; color: string } {
  switch (s) {
    case RestockRequestStatus.PENDING:
      return { key: "restock.status.pending", color: "blue" };
    case RestockRequestStatus.FULFILLED:
      return { key: "restock.status.fulfilled", color: "green" };
    case RestockRequestStatus.CANCELLED:
      return { key: "restock.status.cancelled", color: "gray" };
    default:
      return { key: "restock.status.unspecified", color: "gray" };
  }
}

// RestockStatusBadge renders a restock request's status as a Chakra Badge in its standard colour.
// This is THE way to show a restock status — the list and the detail page both render through it.
export const description =
  "A restock request's status as a standard-coloured Chakra Badge (pending=blue, fulfilled=green, cancelled=gray). Labels are translated.";

export function RestockStatusBadge({ status }: { status: RestockRequestStatus }) {
  const { t } = useTranslation();
  const { key, color } = statusMeta(status);

  return (
    <Badge colorPalette={color} data-testid={`restock-status-${status}`}>
      {t(key)}
    </Badge>
  );
}
