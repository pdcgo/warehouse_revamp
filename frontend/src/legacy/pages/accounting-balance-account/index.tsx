import { useMemo } from "react";
import { Heading, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { Landmark, Wallet } from "lucide-react";
import { Card } from "../../components/display/Card";
import { DataTable, type TableColumn } from "../../components/display/DataTable";
import { Statistic } from "../../components/display/Statistic";
import { StatisticCell } from "../../components/cells/StatisticCell";
import { ToneBadge } from "../../components/badges/ToneBadge";
import { Alert } from "../../components/display/Alert";
import { formatRupiahCompact } from "../../../lib/money";
import type { AccountBalanceRow } from "../../financeFixtures";

const KIND_LABEL = {
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  income: "Income",
  expense: "Expense",
} as const;

// The BALANCE SHEET view — what the business owns and owes, right now.
//
// ⚠ IT SHOWS EACH ACCOUNT'S NET BALANCE, NOT ITS DEBITS AND CREDITS. That is the difference from the
// trial balance, and it is the whole reason both screens exist: the trial balance is read to check
// the BOOKS are consistent; this is read to find out what the BUSINESS is worth. Somebody asking
// "how much cash do we have" wants one number per account, not two columns to subtract.
//
// The sign convention is applied here rather than shown: an asset's balance is debits minus credits,
// a liability's is the other way round, so every figure on this screen reads as a positive amount of
// the thing it is. A liability shown as negative is a screen that requires accounting training to
// read.
export const description =
  "What the business owns and owes — each account's NET balance, not its debit and credit columns. The trial balance checks the books are consistent; this says what the business is worth.";

export interface AccountingBalanceAccountPageProps {
  accounts: AccountBalanceRow[];
  loading?: boolean;
}

export function AccountingBalanceAccountPage({
  accounts,
  loading,
}: AccountingBalanceAccountPageProps) {
  // Debit-normal accounts (assets, expenses) net debit-minus-credit; credit-normal accounts
  // (liabilities, equity, income) net the other way. Applied here so every figure is positive.
  const withBalance = useMemo(
    () =>
      accounts.map((a) => ({
        ...a,
        balance:
          a.kind === "asset" || a.kind === "expense" ? a.debit - a.credit : a.credit - a.debit,
      })),
    [accounts],
  );

  const sumOf = (kind: AccountBalanceRow["kind"]) =>
    withBalance.filter((a) => a.kind === kind).reduce((s, a) => s + a.balance, 0n);

  const assets = sumOf("asset");
  const liabilities = sumOf("liability");
  const equity = sumOf("equity");

  // Assets = liabilities + equity. When it does not hold, the balance sheet is not a balance sheet.
  const balances = assets === liabilities + equity;

  const columns: Array<TableColumn<(typeof withBalance)[number]>> = [
    {
      name: "Account",
      sticky: "left",
      render: (row) => (
        <Stack gap="0" lineHeight="short">
          <Text fontSize="sm" fontWeight="medium">
            {row.name}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {row.code}
          </Text>
        </Stack>
      ),
    },
    { name: "Type", render: (row) => <ToneBadge tone="plain">{KIND_LABEL[row.kind]}</ToneBadge> },
    {
      name: "Balance",
      align: "end",
      tooltip: "Net of debits and credits, in the direction the account normally runs.",
      render: (row) => <StatisticCell value={row.balance} kind="price" />,
    },
  ];

  return (
    <Stack gap="section" data-testid="balance-account-page" data-balances={balances ? "true" : "false"}>
      <Heading size="md">Balances</Heading>

      {!balances && (
        <Alert tone="error" title="Assets do not equal liabilities plus equity" data-testid="balance-warning">
          Something is missing from the books. Check the trial balance before relying on anything here.
        </Alert>
      )}

      <SimpleGrid columns={{ base: 1, md: 3 }} gap="card">
        <Statistic title="Assets" icon={Landmark} tone="success" loading={loading}>
          {formatRupiahCompact(assets)}
        </Statistic>
        <Statistic title="Liabilities" icon={Wallet} tone="warning" loading={loading}>
          {formatRupiahCompact(liabilities)}
        </Statistic>
        <Statistic title="Equity" icon={Landmark} tone="info" loading={loading}>
          {formatRupiahCompact(equity)}
        </Statistic>
      </SimpleGrid>

      <Card table>
        <DataTable
          columns={columns}
          items={withBalance}
          loading={loading}
          emptyTitle="No accounts"
          aria-label="Account balances"
        />
      </Card>
    </Stack>
  );
}
