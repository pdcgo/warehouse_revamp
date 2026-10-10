import { Badge } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { WarehouseTransferStatus } from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";

// The standard label key + colour for each warehouse transfer status, in one place. A status is a LIFECYCLE STEP, so
// its colour is categorical — it tells the steps apart rather than saying good or bad: waiting for the sender (blue),
// being picked (purple), on the road (cyan), at the receiver's door — its next job (orange), counted in (green), and
// the two ends it never reached (lost red, cancelled gray). The journey is a-transfer-has-seven-statuses.
function statusMeta(s: WarehouseTransferStatus): { key: string; color: string } {
  switch (s) {
    case WarehouseTransferStatus.CREATED:
      return { key: "warehouseTransfer.status.created", color: "blue" };
    case WarehouseTransferStatus.PROCESS:
      return { key: "warehouseTransfer.status.process", color: "purple" };
    case WarehouseTransferStatus.SHIPPED:
      return { key: "warehouseTransfer.status.shipped", color: "cyan" };
    case WarehouseTransferStatus.ARRIVED:
      return { key: "warehouseTransfer.status.arrived", color: "orange" };
    case WarehouseTransferStatus.ACCEPTED:
      return { key: "warehouseTransfer.status.accepted", color: "green" };
    case WarehouseTransferStatus.LOST:
      return { key: "warehouseTransfer.status.lost", color: "red" };
    case WarehouseTransferStatus.CANCELLED:
      return { key: "warehouseTransfer.status.cancelled", color: "gray" };
    default:
      return { key: "warehouseTransfer.status.unspecified", color: "gray" };
  }
}

export const description =
  "A warehouse transfer's status as a standard-coloured Chakra Badge — created=blue, process=purple, shipped=cyan, arrived=orange, accepted=green, lost=red, cancelled=gray. Labels are translated.";

// THE way to show a transfer status — the lists, the tabs and the detail pages all render through it.
export function WarehouseTransferStatusBadge({ status }: { status: WarehouseTransferStatus }) {
  const { t } = useTranslation();
  const { key, color } = statusMeta(status);

  return (
    <Badge colorPalette={color} data-testid={`transfer-status-${status}`}>
      {t(key)}
    </Badge>
  );
}
