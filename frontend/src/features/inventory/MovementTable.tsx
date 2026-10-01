import { Stack, Table, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import type { MovementKind } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { formatRfc3339DateTime } from "../../lib/datetime";
import { kindLabel } from "./movementKind";

// THE stock ledger. One movement reads identically wherever it is shown — a warehouse product's
// history, a shelf's history, a batch's history — because it is one component, not three copies.
//
// It was three copies (warehouse-product, rack-detail, batch-detail), and they had already drifted:
// the same `created_at` rendered raw on one page, date-only on another and date+time on the third,
// and only one of them coloured the change column. That is the drift this file exists to stop.
//
// The SHAPE is fixed — When · What · <context> · Change · After — because every ledger answers the
// same five questions in the same order. Only the context columns vary, and they vary by what the
// page is about: a product's history names the PLACE, a shelf's history names the PRODUCT.

/**
 * A context column, shown between What and Change. Order is respected, so a caller lists them
 * left-to-right as they should read.
 *
 * - `by` — who did it (`actorNames`); a system movement with no actor shows an em dash.
 * - `batch` — which delivery the units came from; `#id`, em dash for a batch-less recount (#211).
 * - `place` — the rack CODE via `rackLabel`, not its id.
 * - `product` — the product via `productLabel`, falling back to `#id`.
 * - `warehouse` — which BUILDING (#232), via `warehouseLabel`. The catalogue owner's ledger spans
 *   several and has no racks in it at all: a shelf is the warehouse's unit of decision, a building is
 *   the owner's.
 */
export type MovementContextColumn = "by" | "batch" | "place" | "product" | "warehouse";

/**
 * What this table needs from a ledger row (#232).
 *
 * Widened from `StockMovement` when the catalogue owner's ledger arrived: it is a different message
 * (OwnerMovement) answering the same five questions, and the alternative was a second copy of this
 * table — the exact drift the file header describes. StockMovement satisfies it as-is; the owner's
 * rows are mapped at the query boundary.
 */
export interface MovementRow {
  id: bigint;
  /** RFC3339. The owner's ledger carries a unix instant and converts on the way in. */
  createdAt: string;
  kind: MovementKind;
  delta: bigint;
  balance: bigint;
  actorUserId: bigint;
  batchId: bigint;
  productId: bigint;
  /** Absent on a ledger that has no shelves in it — see the `warehouse` column. */
  rackId?: bigint;
  warehouseId?: bigint;
}

export interface MovementTableProps {
  movements: MovementRow[];
  /**
   * BASE testid, not the table's own: the table is `${testId}-table` and the empty note is
   * `${testId}-empty`. One convention, because two of the three ledgers already used it and a
   * per-page convention is how a selector ends up asserting on the wrong element.
   */
  testId: string;
  /** Context columns between What and Change. Empty renders the bare five-question shape. */
  columns?: MovementContextColumn[];
  /**
   * Header for the balance column, passed in and NOT canonical — deliberately.
   *
   * All three ledgers read the same `balance` field and all three mean something different by it: a
   * batch's ready units ("Ready after"), one shelf's count ("On shelf after"), or a place's balance
   * ("After"). #135 is precisely the bug of showing one as the other, so the wording that says WHICH
   * number this is stays with the page that knows.
   */
  afterLabel: string;
  /** Shown instead of rows when there are none. Page-specific: a shelf, a batch and a product each
   *  have their own honest way of saying "nothing happened here". */
  emptyText: string;
  /** Required by the `by` column. */
  actorNames?: Map<string, string>;
  /** Required by the `place` column. */
  rackLabel?: (rackId: bigint) => string;
  /** Used by the `warehouse` column; without it a warehouse shows as `#id`. */
  warehouseLabel?: (warehouseId: bigint) => string;
  /** Used by the `product` column; without it a product shows as `#id`. */
  productLabel?: (productId: bigint) => string;
  striped?: boolean;
}

export function MovementTable({
  movements,
  testId,
  columns = [],
  afterLabel,
  emptyText,
  actorNames,
  rackLabel,
  warehouseLabel,
  productLabel,
  striped,
}: MovementTableProps) {
  const { t } = useTranslation();

  const header: Record<MovementContextColumn, string> = {
    by: t("inventory.movement.by"),
    batch: t("inventory.movement.batch"),
    place: t("inventory.movement.place"),
    product: t("inventory.movement.product"),
    warehouse: t("inventory.movement.warehouse"),
  };

  function cell(column: MovementContextColumn, m: MovementRow) {
    switch (column) {
      case "by":
        // A movement the system made on its own has no actor, and an em dash says that better than
        // a "#0" nobody can look up.
        return m.actorUserId > 0n
          ? actorNames?.get(m.actorUserId.toString()) ?? `#${m.actorUserId}`
          : "—";
      case "batch":
        // A batch-less shelf recount lands on the oldest batch by FIFO but names none (#211).
        return m.batchId > 0n ? `#${m.batchId}` : "—";
      case "place":
        if (m.rackId === undefined) return "—";
        return rackLabel ? rackLabel(m.rackId) : `#${m.rackId}`;
      case "product":
        return productLabel ? productLabel(m.productId) : `#${m.productId}`;
      case "warehouse":
        if (m.warehouseId === undefined) return "—";
        return warehouseLabel ? warehouseLabel(m.warehouseId) : `#${m.warehouseId}`;
    }
  }

  return (
    <Stack gap="card">
      <Table.Root size="sm" striped={striped} data-testid={`${testId}-table`}>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("inventory.movement.when")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("inventory.movement.what")}</Table.ColumnHeader>
            {columns.map((c) => (
              <Table.ColumnHeader key={c}>{header[c]}</Table.ColumnHeader>
            ))}
            <Table.ColumnHeader textAlign="end">
              {t("inventory.movement.change")}
            </Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{afterLabel}</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>

        <Table.Body>
          {movements.map((m) => (
            <Table.Row key={m.id.toString()} data-testid={`${testId}-row-${m.id}`}>
              <Table.Cell>{formatRfc3339DateTime(m.createdAt)}</Table.Cell>
              <Table.Cell>{kindLabel(t, m.kind)}</Table.Cell>
              {columns.map((c) => (
                <Table.Cell key={c}>{cell(c, m)}</Table.Cell>
              ))}
              {/* Signed AND coloured: +9 and -9 are different events, so the sign carries the fact and
                  the colour makes a page of them scannable. Zero gets neither — a movement that moved
                  nothing is not an increase. */}
              <Table.Cell
                textAlign="end"
                color={m.delta > 0n ? "green.fg" : m.delta < 0n ? "red.fg" : undefined}
              >
                {m.delta > 0n ? `+${m.delta}` : m.delta.toString()}
              </Table.Cell>
              <Table.Cell textAlign="end">{m.balance.toString()}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>

      {movements.length === 0 && (
        <Text color="fg.muted" data-testid={`${testId}-empty`}>
          {emptyText}
        </Text>
      )}
    </Stack>
  );
}
