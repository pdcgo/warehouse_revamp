import { useMemo } from "react";
import { Heading, HStack, Stack, Text } from "@chakra-ui/react";
import { Download } from "lucide-react";
import { StatisticCell } from "../../components/cells/StatisticCell";
import { Alert } from "../../components/display/Alert";
import { DataTable, type TableColumn } from "../../components/display/DataTable";
import { Button } from "../../components/inputs/Button";
import { ToneBadge } from "../../components/badges/ToneBadge";
import { PriceText } from "../../components/text/PriceText";
import type { AccountBalanceRow } from "../../financeFixtures";

const KIND_LABEL = {
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  income: "Income",
  expense: "Expense",
} as const;

// The TRIAL BALANCE — every account, its debits and its credits, and whether the two sides agree.
//
// ⚠ THE SCREEN'S ENTIRE JOB IS THE LAST LINE. A trial balance is not read account by account; it is
// read to find out whether total debits equal total credits, because if they do not, something is
// wrong with the books and nothing else on any accounting screen can be trusted until it is found.
//
// So the balanced/unbalanced verdict is stated in words at the TOP as well as totalled at the
// bottom — putting it only in a footer means scrolling a hundred accounts to learn that the number
// you already looked at was meaningless.
//
// The difference is shown when it does not balance. "Out by Rp 240.000" is a searchable amount; "not
// balanced" is a fact you then have to do arithmetic to act on.
export const description =
  "Every account's debits and credits, and whether the two sides agree. The verdict is stated at the TOP as well as the bottom — a hundred accounts is a long way to scroll to learn the figures cannot be trusted.";

export interface AccountingTrialBalancePageProps {
  accounts: AccountBalanceRow[];
  loading?: boolean;
}

export function AccountingTrialBalancePage({
  accounts,
  loading,
}: AccountingTrialBalancePageProps) {
  const totals = useMemo(
    () =>
      accounts.reduce(
        (acc, a) => ({ debit: acc.debit + a.debit, credit: acc.credit + a.credit }),
        { debit: 0n, credit: 0n },
      ),
    [accounts],
  );

  const balanced = totals.debit === totals.credit;
  const difference = totals.debit > totals.credit ? totals.debit - totals.credit : totals.credit - totals.debit;

  const columns: Array<TableColumn<AccountBalanceRow>> = [
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
      name: "Debit",
      align: "end",
      render: (row) => (row.debit > 0n ? <StatisticCell value={row.debit} kind="price" /> : null),
    },
    {
      name: "Credit",
      align: "end",
      render: (row) => (row.credit > 0n ? <StatisticCell value={row.credit} kind="price" /> : null),
    },
  ];

  return (
    <Stack gap="section" data-testid="trial-balance-page" data-balanced={balanced ? "true" : "false"}>
      <HStack justify="space-between" wrap="wrap" gap="card">
        <Heading size="md">Trial balance</Heading>
        <Button tone="plain" variant="outline" icon={Download}>
          Export
        </Button>
      </HStack>

      {/* The verdict, at the top. */}
      {balanced ? (
        <Alert tone="success" title="The books balance" data-testid="trial-verdict">
          Total debits equal total credits.
        </Alert>
      ) : (
        <Alert tone="error" title="The books do not balance" data-testid="trial-verdict">
          {/* ⚠ EXACT, never compacted. This is the figure somebody types into a ledger search to
              find the entry that caused it — "Rp 240rb" is unsearchable, and rounding the amount you
              are hunting for is worse than not showing it. */}
          Debits and credits differ by{" "}
          <PriceText amount={difference} minCompact={BigInt(Number.MAX_SAFE_INTEGER)} fontWeight="bold" />.
          Until this is found, no figure on any accounting screen can be relied on.
        </Alert>
      )}

      <DataTable
        columns={columns}
        items={accounts}
        loading={loading}
        emptyTitle="No accounts"
        aria-label="Trial balance"
      />

      {/* And totalled at the bottom, where a trial balance is conventionally read. */}
      <HStack justify="flex-end" gap="section" data-testid="trial-totals">
        <Stack gap="0" align="flex-end">
          <Text fontSize="xs" color="fg.muted">
            Total debits
          </Text>
          <PriceText amount={totals.debit} fontWeight="bold" />
        </Stack>
        <Stack gap="0" align="flex-end">
          <Text fontSize="xs" color="fg.muted">
            Total credits
          </Text>
          <PriceText amount={totals.credit} fontWeight="bold" />
        </Stack>
      </HStack>
    </Stack>
  );
}
