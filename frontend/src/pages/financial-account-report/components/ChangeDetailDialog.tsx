import { useTranslation } from "react-i18next";
import { Button, CloseButton, Dialog, Flex, Portal, Separator, Stack, Text } from "@chakra-ui/react";

import type { Metric } from "../../../features/financialAccount/analytics";
import { ChangeTypeBadge } from "../../../features/financialAccount/badges";
import { CHANGE_TYPES } from "../../../features/financialAccount/vocab";
import { dateInputToUnix, formatUnixDate } from "../../../lib/datetime";
import { formatRupiahNumber } from "../../../lib/money";
import { FIELD_OF } from "./MetricColumns";
import { SignedAmount } from "./ReportSummary";

// WHAT THE NET CHANGE IS MADE OF (owner: *"perubahan bersih, kasih modal detail, penarikan modal restock dsb itu"*) —
// every change type that moved, what came in first (largest first), then what went out, summing to the net change;
// and the arithmetic it closes: opening balance + net change = closing balance.
//
// Opened from "Rincian ›" on the Perubahan bersih card — never from the card, a card is not a control
// (financial_accounts_decision.md, `the-accounts-page-has-no-banners`).
export function ChangeDetailDialog({
  open,
  onOpenChange,
  metric,
  from,
  to,
  scope,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metric: Metric | undefined;
  from: string;
  to: string;
  /** Whose money — the whole team, or the account the filter picked. */
  scope: string;
}) {
  const { t } = useTranslation();

  const moved = metric
    ? CHANGE_TYPES.map((type) => ({ type, amount: metric[FIELD_OF[type]!] }))
        .filter((x) => x.amount !== 0)
        .sort((a, b) => (a.amount > 0 === b.amount > 0 ? Math.abs(b.amount) - Math.abs(a.amount) : a.amount > 0 ? -1 : 1))
    : [];

  return (
    <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="change-detail">
            <Dialog.Header>
              <Stack gap="0.5">
                <Dialog.Title>{t("financialAccounts.report.changeDetail")}</Dialog.Title>
                <Text fontSize="sm" color="fg.muted">
                  {from === to
                    ? formatUnixDate(dateInputToUnix(from, false))
                    : `${formatUnixDate(dateInputToUnix(from, false))} – ${formatUnixDate(dateInputToUnix(to, false))}`}{" "}
                  · {scope}
                </Text>
              </Stack>
            </Dialog.Header>

            <Dialog.Body>
              {moved.length === 0 ? (
                <Text fontSize="sm" color="fg.muted">
                  {t("financialAccounts.report.empty")}
                </Text>
              ) : (
                <Stack gap="2.5">
                  {moved.map((x) => (
                    <Flex key={x.type} justify="space-between" align="center" gap="3" data-testid={`change-detail-${x.type}`}>
                      <ChangeTypeBadge changeType={x.type} />
                      <Text fontSize="sm">
                        <SignedAmount amount={x.amount} />
                      </Text>
                    </Flex>
                  ))}

                  <Separator />

                  <Flex justify="space-between" align="center" gap="3">
                    <Text fontSize="sm" fontWeight="bold">
                      {t("financialAccounts.report.change")}
                    </Text>
                    <Text fontSize="sm" fontWeight="bold" data-testid="change-detail-total">
                      <SignedAmount amount={metric!.change} />
                    </Text>
                  </Flex>
                  <Text fontSize="xs" color="fg.muted" textAlign="end" data-testid="change-detail-bridge">
                    {t("financialAccounts.report.open")} {formatRupiahNumber(metric!.openBalance)} → {t("financialAccounts.report.close")}{" "}
                    {formatRupiahNumber(metric!.closeBalance)}
                  </Text>
                </Stack>
              )}
            </Dialog.Body>

            <Dialog.Footer>
              <Dialog.ActionTrigger asChild>
                <Button variant="outline">{t("common.close")}</Button>
              </Dialog.ActionTrigger>
            </Dialog.Footer>

            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
