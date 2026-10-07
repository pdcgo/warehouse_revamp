import { useMemo, useState } from "react";
import { Heading, HStack, Stack, Text } from "@chakra-ui/react";
import { Download, Eye, Plus, Receipt } from "lucide-react";
import { ActionCell } from "../../components/cells/ActionCell";
import { DateCell } from "../../components/cells/DateCell";
import { StatisticCell } from "../../components/cells/StatisticCell";
import { ChoiceTabs } from "../../components/display/ChoiceTabs";
import { DataTable, type TableColumn, type TableSort } from "../../components/display/DataTable";
import { Summary } from "../../components/display/Summary";
import { Button } from "../../components/inputs/Button";
import { SearchInput } from "../../components/inputs/SearchInput";
import { Pagination } from "../../../components/chrome/Pagination";
import { formatRupiahCompact } from "../../../lib/money";
import type { InvoiceDirection, InvoiceRow, InvoiceStatus } from "../../financeFixtures";
import { InvoiceStatusBadge } from "./InvoiceStatusBadge";

// ── THE INVOICE LIST, ONCE ──────────────────────────────────────────────────────────────────────
//
// The legacy system has three of these — payable, receivable, and an admin view of payable across
// every team. They are the same screen with the DIRECTION flipped, and the direction changes exactly
// three things:
//
//   1. the word for the other party ("Supplier" vs "Customer"),
//   2. whether the outstanding total is money you OWE or money you are OWED,
//   3. whether creating an invoice from here makes sense (you raise what you are owed; what you owe
//      arrives from somebody else).
//
// Everything else — the status tabs, the ageing, the columns, the export — is identical. Porting
// them as three files is how one gains an ageing column the others never get.
export const description =
  "The invoice list, defined ONCE. Payable, receivable and the admin view are the same screen with the direction flipped — which changes the counterparty word, whether the total is owed or owing, and whether you may raise one from here.";

const STATUS_TABS: Array<{ value: InvoiceStatus | undefined; name: string }> = [
  { value: undefined, name: "All" },
  { value: "open", name: "Open" },
  { value: "partial", name: "Part paid" },
  { value: "overdue", name: "Overdue" },
  { value: "paid", name: "Paid" },
];

export interface InvoiceListScreenProps {
  direction: InvoiceDirection;
  title: string;
  invoices: InvoiceRow[];
  // The admin view spans every team, so it shows a team column and cannot raise invoices.
  showTeam?: boolean;
  canCreate?: boolean;
  loading?: boolean;
  isError?: boolean;
}

