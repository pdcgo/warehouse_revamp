import { useMemo, useState } from "react";
import { Heading, HStack, NativeSelect, Stack, Text } from "@chakra-ui/react";
import { Download } from "lucide-react";
import { DateCell } from "../../components/cells/DateCell";
import { StatisticCell } from "../../components/cells/StatisticCell";
import { DataTable, type TableColumn } from "../../components/display/DataTable";
import { Summary } from "../../components/display/Summary";
import { Button } from "../../components/inputs/Button";
import { PriceText } from "../../components/text/PriceText";
import { formatRupiahCompact } from "../../../lib/money";
import type { LedgerEntryRow } from "../../financeFixtures";

// MUTATIONS on one account — how its balance changed, movement by movement, with a running total.
//
// It is the bridge between the two balance screens: the balance view says an account is at 128
// million, the journal says what was posted; only this says HOW IT GOT THERE. When somebody asks why
// the bank account is lower than they expected, this is the screen that answers it.
//
// ⚠ THE RUNNING BALANCE MUST BE COMPUTED IN ORDER, AND THE ORDER IS OLDEST FIRST. Every other list
// in this system shows newest first, which is right for a queue — but a running total accumulated
// newest-first is arithmetic nobody can follow. This is the one screen that deliberately reverses
// the house default, and it says so rather than looking like an oversight.
export const description =
  "How one account's balance changed, movement by movement, with a running total. Deliberately OLDEST FIRST — every other list here is newest-first, but a running total accumulated backwards is arithmetic nobody can follow.";

export interface AccountingBalanceMutationPageProps {
  entries: LedgerEntryRow[];
  loading?: boolean;
}

export function AccountingBalanceMutationPage({
  entries,
  loading,
}: AccountingBalanceMutationPageProps) {
  const accounts = useMemo(
    () => Array.from(new Set(entries.map((e) => e.account))).sort(),
    [entries],
  );
  const [account, setAccount] = useState<string>(accounts[0] ?? "");

  const rows = useMemo(() => {
    // Oldest first — see the note above.
    const forAccount = entries
      .filter((e) => !account || e.account === account)
      .sort((a, b) => Number(a.at - b.at));

    let running = 0n;
    return forAccount.map((e) => {
      running += e.debit - e.credit;
      return { ...e, running };
    });
  }, [entries, account]);

  const closing = rows.length > 0 ? rows[rows.length - 1].running : 0n;

  const columns: Array<TableColumn<(typeof rows)[number]>> = [
    { name: "When", render: (e) => <DateCell value={e.at} grain="datetime" /> },
    { name: "Memo", key: "memo" },
    {
      name: "In",
      align: "end",
      render: (e) => (e.debit > 0n ? <StatisticCell value={e.debit} kind="price" /> : null),
    },
    {
      name: "Out",
      align: "end",
      render: (e) => (e.credit > 0n ? <StatisticCell value={e.credit} kind="price" /> : null),
    },
    {
      name: "Balance after",
      align: "end",
      tooltip: "What the account stood at once this movement was posted.",
      render: (e) => <PriceText amount={e.running} fontWeight="medium" data-testid="mutation-running" />,
    },
  ];

  return (
    <Stack gap="section" data-testid="balance-mutation-page">
      <HStack justify="space-between" wrap="wrap" gap="card">
        <Heading size="md">Account mutations</Heading>
        <Button tone="plain" variant="outline" icon={Download}>
          Export
        </Button>
      </HStack>

      <HStack gap="card" wrap="wrap">
        <NativeSelect.Root width="56" data-testid="filter-account">
          <NativeSelect.Field
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            aria-label="Account"
          >
            {accounts.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>

        <Text fontSize="sm" color="fg.muted" data-testid="mutation-order-note">
          Oldest first, so the running balance reads downward.
        </Text>
      </HStack>

      <Summary
        items={[
          { label: "Movements", value: rows.length },
          { label: "Closing balance", value: formatRupiahCompact(closing), tone: "active" },
        ]}
        loading={loading}
        columns={2}
      />

      <DataTable
        columns={columns}
        items={rows}
        loading={loading}
        emptyTitle="No movements on this account"
        aria-label="Account mutations"
      />
    </Stack>
  );
}
