import { useTranslation } from "react-i18next";
import { Stack, Table, Text } from "@chakra-ui/react";

import type { FinancialAccountLog } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { BalanceText, ChangeText, ChangeTypeBadge } from "../../../features/financialAccount/badges";
import { BY_HAND } from "../../../features/financialAccount/vocab";
import { formatUnixDate } from "../../../lib/datetime";

// The account's statement — newest first, in the order `balance_after` runs (the-log-says-balance-after).
//
// Each row says WHY in words (the-description-names-the-cause), and WHICH WAY it came in: a row a listener
// posted cannot be corrected here by hand — its cause is somewhere else — so the screen says so rather than
// leaving somebody to look for an edit button (one-way-in-per-type).
//
// The date is the day the money MOVED (occurred_at), not the day it was typed. When the two differ the row
// says when it was recorded, because a row dated last week that appeared today explains a balance that
// changed today.
export function AccountLogTable({
  logs,
  actorName,
}: {
  logs: FinancialAccountLog[];
  actorName: (id: bigint) => string;
}) {
  const { t } = useTranslation();

  if (logs.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted" data-testid="account-log-empty">
        {t("financialAccounts.log.empty")}
      </Text>
    );
  }

  return (
    <Table.ScrollArea>
      <Table.Root size="sm" data-testid="account-log-table">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("financialAccounts.log.date")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("financialAccounts.log.type")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("financialAccounts.log.description")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("financialAccounts.log.change")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("financialAccounts.log.balanceAfter")}</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {logs.map((log) => {
            const occurred = log.occurredAt ? formatUnixDate(log.occurredAt.seconds) : "—";
            const recorded = log.createdAt ? formatUnixDate(log.createdAt.seconds) : occurred;
            const byHand = BY_HAND.has(log.changeType);

            return (
              <Table.Row key={log.id.toString()} data-testid={`account-log-row-${log.id}`}>
                <Table.Cell whiteSpace="nowrap">
                  <Text fontSize="sm">{occurred}</Text>
                  {recorded !== occurred && (
                    <Text fontSize="xs" color="fg.muted" data-testid={`account-log-recorded-${log.id}`}>
                      {t("financialAccounts.log.recordedOn", { date: recorded })}
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <ChangeTypeBadge changeType={log.changeType} />
                </Table.Cell>
                <Table.Cell>
                  <Stack gap="0">
                    <Text fontSize="sm">{log.description}</Text>
                    <Text fontSize="xs" color="fg.muted" data-testid={`account-log-way-${log.id}`}>
                      {byHand
                        ? t("financialAccounts.log.byHand", { name: actorName(log.actorId) })
                        : t("financialAccounts.log.automatic")}
                    </Text>
                  </Stack>
                </Table.Cell>
                <Table.Cell textAlign="end">
                  <ChangeText change={log.change} />
                </Table.Cell>
                <Table.Cell textAlign="end">
                  <BalanceText balance={log.balanceAfter} />
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table.Root>
    </Table.ScrollArea>
  );
}