export function InvoiceListScreen({
  direction,
  title,
  invoices,
  showTeam,
  canCreate,
  loading,
  isError,
}: InvoiceListScreenProps) {
  const [status, setStatus] = useState<InvoiceStatus>();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<TableSort>();
  const [page, setPage] = useState(1);

  const counterpartyWord = direction === "payable" ? "Supplier" : "Customer";

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();

    return invoices.filter((inv) => {
      if (status && inv.status !== status) return false;
      if (!q) return true;
      return inv.code.toLowerCase().includes(q) || inv.counterparty.toLowerCase().includes(q);
    });
  }, [invoices, status, search]);

  const sorted = useMemo(() => {
    if (!sort?.key) return rows;
    const direction2 = sort.desc ? -1 : 1;

    return [...rows].sort((a, b) => {
      const value = (r: InvoiceRow) =>
        sort.key === "outstanding" ? r.total - r.paid : (r[sort.key as keyof InvoiceRow] ?? 0);
      const av = value(a);
      const bv = value(b);
      if (av === bv) return 0;
      return (av > bv ? 1 : -1) * direction2;
    });
  }, [rows, sort]);

  // Totals over EVERY invoice, not the filtered set — "how much is outstanding" must not change
  // because somebody opened the Paid tab.
  const totals = useMemo(() => {
    const outstanding = invoices
      .filter((i) => i.status !== "void" && i.status !== "paid")
      .reduce((sum, i) => sum + (i.total - i.paid), 0n);
    const overdue = invoices
      .filter((i) => i.status === "overdue")
      .reduce((sum, i) => sum + (i.total - i.paid), 0n);

    return { outstanding, overdue, count: invoices.length };
  }, [invoices]);

  const columns: Array<TableColumn<InvoiceRow>> = [
    {
      name: "Invoice",
      sortKey: "code",
      sticky: "left",
      render: (row) => (
        <Stack gap="0.5" lineHeight="short">
          <Text fontWeight="bold">{row.code}</Text>
          <Text fontSize="xs" color="fg.muted">
            {row.counterparty}
          </Text>
        </Stack>
      ),
    },
    ...(showTeam
      ? [{ name: "Team", render: () => <Text fontSize="sm">Gudang Utara</Text> } as TableColumn<InvoiceRow>]
      : []),
    { name: "Status", render: (row) => <InvoiceStatusBadge status={row.status} /> },
    { name: "Issued", sortKey: "issuedAt", render: (row) => <DateCell value={row.issuedAt} grain="date" /> },
    {
      name: "Due",
      sortKey: "dueAt",
      // Relative, deliberately: "in 3 days" is what decides whether to chase it today; a date makes
      // the reader do the arithmetic on every row.
      render: (row) => <DateCell value={row.dueAt} grain="relative" />,
    },
    {
      name: "Total",
      align: "end",
      sortKey: "total",
      render: (row) => <StatisticCell value={row.total} kind="price" compact />,
    },
    {
      name: "Outstanding",
      align: "end",
      sortKey: "outstanding",
      tooltip: "Total minus whatever has been paid against it.",
      render: (row) => <StatisticCell value={row.total - row.paid} kind="price" compact />,
    },
    {
      name: "",
      width: "1%",
      sticky: "right",
      render: () => (
        <ActionCell
          items={[
            { title: "View", icon: Eye },
            { title: "Record payment", icon: Receipt },
          ]}
        />
      ),
    },
  ];

  return (
    <Stack gap="section" data-testid="invoice-list-screen" data-direction={direction}>
      <HStack justify="space-between" wrap="wrap" gap="card">
        <Heading size="md">{title}</Heading>
        <HStack gap="2">
          <Button tone="plain" variant="outline" icon={Download}>
            Export
          </Button>
          {/* You raise what you are OWED; what you owe arrives from somebody else. */}
          {canCreate && (
            <Button icon={Plus} data-testid="invoice-create">
              New Invoice
            </Button>
          )}
        </HStack>
      </HStack>

      <Summary
        items={[
          {
            label: direction === "payable" ? "We owe" : "Owed to us",
            value: formatRupiahCompact(totals.outstanding),
            tone: "active",
          },
          { label: "Overdue", value: formatRupiahCompact(totals.overdue), tone: "error" },
          { label: "Invoices", value: totals.count },
        ]}
        loading={loading}
        columns={3}
      />

      <ChoiceTabs
        items={STATUS_TABS.map((t) => ({ value: t.value, name: t.name }))}
        value={status}
        onChange={(v) => {
          setStatus(v as InvoiceStatus | undefined);
          setPage(1);
        }}
      />

      <SearchInput
        value={search}
        onChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder={`Invoice code or ${counterpartyWord.toLowerCase()}`}
        maxW="72"
      />

      <DataTable
        columns={columns}
        items={sorted.slice((page - 1) * 20, page * 20)}
        loading={loading}
        isError={isError}
        sort={sort}
        onSort={setSort}
        headerSticky
        emptyTitle="No invoices here"
        emptyContent="Try another status tab, or clear the search."
        errorTitle="Could not load invoices"
        aria-label={title}
      />

      <Pagination count={sorted.length} page={page} pageSize={20} onPageChange={setPage} showRange />
    </Stack>
  );
}
