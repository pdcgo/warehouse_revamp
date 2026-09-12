import { HStack, Stack, Text } from "@chakra-ui/react";
import { DataTable, type TableColumn } from "../../../legacy/components/display/DataTable";
import { DateCell } from "../../../legacy/components/cells/DateCell";
import { CopyText } from "../../../legacy/components/text/CopyText";
import { MovementStatusBadge } from "../../components/badges/MovementStatusBadge";
import type { MovementDirection } from "../../status";
import type { MovementRow } from "../../fixtures";

// ── ONE TABLE, THREE DIRECTIONS ─────────────────────────────────────────────────────────────────
//
// Inbound, returns and outbound are the same table asked a different question. The original writes
// them out separately — three files, three header arrays — and they have already drifted: only one
// of them shows the arrival date, and the SKU column is headed "SKU" in one and "Produk" in another.
//
// The differences that are REAL are these, and they are the props:
//
//   direction  — which vocabulary the status column reads with (status.ts: the same key means
//                "arrived" going in and "left" going out)
//   arrival    — inbound and returns have a second date, the day the goods actually landed.
//                Outbound does not: the equivalent is the courier's problem, not the warehouse's.
//
// Everything else is shared, which is the point of extracting it.
export const description =
  "The movement table, shared by inbound / returns / outbound. Only two things genuinely differ between them — the status vocabulary and whether there is an arrival date — and both are props.";

export interface MovementTableProps {
  direction: MovementDirection;
  rows: MovementRow[];
  loading?: boolean;
  selectable?: boolean;
  emptyTitle?: string;
}

export function MovementTable({ direction, rows, loading, emptyTitle }: MovementTableProps) {
  const columns: Array<TableColumn<MovementRow>> = [
    {
      name: "Reference",
      sticky: "left",
      render: (row) => (
        <Stack gap="0">
          <Text fontFamily="mono" fontSize="sm">
            {row.ref}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {row.team}
          </Text>
        </Stack>
      ),
    },
    {
      name: "Product",
      render: (row) => (
        <Stack gap="0" maxW="60">
          <Text fontSize="sm" lineClamp={1}>
            {row.product}
          </Text>
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            {row.sku}
          </Text>
        </Stack>
      ),
    },
    { name: "Units", key: "units", align: "end" },
    {
      name: "Waybill",
      // ⚠ COPYABLE, NOT JUST READABLE. A waybill is retyped into a courier's tracking site many
      // times a day, and a fifteen-digit code retyped by hand is a code entered wrong.
      render: (row) => (
        <HStack gap="2">
          <CopyText copyText={row.awb}>{row.awb}</CopyText>
          <Text fontSize="xs" color="fg.muted">
            {row.courier}
          </Text>
        </HStack>
      ),
    },
    { name: "Handler", key: "handler" },
    {
      name: "Status",
      render: (row) => <MovementStatusBadge direction={direction} status={row.status} />,
    },
    { name: "Created", render: (row) => <DateCell value={row.createdAt} grain="datetime" /> },
    // Inbound knows when the goods landed; outbound does not have an equivalent the warehouse owns.
    {
      name: "Arrived",
      hidden: direction === "outbound",
      render: (row) => <DateCell value={row.arrivedAt} grain="date" />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      items={rows}
      loading={loading}
      emptyTitle={emptyTitle ?? "Nothing here yet"}
      aria-label={`${direction} movements`}
      data-testid="movement-table"
    />
  );
}
