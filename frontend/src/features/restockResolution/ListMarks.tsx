import { useTranslation } from "react-i18next";
import { Badge, HStack, Icon } from "@chakra-ui/react";
import { BadgeCheck, ListChecks } from "lucide-react";

import type { RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";

// HOW A PROBLEM OR LOST RESTOCK READS ON THE SELLER'S LIST once resolutions are recorded (backlog #101, the accepted
// prototype's *the seller's lists* row): *N resolusi* while it is still open, *Selesai* once the seller marked it settled
// — from the list row's own `resolution_count` and settled mark. In the Status column — it is where the restock's problem
// stands (one-context-per-column-and-never-three-lines) — beside the status badge on the cell's FIRST line: the second
// holds *kurang N* / *rusak N*, the wider one, so the column does not grow. On a phone block it rides the status line.
/**
 * `compact` (the desktop table): an open restock's mark is the icon and the count, its words in the tooltip — *Diterima*
 * and the full *2 resolusi* together are wider than the *kurang 1 · rusak 2* under them and would widen the column, which
 * already scrolls at 1440 (measured). A phone block has the room, so it says the words.
 */
export function ResolutionMark({ request, compact = false }: { request: RestockRequest; compact?: boolean }) {
  const { t } = useTranslation();
  if (request.status !== RestockRequestStatus.ACCEPTED && request.status !== RestockRequestStatus.LOST) return null;

  const count = request.resolutionCount;
  if (request.settledAtUnix > 0n) {
    return (
      <Badge colorPalette="success" data-testid={`restock-settled-${request.id}`}>
        <HStack gap="1">
          <Icon as={BadgeCheck} boxSize="3" />
          {t("restockResolution.settledBadge")}
        </HStack>
      </Badge>
    );
  }
  if (count === 0) return null;

  return (
    <Badge
      variant="outline"
      colorPalette="gray"
      title={t("restockResolution.countBadge", { count })}
      aria-label={t("restockResolution.countBadge", { count })}
      data-testid={`restock-resolutions-${request.id}`}
    >
      <HStack gap="1">
        <Icon as={ListChecks} boxSize="3" />
        {compact ? count : t("restockResolution.countBadge", { count })}
      </HStack>
    </Badge>
  );
}
