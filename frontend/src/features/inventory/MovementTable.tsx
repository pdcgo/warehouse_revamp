import type { ElementType, ReactNode } from "react";
import { HStack, Stack, Table, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ActorName, RootTeamBadge } from "../../components/entity/ActorName";
import { useIsMobile } from "../../layouts/shell";
import type { MovementKind } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { formatRfc3339DateTimeShort } from "../../lib/datetime";
import { formatRupiah, formatSignedRupiah } from "../../lib/money";
import { kindLabel, transactionLabel } from "./movementKind";

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
 * A PRICE CORRECTION a row stands for (a revaluation — the-owning-team-revalues-with-a-reason, BatchRevalue): no unit
 * moved, the batch's price went from → to, the units left were worth `valueDelta` more or less, and somebody said why.
 * The history reads fill it from the row's MOVEMENT_KIND_REVALUATION fields (features/inventory/priceChange.ts).
 */
export interface PriceChange {
  from: number;
  to: number;
  /** units left × (to − from): the stock value's change. */
  valueDelta: number;
  reason: string;
  actorName: string;
  /** Root or the System Administrator, outside the owning team (an-override-shows-a-platform-badge). */
  isOverride: boolean;
}

/**
 * A RECEIVED-COUNT CORRECTION a row stands for (a-wrong-stock-in-is-a-received-count-correction) — an `adjustment` that
 * moved units, said as *Jumlah terima dikoreksi · from → to* with why and who. Read from the row's
 * `received_count_correction` at the query boundary (features/receivedCount/corrections.ts `countCorrectionOf`).
 */
export interface CountCorrection {
  from: bigint;
  to: bigint;
  reason: string;
  actorName: string;
  isOverride: boolean;
}

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
  /** A price correction, not a unit movement — see PriceChange. Absent on every other row. */
  priceChange?: PriceChange;
  /** A received-count correction (see CountCorrection). Absent on every other row. */
  countCorrection?: CountCorrection;
  /** RFC3339. The owner's ledger carries a unix instant and converts on the way in. */
  createdAt: string;
  kind: MovementKind;
  delta: bigint;
  balance: bigint;
  actorUserId: bigint;
  /** The movement's transaction was an override — Root or the System Administrator, outside the team. */
  isOverride?: boolean;
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
  /**
   * OPT-IN, per screen: with an icon the empty ledger is an `EmptyHint` — the icon, `emptyText` as its title and this
   * line under it (an-empty-list-shows-a-hint) — its rows light up under the pointer (a-table-row-lights-up), and on a
   * phone each movement is two lines instead of a table wider than the screen (a-phone-reads-each-line-as-a-block). A
   * screen takes all three the day it is reworked; without the icon it keeps the plain grey line, resting rows and the
   * table.
   */
  emptyIcon?: ElementType;
  emptyDescription?: ReactNode;
  /** Required by the `by` column. */
  actorNames?: Map<string, string>;
  /** Required by the `place` column. */
  rackLabel?: (rackId: bigint) => string;
  /** Used by the `warehouse` column; without it a warehouse shows as `#id`. */
  warehouseLabel?: (warehouseId: bigint) => string;
  /** Used by the `product` column; without it a product shows as `#id`. */
  productLabel?: (productId: bigint) => string;
  striped?: boolean;
  /**
   * HOW THE KIND IS SAID. `warehouse` (the default) names what happened at the shelf — Diterima, Diambil — under
   * *Kegiatan*: the warehouse's own screens. `transaction` names the transaction that moved the stock — Restok, Pesanan —
   * under *Transaksi*: the product's pages, read by the selling team (owner: *"diterima diambil itu type transaksi
   * harusnya"*, the-product-history-names-the-transaction).
   */
  wording?: "warehouse" | "transaction";
}

