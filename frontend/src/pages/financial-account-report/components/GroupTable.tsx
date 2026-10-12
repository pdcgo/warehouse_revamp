import { useTranslation } from "react-i18next";
import { Badge, HStack, Table, Text } from "@chakra-ui/react";

import type { AccountGroupBy, AccountReportGroupRow } from "../../../features/financialAccount/analytics";
import { BalanceText, ChangeTypeBadge, ProviderBadge } from "../../../features/financialAccount/badges";
import { type FinancialAccount, FinancialAccountStatus } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { signed } from "./MetricColumns";

const keyId = (key: AccountReportGroupRow["key"]) => `${key.case}-${String(key.value)}`;

// The ranking — accounts, providers or change types, by how much they moved in the window.
//
// An account row names itself and its provider, and an ARCHIVED one is marked rather than dropped: its
// past still happened (account-grouped-joins-the-metrics). A change type has no balance — a balance belongs
// to an account — so its rows show the movement alone.
export function GroupTable({
  groupBy,
  rows,
  accountOf,
}: {
  groupBy: AccountGroupBy;
  rows: AccountReportGroupRow[];
  accountOf: (id: bigint) => FinancialAccount | undefined;
}) {
  const { t } = useTranslation();
  const balances = groupBy !== "changeType";

  if (rows.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted" data-testid="account-report-groups-empty">
        {t("financialAccounts.report.empty")}
      </Text>
    );
  }

  return (
    <Table.ScrollArea>
      <Table.Root size="sm" data-testid="account-report-groups">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t(`financialAccounts.report.by.${groupBy}`)}</Table.ColumnHeader>
            {balances && <Table.ColumnHeader textAlign="end">{t("financialAccounts.report.open")}</Table.ColumnHeader>}
            <Table.ColumnHeader textAlign="end">{t("financialAccounts.report.change")}</Table.ColumnHeader>
            {balances && <Table.ColumnHeader textAlign="end">{t("financialAccounts.report.close")}</Table.ColumnHeader>}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map((row) => (
            <Table.Row key={keyId(row.key)} data-testid={`account-report-group-${keyId(row.key)}`}>
              <Table.Cell>
                <GroupName rowKey={row.key} accountOf={accountOf} />
              </Table.Cell>
              {balances && (
                <Table.Cell textAlign="end">
                  <BalanceText balance={row.metric.openBalance} />
                </Table.Cell>
              )}
              <Table.Cell textAlign="end">
                <Text fontSize="sm" fontWeight="medium">
                  {signed(row.metric.change)}
                </Text>
              </Table.Cell>
              {balances && (
                <Table.Cell textAlign="end">
                  <BalanceText balance={row.metric.closeBalance} />
                </Table.Cell>
              )}
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Table.ScrollArea>
  );
}

function GroupName({
  rowKey,
  accountOf,
}: {
  rowKey: AccountReportGroupRow["key"];
  accountOf: (id: bigint) => FinancialAccount | undefined;
}) {
  const { t } = useTranslation();

  if (rowKey.case === "provider") return <ProviderBadge provider={rowKey.value} />;
  if (rowKey.case === "changeType") return <ChangeTypeBadge changeType={rowKey.value} />;
  if (rowKey.case !== "accountId") return null;

  const account = accountOf(rowKey.value);
  if (!account) return <Text fontSize="sm">#{rowKey.value.toString()}</Text>;

  return (
    <HStack gap="2">
      <Text fontSize="sm">{account.name}</Text>
      <ProviderBadge provider={account.provider} />
      {account.status === FinancialAccountStatus.ARCHIVED && <Badge colorPalette="gray">{t("financialAccounts.archived")}</Badge>}
    </HStack>
  );
}
