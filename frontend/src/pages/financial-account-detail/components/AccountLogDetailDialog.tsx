import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, CloseButton, Dialog, Flex, Portal, Separator, Stack, Text } from "@chakra-ui/react";

import type { FinancialAccountLog } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { BalanceText, ChangeText, ChangeTypeBadge } from "../../../features/financialAccount/badges";
import { BY_HAND } from "../../../features/financialAccount/vocab";
import { formatUnixDate } from "../../../lib/datetime";

// ONE STATEMENT ROW, WHOLE (owner: *"keterangan di mobile lebih baik dihidden saja, atau buat modal detail untuk
// mobile"*, `a-phone-statement-row-opens-its-detail`) — a phone's row is the date, the type and the money; what it
// leaves out is here: why, who, and when it was typed beside when the money moved.
export function AccountLogDetailDialog({
  log,
  onClose,
  actorName,
  describe,
}: {
  /** The row to show — none, closed. */
  log: FinancialAccountLog | undefined;
  onClose: () => void;
  actorName: (id: bigint) => string;
  describe: (text: string) => string;
}) {
  const { t } = useTranslation();

  return (
    <Dialog.Root open={log !== undefined} onOpenChange={(e) => !e.open && onClose()}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="account-log-detail">
            {log && (
              <>
                <Dialog.Header>
                  <Stack gap="0.5">
                    <Dialog.Title>{t("financialAccounts.log.detailTitle")}</Dialog.Title>
                    <Text fontSize="sm" color="fg.muted">
                      {log.occurredAt ? formatUnixDate(log.occurredAt.seconds) : "—"}
                    </Text>
                  </Stack>
                </Dialog.Header>

                <Dialog.Body>
                  <Stack gap="2.5">
                    <Flex justify="space-between" align="center" gap="3">
                      <ChangeTypeBadge changeType={log.changeType} />
                      <ChangeText change={log.change} />
                    </Flex>
                    <Line label={t("financialAccounts.log.balanceAfter")}>
                      <BalanceText balance={log.balanceAfter} bold testId="account-log-detail-balance" />
                    </Line>

                    <Separator />

                    <Stack gap="0.5">
                      <Text fontSize="sm" color="fg.muted">
                        {t("financialAccounts.log.description")}
                      </Text>
                      <Text fontSize="sm" data-testid="account-log-detail-description">
                        {describe(log.description)}
                      </Text>
                    </Stack>
                    <Line label={t("financialAccounts.log.by")}>
                      <Text fontSize="sm" textAlign="end" data-testid="account-log-detail-way">
                        {BY_HAND.has(log.changeType)
                          ? t("financialAccounts.log.byHand", { name: actorName(log.actorId) })
                          : t("financialAccounts.log.automatic")}
                      </Text>
                    </Line>
                    <Line label={t("financialAccounts.log.recorded")}>
                      <Text fontSize="sm" data-testid="account-log-detail-recorded">
                        {log.createdAt ? formatUnixDate(log.createdAt.seconds) : "—"}
                      </Text>
                    </Line>
                  </Stack>
                </Dialog.Body>

                <Dialog.Footer>
                  <Dialog.ActionTrigger asChild>
                    <Button variant="outline">{t("common.close")}</Button>
                  </Dialog.ActionTrigger>
                </Dialog.Footer>

                <Dialog.CloseTrigger asChild>
                  <CloseButton size="sm" />
                </Dialog.CloseTrigger>
              </>
            )}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Flex justify="space-between" align="baseline" gap="3">
      <Text fontSize="sm" color="fg.muted" flexShrink="0">
        {label}
      </Text>
      {children}
    </Flex>
  );
}
