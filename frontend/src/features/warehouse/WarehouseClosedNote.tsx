import { Badge, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { formatUnixDateTimeShort } from "../../lib/datetime";
import { useWarehouseReceiving } from "./queries";

// WAREHOUSE CLOSED NOW (a-closed-day-warns-and-never-refuses, a-warehouse-records-its-holidays) — a warning, never a
// refusal: an order is created whatever the hours say, and this says when the warehouse will handle it. Nothing while it
// receives. `compact` is the picker's badge; otherwise the band's sentence, with a closure's reason when one is why.
export function WarehouseClosedNote({ warehouseId, compact }: { warehouseId: bigint; compact?: boolean }) {
  const { t } = useTranslation();
  const query = useWarehouseReceiving(warehouseId);
  const state = query.data;

  if (!state || state.receivingNow) {
    return null;
  }

  const next = state.nextOpeningUnix > 0n ? formatUnixDateTimeShort(state.nextOpeningUnix) : "";

  if (compact) {
    return (
      <Badge colorPalette="warning" size="sm" data-testid={`warehouse-closed-badge-${warehouseId}`}>
        {t("warehouseHours.closedBadge")}
      </Badge>
    );
  }

  const sentence = state.closureReason
    ? next
      ? t("warehouseHours.closedForUntil", { reason: state.closureReason, next })
      : t("warehouseHours.closedFor", { reason: state.closureReason })
    : next
      ? t("warehouseHours.closedUntil", { next })
      : t("warehouseHours.closed");

  return (
    <Text fontSize="xs" color="warning.fg" data-testid="warehouse-closed-note">
      {sentence}
    </Text>
  );
}
