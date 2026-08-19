import { useState } from "react";
import { Button, HStack, Icon, Stack, Text } from "@chakra-ui/react";
import { Plus, Wallet } from "lucide-react";
import { ChoiceTabs } from "../../../legacy/components/display/ChoiceTabs";
import { DataTable, type TableColumn } from "../../../legacy/components/display/DataTable";
import { DateCell } from "../../../legacy/components/cells/DateCell";
import { PriceText } from "../../../legacy/components/text/PriceText";
import { Summary } from "../../../legacy/components/display/Summary";
import { ToneBadge } from "../../../legacy/components/badges/ToneBadge";
import { ScreenHeader } from "../../components/display/ScreenHeader";
import type { CashEntry } from "../../fixtures";

// ── THE CASH BOOK ───────────────────────────────────────────────────────────────────────────────
//
// Petty cash at the warehouse: packaging, meals for an overtime shift, a courier refund. Small
// amounts, recorded by whoever spent them.
//
// ⚠ IT IS ON THE FLOOR APP AND NOT IN THE ACCOUNTING SYSTEM, AND THAT IS THE INTERESTING PART.
//
// The person who bought the bubble wrap is standing in the warehouse holding a receipt. Any design
// that makes them record it somewhere else — a finance screen, a form they need a login for, a
// spreadsheet on someone's laptop — produces the same outcome: it is recorded at the end of the
// week from memory, or not at all. Putting it where they already are is the entire reason the
// numbers exist.
//
// ⚠ AND "UNCATEGORISED" IS A REAL CATEGORY, NOT A GAP.
//
// The alternative to allowing it is a required field, and a required field on a screen somebody is
// using one-handed produces a wrong category, not a right one. Better to accept the entry and make
// the uncategorised total visible enough that somebody fixes it later — an entry with a bad category
// is invisible; an entry in "Uncategorised" is a task.
export const description =
  "Petty cash, recorded on the floor app rather than in a finance system — because the person holding the receipt is standing in the warehouse. 'Uncategorised' is allowed and then made visible, since a required field produces a wrong answer, not a right one.";

export type CashFilter = "all" | "in" | "out";

export interface CashBookPageProps {
  entries: CashEntry[];
  filter?: CashFilter;
  loading?: boolean;
}

export function CashBookPage({ entries, filter: initial = "all", loading }: CashBookPageProps) {
  const [filter, setFilter] = useState<CashFilter>(initial);

  const rows = filter === "all" ? entries : entries.filter((e) => e.kind === filter);

  const totalIn = entries.filter((e) => e.kind === "in").reduce((s, e) => s + e.amount, 0);
  const totalOut = entries.filter((e) => e.kind === "out").reduce((s, e) => s + e.amount, 0);
  const uncategorised = entries.filter((e) => e.category === "Uncategorised");

  const columns: Array<TableColumn<CashEntry>> = [
    { name: "Date", render: (row) => <DateCell value={row.at} grain="date" /> },
    {
      name: "Direction",
      render: (row) => (
        <ToneBadge tone={row.kind === "in" ? "success" : "plain"}>{row.kind === "in" ? "In" : "Out"}</ToneBadge>
      ),
    },
    {
      name: "Category",
      render: (row) => (
        <Text
          fontSize="sm"
          color={row.category === "Uncategorised" ? "fg.warning" : undefined}
          data-testid={row.category === "Uncategorised" ? "uncategorised" : undefined}
        >
          {row.category}
        </Text>
      ),
    },
    {
      name: "Amount",
      align: "end",
      render: (row) => (
        <PriceText
          amount={BigInt(row.amount)}
          addon={row.kind === "out" ? "-" : undefined}
          // ⚠ EXACT, NOT COMPACTED. "Rp 1,5jt" is unusable here: reconciling a cash box means
          // matching this figure against a receipt to the rupiah, and a rounded number cannot be
          // matched against anything.
          minCompact={BigInt("9999999999999")}
        />
      ),
    },
    {
      // The note is what makes the entry auditable a month later. It is a column, not a hover.
      name: "Note",
      render: (row) => (
        <Text fontSize="sm" color="fg.muted" maxW="72" lineClamp={2}>
          {row.note || "No note"}
        </Text>
      ),
    },
    { name: "Recorded by", key: "by" },
  ];

  return (
    <Stack gap="section" p="page" data-testid="cash-book-page">
      <ScreenHeader
        icon={Wallet}
        title="Cash book"
        actions={
          <Button size="xs" data-testid="add-entry">
            <Icon as={Plus} boxSize="4" />
            Record
          </Button>
        }
      />

      <Summary
        columns={3}
        loading={loading}
        items={[
          { label: "In", value: <PriceText amount={BigInt(totalIn)} />, tone: "success" },
          { label: "Out", value: <PriceText amount={BigInt(totalOut)} />, tone: "warning" },
          {
            label: "Uncategorised",
            value: uncategorised.length,
            tone: uncategorised.length ? "error" : "plain",
          },
        ]}
      />

      <HStack>
        <ChoiceTabs
          value={filter}
          onChange={(v) => v && setFilter(v)}
          items={[
            { value: "all" as const, name: "All" },
            { value: "in" as const, name: "In" },
            { value: "out" as const, name: "Out" },
          ]}
        />
      </HStack>

      <DataTable
        columns={columns}
        items={rows}
        loading={loading}
        emptyTitle="Nothing recorded"
        aria-label="Cash book"
        data-testid="cash-table"
      />
    </Stack>
  );
}