export function MovementTable({
  movements,
  testId,
  columns = [],
  afterLabel,
  emptyText,
  emptyIcon,
  emptyDescription,
  actorNames,
  rackLabel,
  warehouseLabel,
  productLabel,
  striped,
  wording = "warehouse",
}: MovementTableProps) {
  const { t } = useTranslation();
  const kindWord = (kind: MovementKind) => (wording === "transaction" ? transactionLabel(t, kind) : kindLabel(t, kind));
  // A price correction is said as one, whatever the screen's wording — it moved no unit, so neither a shelf's word nor a
  // stock transaction's fits.
  const kindOf = (m: MovementRow) =>
    m.priceChange
      ? t("correctPrice.history.kind")
      : m.countCorrection
        ? t("receivedCount.history.kind")
        : kindWord(m.kind);
  const isMobile = useIsMobile();
  // A reworked screen's ledger — the hint, the lit rows and the phone's lines come together (see `emptyIcon`).
  const reworked = emptyIcon !== undefined;

  const header: Record<MovementContextColumn, string> = {
    by: t("inventory.movement.by"),
    batch: t("inventory.movement.batch"),
    place: t("inventory.movement.place"),
    product: t("inventory.movement.product"),
    warehouse: t("inventory.movement.warehouse"),
  };

  function cell(column: MovementContextColumn, m: MovementRow) {
    switch (column) {
      case "by": {
        // A movement the system made on its own has no actor, and an em dash says that better than
        // a "#0" nobody can look up.
        if (m.actorUserId <= 0n) return "—";

        const name = actorNames?.get(m.actorUserId.toString()) ?? `#${m.actorUserId}`;

        // The shared ActorName: an override carries the "by Root team" badge beside the name
        // (an-override-shows-a-platform-badge) — every stock ledger with a By column at once.
        return <ActorName name={name} isOverride={m.isOverride} size={isMobile ? "xs" : "sm"} />;
      }
      case "batch":
        // A batch-less shelf recount lands on the oldest batch by FIFO but names none (#211).
        return m.batchId > 0n ? `#${m.batchId}` : "—";
      case "place":
        // A price correction touched no rack (revaluation-and-opname-are-transaction-types: no rack row).
        if (m.rackId === undefined || m.priceChange) return "—";
        return rackLabel ? rackLabel(m.rackId) : `#${m.rackId}`;
      case "product":
        return productLabel ? productLabel(m.productId) : `#${m.productId}`;
      case "warehouse":
        if (m.warehouseId === undefined) return "—";
        return warehouseLabel ? warehouseLabel(m.warehouseId) : `#${m.warehouseId}`;
    }
  }

  // A PRICE CORRECTION'S OWN LINES (the-correct-price-prototype-is-accepted): the price it went from and to, and why and
  // by whom — the reason cut to the room there is, the name and its badge never (ActorName's own inline box would vanish whole in a cut
  // line, so the name is text and the badge beside it).
  const priceLine = (c: PriceChange, testId: string) => (
    <Text as="span" fontSize="xs" color="fg.muted" fontVariantNumeric="tabular-nums" data-testid={`${testId}-price`}>
      {formatRupiah(c.from)} → {formatRupiah(c.to)}
    </Text>
  );
  const whyLine = (c: { reason: string; actorName: string; isOverride: boolean }, testId: string) => (
    <HStack gap="1" fontSize="xs" color="fg.muted" minW="0" maxW={isMobile ? undefined : "16rem"} data-testid={`${testId}-why`}>
      <Text truncate minW="0" title={c.reason} data-testid={`${testId}-reason`}>
        “{c.reason}”
      </Text>
      <Text flexShrink={0} whiteSpace="nowrap" data-testid={`${testId}-actor`}>
        — {c.actorName}
      </Text>
      {c.isOverride && <RootTeamBadge size="xs" ms="0.5" flexShrink={0} />}
    </HStack>
  );

  if (reworked && movements.length === 0) {
    return (
      <EmptyHint size="sm" icon={emptyIcon} title={emptyText} description={emptyDescription} testId={`${testId}-empty`} />
    );
  }

  // Signed AND coloured: +9 and -9 are different events, so the sign carries the fact and the colour makes a page of
  // them scannable. Zero gets neither — a movement that moved nothing is not an increase.
  const deltaColor = (m: MovementRow) => (m.delta > 0n ? "success.fg" : m.delta < 0n ? "error.fg" : undefined);
  const deltaText = (m: MovementRow) => (m.delta > 0n ? `+${m.delta}` : m.delta.toString());
  // A received-count correction's own line: the count it went from and to.
  const countLine = (c: CountCorrection, testId: string) => (
    <Text as="span" fontSize="xs" color="fg.muted" fontVariantNumeric="tabular-nums" data-testid={`${testId}-count`}>
      {c.from.toString()} → {c.to.toString()}
    </Text>
  );
  // A price correction's value change: up green, down red, as a unit change reads.
  const valueColor = (c: PriceChange) => (c.valueDelta > 0 ? "success.fg" : c.valueDelta < 0 ? "error.fg" : undefined);

  if (reworked && isMobile) {
    // A PHONE READS EACH MOVEMENT AS TWO LINES (a-phone-reads-each-line-as-a-block) — seven columns do not fit 400px,
    // and a table that scrolls sideways cuts off the two numbers the ledger is read for:
    //
    //   Diterima · Gudang Pusat · #7003                     +24
    //   7 Okt 2026, 07.00                 Sisa di gudang itu 76
    return (
      <Stack gap="0" data-testid={`${testId}-table`}>
        {movements.map((m) => (
          <Stack
            key={m.id.toString()}
            gap="0.5"
            py="2"
            borderBottomWidth="1px"
            borderColor="border.muted"
            data-testid={`${testId}-row-${m.id}`}
          >
            <HStack justify="space-between" gap="2" fontSize="sm">
              <Text truncate minW="0">
                <Text as="span" fontWeight="bold">
                  {kindOf(m)}
                </Text>
                {/* A price correction touched no rack — its block leaves the place out rather than say "—". */}
                {columns
                  .filter((c) => !(m.priceChange && c === "place"))
                  .map((c) => (
                    <Text as="span" key={c} color="fg.muted">
                      {" · "}
                      {cell(c, m)}
                    </Text>
                  ))}
              </Text>
              {/* A price correction moved no unit: its change is the stock value's, signed and coloured. */}
              {m.priceChange ? (
                <Text fontWeight="bold" color={valueColor(m.priceChange)} flexShrink={0} data-testid={`${testId}-row-${m.id}-value`}>
                  {formatSignedRupiah(m.priceChange.valueDelta)}
                </Text>
              ) : (
                <Text fontWeight="bold" color={deltaColor(m)} flexShrink={0}>
                  {deltaText(m)}
                </Text>
              )}
            </HStack>
            {m.priceChange && (
              <Stack gap="0.5">
                {priceLine(m.priceChange, `${testId}-row-${m.id}`)}
                {whyLine(m.priceChange, `${testId}-row-${m.id}`)}
              </Stack>
            )}
            {m.countCorrection && (
              <Stack gap="0.5">
                {countLine(m.countCorrection, `${testId}-row-${m.id}`)}
                {whyLine(m.countCorrection, `${testId}-row-${m.id}`)}
              </Stack>
            )}
            <HStack justify="space-between" gap="2" fontSize="xs" color="fg.muted">
              <Text truncate minW="0">
                {formatRfc3339DateTimeShort(m.createdAt)}
              </Text>
              <Text flexShrink={0}>
                {afterLabel} {m.balance.toString()}
              </Text>
            </HStack>
          </Stack>
        ))}
      </Stack>
    );
  }

  return (
    <Stack gap="card">
      <Table.Root size="sm" striped={striped} data-testid={`${testId}-table`}>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("inventory.movement.when")}</Table.ColumnHeader>
            <Table.ColumnHeader>
              {wording === "transaction" ? t("inventory.movement.transaction") : t("inventory.movement.what")}
            </Table.ColumnHeader>
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
            <Table.Row
              key={m.id.toString()}
              data-testid={`${testId}-row-${m.id}`}
              css={reworked ? { _hover: { "& > td": { bg: "bg.muted" } } } : undefined}
            >
              <Table.Cell>{formatRfc3339DateTimeShort(m.createdAt)}</Table.Cell>
              {/* A price correction reads two lines (one-context-per-column-and-never-three-lines): what it did — the
                  price from and to — and why, by whom. */}
              <Table.Cell>
                {m.priceChange ? (
                  <Stack gap="0">
                    <Text as="span">
                      {kindOf(m)} · {priceLine(m.priceChange, `${testId}-row-${m.id}`)}
                    </Text>
                    {whyLine(m.priceChange, `${testId}-row-${m.id}`)}
                  </Stack>
                ) : m.countCorrection ? (
                  <Stack gap="0">
                    <Text as="span">
                      {kindOf(m)} · {countLine(m.countCorrection, `${testId}-row-${m.id}`)}
                    </Text>
                    {whyLine(m.countCorrection, `${testId}-row-${m.id}`)}
                  </Stack>
                ) : (
                  kindOf(m)
                )}
              </Table.Cell>
              {columns.map((c) => (
                <Table.Cell key={c}>{cell(c, m)}</Table.Cell>
              ))}
              {/* No unit moved — 0, uncoloured — and under it what the units left are worth more or less. */}
              <Table.Cell textAlign="end" color={deltaColor(m)}>
                {m.priceChange ? (
                  <Stack gap="0" align="end">
                    <Text as="span">{deltaText(m)}</Text>
                    <Text as="span" fontSize="xs" whiteSpace="nowrap" color={valueColor(m.priceChange)} data-testid={`${testId}-row-${m.id}-value`}>
                      {formatSignedRupiah(m.priceChange.valueDelta)}
                    </Text>
                  </Stack>
                ) : (
                  deltaText(m)
                )}
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
