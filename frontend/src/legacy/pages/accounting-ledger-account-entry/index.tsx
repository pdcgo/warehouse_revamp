import { useMemo, useState } from "react";
import { Heading, HStack, NativeSelect, Stack, Text } from "@chakra-ui/react";
import { Download } from "lucide-react";
import { DateCell } from "../../components/cells/DateCell";
import { StatisticCell } from "../../components/cells/StatisticCell";
import { DataTable, type TableColumn } from "../../components/display/DataTable";
import { Button } from "../../components/inputs/Button";
import { SearchInput } from "../../components/inputs/SearchInput";
import { PriceText } from "../../components/text/PriceText";
import { Pagination } from "../../../components/chrome/Pagination";
import type { LedgerEntryRow } from "../../financeFixtures";

// Every journal entry, filterable by account — the screen an accountant lives on.
//
// ⚠ ENTRIES ARE NEVER EDITED OR DELETED HERE, and there is deliberately no action column. A posted
// journal entry is a historical fact; correcting one means posting an ADJUSTMENT that references it,
// which is what the adjustment screen is for. A screen that let somebody quietly change a past entry
// would make the trial balance meaningless, because nothing would say the books had moved.
//
// Debit and credit stay separate columns for the same reason they do in the billing log: an entry IS
// one side or the other, and collapsing them loses which.
export const description =
  "Every journal entry, filterable by account. There is no edit and no delete — a posted entry is a historical fact, and correcting one means posting an adjustment that references it.";

export interface AccountingLedgerAccountEntryPageProps {
  entries: LedgerEntryRow[];
  loading?: boolean;
}

export function AccountingLedgerAccountEntryPage({
  entries,
  loading,
}: AccountingLedgerAccountEntryPageProps) {
  const [account, setAccount] = useState<string>();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const accounts = useMemo(
    () => Array.from(new Set(entries.map((e) => e.account))).sort(),
    [entries],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (account && e.account !== account) return false;
      if (!q) return true;
      return e.memo.toLowerCase().includes(q);
    });
  }, [entries, account, search]);

  const totals = rows.reduce(
    (acc, e) => ({ debit: acc.debit + e.debit, credit: acc.credit + e.credit }),
    { debit: 0n, credit: 0n },
  );

  const columns: Array<TableColumn<LedgerEntryRow>> = [
    { name: "When", render: (e) => <DateCell value={e.at} grain="datetime" /> },
    {
      name: "Account",
      render: (e) => (
        <Stack gap="0" lineHeight="short">
          <Text fontSize="sm">{e.account}</Text>
          <Text fontSize="xs" color="fg.muted">
            {e.accountCode}
          </Text>
        </Stack>
      ),
    },
    { name: "Memo", key: "memo" },
    {
      name: "Debit",
      align: "end",
      render: (e) => (e.debit > 0n ? <StatisticCell value={e.debit} kind="price" /> : null),
    },
    {
      name: "Credit",
      align: "end",
      render: (e) => (e.credit > 0n ? <StatisticCell value={e.credit} kind="price" /> : null),
    },
  ];

  return (
    <Stack gap="section" data-testid="ledger-entry-page">
      <HStack justify="space-between" wrap="wrap" gap="card">
        <Heading size="md">Journal entries</Heading>
        <Button tone="plain" variant="outline" icon={Download}>
          Export
        </Button>
      </HStack>

      <HStack gap="card" wrap="wrap">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Memo"
          maxW="64"
        />

        <NativeSelect.Root width="56" data-testid="filter-account">
          <NativeSelect.Field
            placeholder="All accounts"
            value={account ?? ""}
            onChange={(e) => {
              setAccount(e.target.value || undefined);
              setPage(1);
            }}
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
      </HStack>

      <DataTable
        columns={columns}
        items={rows.slice((page - 1) * 20, page * 20)}
        loading={loading}
        emptyTitle="No entries"
        emptyContent="Journal entries appear here as they are posted."
        aria-label="Journal entries"
      />

      {/* Both sides totalled for whatever is on screen — an accountant checking one account wants its
          two columns to agree with what they expected. */}
      <HStack justify="flex-end" gap="section" data-testid="ledger-totals">
        <Stack gap="0" align="flex-end">
          <Text fontSize="xs" color="fg.muted">
            Debits shown
          </Text>
          <PriceText amount={totals.debit} fontWeight="bold" />
        </Stack>
        <Stack gap="0" align="flex-end">
          <Text fontSize="xs" color="fg.muted">
            Credits shown
          </Text>
          <PriceText amount={totals.credit} fontWeight="bold" />
        </Stack>
      </HStack>

      <Pagination count={rows.length} page={page} pageSize={20} onPageChange={setPage} showRange />
    </Stack>
  );
}
