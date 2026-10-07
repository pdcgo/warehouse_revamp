import { useMemo, useState } from "react";
import { Heading, HStack, NativeSelect, Stack } from "@chakra-ui/react";
import { Download, Pencil, Plus, Trash2 } from "lucide-react";
import { ActionCell } from "../../components/cells/ActionCell";
import { DateCell } from "../../components/cells/DateCell";
import { StatisticCell } from "../../components/cells/StatisticCell";
import { DataTable, type TableColumn, type TableSort } from "../../components/display/DataTable";
import { Summary } from "../../components/display/Summary";
import { Button } from "../../components/inputs/Button";
import { SearchInput } from "../../components/inputs/SearchInput";
import { ToneBadge } from "../../components/badges/ToneBadge";
import { Pagination } from "../../../components/chrome/Pagination";
import { formatRupiahCompact } from "../../../lib/money";
import type { ExpenseRow } from "../../financeFixtures";

// Every expense, as a list you work with.
//
// The decision worth keeping: WHO PAID IT IS A COLUMN, not a detail. Most expenses here are paid out
// of somebody's own pocket and reimbursed later — a courier top-up, a box of tape — so "who is owed
// this back" is part of what an expense IS, not metadata about it. Burying it in a detail panel
// means opening every row to work out the month's reimbursements.
export const description =
  "Every expense as a working list. WHO PAID is a column rather than a detail — most of these are out of somebody's own pocket, so 'who is owed this back' is part of what the expense is.";

export interface AccountingExpenseListPageProps {
  expenses: ExpenseRow[];
  loading?: boolean;
  isError?: boolean;
}

export function AccountingExpenseListPage({
  expenses,
  loading,
  isError,
}: AccountingExpenseListPageProps) {
  const [category, setCategory] = useState<string>();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<TableSort>();
  const [page, setPage] = useState(1);

  const categories = useMemo(
    () => Array.from(new Set(expenses.map((e) => e.category))).sort(),
    [expenses],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();

    const filtered = expenses.filter((e) => {
      if (category && e.category !== category) return false;
      if (!q) return true;
      return e.memo.toLowerCase().includes(q) || e.paidBy.toLowerCase().includes(q);
    });

    if (!sort?.key) return filtered;
    const direction = sort.desc ? -1 : 1;

    return [...filtered].sort((a, b) => {
      const av = a[sort.key as keyof ExpenseRow] ?? 0;
      const bv = b[sort.key as keyof ExpenseRow] ?? 0;
      if (av === bv) return 0;
      return (av > bv ? 1 : -1) * direction;
    });
  }, [expenses, category, search, sort]);

  const total = expenses.reduce((s, e) => s + e.amount, 0n);

  const columns: Array<TableColumn<ExpenseRow>> = [
    { name: "When", sortKey: "at", render: (e) => <DateCell value={e.at} grain="date" /> },
    { name: "Category", render: (e) => <ToneBadge tone="plain">{e.category}</ToneBadge> },
    { name: "Memo", key: "memo" },
    // The reimbursement question, on the row.
    { name: "Paid by", key: "paidBy", sortKey: "paidBy" },
    {
      name: "Amount",
      align: "end",
      sortKey: "amount",
      render: (e) => <StatisticCell value={e.amount} kind="price" compact />,
    },
    {
      name: "",
      width: "1%",
      sticky: "right",
      render: () => (
        <ActionCell
          items={[
            { title: "Edit", icon: Pencil },
            { title: "Delete", icon: Trash2, tone: "error" },
          ]}
        />
      ),
    },
  ];

  return (
    <Stack gap="section" data-testid="expense-list-page">
      <HStack justify="space-between" wrap="wrap" gap="card">
        <Heading size="md">Expenses</Heading>
        <HStack gap="2">
          <Button tone="plain" variant="outline" icon={Download}>
            Export
          </Button>
          <Button icon={Plus} data-testid="expense-create">
            New Expense
          </Button>
        </HStack>
      </HStack>

      <Summary
        items={[
          { label: "Total", value: formatRupiahCompact(total), tone: "warning" },
          { label: "Entries", value: expenses.length },
          { label: "Categories", value: categories.length },
        ]}
        loading={loading}
        columns={3}
      />

      <HStack gap="card" wrap="wrap">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Memo or who paid"
          maxW="64"
        />

        <NativeSelect.Root width="44" data-testid="filter-category">
          <NativeSelect.Field
            placeholder="All categories"
            value={category ?? ""}
            onChange={(e) => {
              setCategory(e.target.value || undefined);
              setPage(1);
            }}
            aria-label="Category"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
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
        isError={isError}
        sort={sort}
        onSort={setSort}
        emptyTitle="No expenses"
        emptyContent="Try another category, or clear the search."
        errorTitle="Could not load expenses"
        aria-label="Expenses"
      />

      <Pagination count={rows.length} page={page} pageSize={20} onPageChange={setPage} showRange />
    </Stack>
  );
}
