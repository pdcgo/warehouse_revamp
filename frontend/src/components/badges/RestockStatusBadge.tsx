import { Badge } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";

// The standard label key + colour for each restock status, in one place, so a status looks the same everywhere it is
// shown. A status here is a LIFECYCLE STEP, so its colour is categorical — it tells the steps apart rather than saying
// good or bad: on its way (blue), at the door waiting to be counted (orange — the warehouse's next job), counted in
// (green), and the two ends it never reached (lost red, cancelled gray). The journey is
// the-warehouse-signs-and-accepts-the-team-does-the-rest.
function statusMeta(s: RestockRequestStatus): { key: string; color: string } {
  switch (s) {
    case RestockRequestStatus.ONGOING:
      return { key: "restock.status.ongoing", color: "blue" };
    case RestockRequestStatus.ARRIVED:
      return { key: "restock.status.arrived", color: "orange" };
    case RestockRequestStatus.ACCEPTED:
      return { key: "restock.status.accepted", color: "green" };
    case RestockRequestStatus.LOST:
      return { key: "restock.status.lost", color: "red" };
    case RestockRequestStatus.CANCELLED:
      return { key: "restock.status.cancelled", color: "gray" };
    default:
      return { key: "restock.status.unspecified", color: "gray" };
  }
}

// RestockStatusBadge renders a restock's status as a Chakra Badge in its standard colour. This is THE way to show a
// restock status — the lists, the tabs' badges and the detail pages all render through it.
export const description =
  "A restock's status as a standard-coloured Chakra Badge — ongoing=blue, arrived=orange, accepted=green, lost=red, cancelled=gray. Labels are translated.";

export function RestockStatusBadge({ status }: { status: RestockRequestStatus }) {
  const { t } = useTranslation();
  const { key, color } = statusMeta(status);

  return (
    <Badge colorPalette={color} data-testid={`restock-status-${status}`}>
      {t(key)}
    </Badge>
  );
}
