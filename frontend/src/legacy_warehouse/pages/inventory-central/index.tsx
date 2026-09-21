import { useState } from "react";
import { HStack, Input, Stack, Text } from "@chakra-ui/react";
import { Boxes } from "lucide-react";
import { DataTable, type TableColumn } from "../../../legacy/components/display/DataTable";
import { DateCell } from "../../../legacy/components/cells/DateCell";
import { Summary } from "../../../legacy/components/display/Summary";
import { RackChip } from "../../components/display/RackChip";
import { ScreenHeader } from "../../components/display/ScreenHeader";
import type { InventoryRow } from "../../fixtures";

// ── THE INVENTORY CENTRE ────────────────────────────────────────────────────────────────────────
//
// What is in the building, where it is, and what state it is in. The screen somebody opens to answer
// "do we have it, and can we get to it".
//
// ⚠ ON HAND IS NOT THE SAME AS AVAILABLE, AND CONFLATING THEM IS THE CLASSIC WAREHOUSE BUG.
//
//   on hand    physically here
//   reserved   here, but already promised to an order that has not shipped
//   damaged    here, and not sellable
//   available  on hand − reserved − damaged   ← the only one that answers "can I sell it"
//
// The original shows on hand as the headline number. That reads as "we have 142" when 12 are
// promised and 2 are broken, and the shortfall is discovered by a picker at the shelf. Available is
// the column that belongs in the position the eye lands on.
//
// ⚠ AND STOCK WITH NO RACK IS AVAILABLE ON PAPER AND UNREACHABLE IN FACT. It counts, the numbers
// balance, and no picker can find it — see RackChip. It is called out rather than left to be
// noticed.
export const description =
  "What is in the building and where. Available (on hand − reserved − damaged) is the headline, not on hand — and unshelved stock is called out, because it counts on paper and cannot be found in fact.";

export interface InventoryPageProps {
  rows: InventoryRow[];
  loading?: boolean;
}

export function InventoryPage({ rows, loading }: InventoryPageProps) {
  const [search, setSearch] = useState("");

  const filtered = rows.filter(
    (r) =>
      !search ||
      r.product.toLowerCase().includes(search.toLowerCase()) ||
      r.sku.toLowerCase().includes(search.toLowerCase()),
  );

  const available = (r: InventoryRow) => r.onHand - r.reserved - r.damaged;

  const unshelved = rows.filter((r) => !r.rack);
  const totalOnHand = rows.reduce((s, r) => s + r.onHand, 0);
  const totalAvailable = rows.reduce((s, r) => s + available(r), 0);
  const totalDamaged = rows.reduce((s, r) => s + r.damaged, 0);

  const columns: Array<TableColumn<InventoryRow>> = [
    {
      name: "Product",
      sticky: "left",
      render: (row) => (
        <Stack gap="0" maxW="64">
          <Text fontSize="sm" lineClamp={1}>
            {row.product}
          </Text>
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            {row.sku}
          </Text>
        </Stack>
      ),
    },
    { name: "Team", key: "team" },
    { name: "Rack", render: (row) => <RackChip rack={row.rack} /> },
    {
      // The headline. Placed first among the numbers, because it is the one that answers the
      // question the reader came with.
      name: "Available",
      align: "end",
      tooltip: "On hand minus what is reserved and what is damaged. The only number you can sell.",
      render: (row) => (
        <Text fontSize="sm" fontWeight="semibold" color={available(row) <= 0 ? "fg.error" : undefined}>
          {available(row)}
        </Text>
      ),
    },
    { name: "On hand", key: "onHand", align: "end", tooltip: "Physically in the building, including reserved and damaged." },
    { name: "Reserved", key: "reserved", align: "end", tooltip: "Promised to an order that has not shipped." },
    {
      name: "Damaged",
      align: "end",
      render: (row) => (
        <Text fontSize="sm" color={row.damaged > 0 ? "fg.warning" : "fg.muted"}>
          {row.damaged}
        </Text>
      ),
    },
    {
      // ⚠ HOW OLD THE COUNT IS, not whether one happened. A SKU last counted a month ago is a number
      // nobody should be making promises on, and "never counted" is worse — but both look identical
      // to a fresh count unless the date is on the row.
      name: "Last counted",
      tooltip: "A number nobody has checked in weeks is a guess.",
      render: (row) => <DateCell value={row.lastCountedAt} grain="date" fallback="Never" />,
    },
  ];

  return (
    <Stack gap="section" p="page" data-testid="inventory-page">
      <ScreenHeader icon={Boxes} title="Inventory centre" />

      <Summary
        columns={4}
        loading={loading}
        items={[
          { label: "Available", value: totalAvailable, tone: "success" },
          { label: "On hand", value: totalOnHand },
          { label: "Damaged", value: totalDamaged, tone: "warning" },
          // Counted as its own figure, because it is the one that silently breaks picking.
          { label: "SKUs unshelved", value: unshelved.length, tone: unshelved.length ? "error" : "plain" },
        ]}
      />

      <HStack>
        <Input
          size="sm"
          w="72"
          placeholder="Product or SKU"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          aria-label="Search inventory"
          data-testid="inventory-search"
        />
      </HStack>

      <DataTable
        columns={columns}
        items={filtered}
        loading={loading}
        emptyTitle={search ? "No products match" : "Nothing in stock"}
        aria-label="Inventory"
        data-testid="inventory-table"
      />
    </Stack>
  );
}
