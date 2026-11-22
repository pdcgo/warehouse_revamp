import { useTranslation } from "react-i18next";
import { HStack, Stack, Text } from "@chakra-ui/react";

import type { RestockLog, RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockLogChangeField, RestockLogKind, RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { useFinancialAccountsByIds } from "../financialAccount/queries";
import { formatRupiahNumber } from "../../lib/money";
import { resolutionsOf } from "./resolutions";
import { ResolutionTypeBadge } from "./ResolutionSection";

// WHAT A SETTLEMENT ROW OF THE RIWAYAT NAMES (backlog #101 — the owner's 🔄 on a-restock-problem-is-settled-by-resolution-rows:
// real entries, one per resolution, per settle and per reopen, written when each happened and never rewritten). The row
// itself — who, when, the Root badge — is the trail's own step (RestockTimeline); this is its body:
//
//   RESOLUTION  the resolution it recorded (its id, the row's one change), read from the restock's `resolutions`: its
//               type, the refund's amount and account (the selling team only — a warehouse reader is answered none,
//               a-warehouse-sees-no-seller-money), or the parcel it rides; then its note
//   SETTLED     what settling did — the problem tags off, or off the Hilang tab
//   REOPENED    the inbound parcel whose Terima reopened it, and per product what was short and what broken
export function SettlementStep({
  log,
  request,
  teamId,
  testId,
}: {
  log: RestockLog;
  request: RestockRequest;
  teamId?: bigint;
  testId: string;
}) {
  const { t } = useTranslation();
  const resolutionId = log.changes.find((c) => c.field === RestockLogChangeField.RESOLUTION)?.after ?? "";
  const row = resolutionsOf(request).find((r) => r.id.toString() === resolutionId);
  const accounts = useFinancialAccountsByIds(teamId, row && row.refundAmount !== undefined ? [row.financeAccountId] : []);

  if (log.kind === RestockLogKind.SETTLED) {
    return (
      <Text fontSize="sm" data-testid={`${testId}-detail`}>
        {t(request.status === RestockRequestStatus.LOST ? "restockResolution.trail.settledDetailLost" : "restockResolution.trail.settledDetail")}
      </Text>
    );
  }

  if (log.kind === RestockLogKind.REOPENED) {
    const parcel = log.changes.find((c) => c.field === RestockLogChangeField.PARCEL)?.after ?? "";
    const counts = log.changes
      .filter((c) => c.field === RestockLogChangeField.PARCEL_SHORT || c.field === RestockLogChangeField.PARCEL_BROKEN)
      .map((c) =>
        t(c.field === RestockLogChangeField.PARCEL_SHORT ? "restockResolution.trail.short" : "restockResolution.trail.broken", {
          name: c.productName,
          count: Number(c.after),
        }),
      );

    return (
      <Stack gap="0.5" minW="0" data-testid={`${testId}-detail`}>
        <Text fontSize="sm">{t("restockResolution.trail.reopenedDetail", { id: parcel })}</Text>
        {counts.length > 0 && (
          <Text fontSize="sm" color="warning.fg" data-testid={`${testId}-counts`}>
            {counts.join(" · ")}
          </Text>
        )}
      </Stack>
    );
  }

  // RESOLUTION — a row the read does not carry (never expected: the detail carries every row) still says it was one.
  if (!row) return null;
  const what =
    row.type === "REFUND"
      ? row.refundAmount === undefined
        ? ""
        : t("restockResolution.row.refund", {
            amount: formatRupiahNumber(row.refundAmount),
            account: accounts.data?.get(row.financeAccountId.toString())?.name ?? t("restock.detail.accountRef", { id: row.financeAccountId.toString() }),
          })
      : t(row.type === "RETURN" ? "restockResolution.row.returnParcel" : "restockResolution.row.inboundParcel", {
          id: row.customShipmentId.toString(),
        });

  return (
    <Stack gap="0.5" minW="0" data-testid={`${testId}-detail`}>
      <HStack gap="2" wrap="wrap">
        <ResolutionTypeBadge type={row.type} />
        {what && <Text fontSize="sm">{what}</Text>}
      </HStack>
      {row.note && (
        <Text fontSize="sm" color="fg.muted" whiteSpace="pre-wrap" wordBreak="break-word" data-testid={`${testId}-note`}>
          {row.note}
        </Text>
      )}
    </Stack>
  );
}
