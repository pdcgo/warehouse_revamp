import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, Card, Flex, Heading, Icon, Stack, Table, Text } from "@chakra-ui/react";
import { PackagePlus } from "lucide-react";

import { AllProductPicker } from "../products/AllProductPicker";
import type { PickedProduct } from "../products/ProductSelect";
import { OrderLineRow } from "../../features/orders/OrderLineRow";
import type { Availability, Costs, LineDraft } from "../../features/orders/lines";
import { lineStock } from "../../features/orders/lines";

export interface OrderItemCardProps {
  /** BOTH the team every call is authorized as AND whose "My Product" tab the picker shows. */
  teamId: bigint;
  /** WHICH BUILDING every stock figure — the picker's READY column and each line's — is measured
   * against. `0n` means none chosen yet, which DISABLES picking rather than opening a dialog full of
   * blanks. */
  warehouseId: bigint;

  lines: LineDraft[];
  /** What a pick from the chosen warehouse would find. `undefined` = the read has not landed, which
   * is not the same as "none" — each row prints an em dash rather than a confident 0. */
  stock?: Availability;
  /** productId -> HPP at the chosen warehouse. Absent or 0 = UNKNOWN, never free. */
  costs?: Costs;

  /** The WHOLE ticked set from the picker, not an addition. The caller reconciles it against the
   * lines it already has (see `OrderCreatePage.pickProducts`) — rebuilding the list here would reset
   * every quantity the next time somebody opened the dialog to add one more product. */
  onPick: (products: PickedProduct[]) => void;
  onPatch: (productId: bigint, patch: Partial<LineDraft>) => void;
  onRemove: (productId: bigint) => void;
}

// WHAT IS BEING SOLD — the items half of an order form: the picker that adds products, and the table
// of what has been added with what the chosen warehouse holds against each one.
//
// It is PRESENTATIONAL over the lines it is handed: the state, the reconciliation and the stock/HPP
// reads stay on the page, because the page is what submits them. What lives here is the arrangement
// the two facts have to be read in — you pick from the catalogue, and you check each line against the
// building.
//
// ⚠ NO WAREHOUSE, NO PICKING (owner). Every figure the decision rests on is a fact about ONE BUILDING:
// with no warehouse the picker's READY column is a page of em dashes and each line's stock and HPP
// below are unreadable too. The trigger is disabled and says WHY beside itself — a greyed-out button
// with no explanation is the worst state a form can be in, because the person cannot tell a broken
// screen from one waiting on them.
//
// A TABLE, not a stack of cards (owner). Lines are the same five facts repeated, so the quantities
// line up in a column, the money lines up in a column, and the HPP has somewhere to belong instead of
// floating between two inputs.
//
// NOT to be confused with `OrderLineItem` — that identifies an ORDER in a list. This is the card of
// what is ON one.
export const description =
  "The items half of an order form — a titled card whose one-line description states what the rows are measured against, the “Add products” picker, and the table of lines, each row carrying what the chosen WAREHOUSE holds against the quantity typed. Picking is a dialog handing back the WHOLE ticked set, so the caller reconciles rather than appends and no typed quantity is reset. With no warehouse chosen the picker is DISABLED and says why beside itself: every figure on this card is a fact about one building, so opening it without one would fill the screen with blanks.";

export function OrderItemCard({
  teamId,
  warehouseId,
  lines,
  stock,
  costs,
  onPick,
  onPatch,
  onRemove,
}: OrderItemCardProps) {
  const { t } = useTranslation();

  // What the picker shows as ticked. Derived from the lines, never stored beside them — two copies of
  // "which products are on this order" is how a tick and a row start disagreeing.
  const pickedIds = useMemo(() => lines.map((l) => l.productId), [lines]);

  const noWarehouse = warehouseId <= 0n;

  return (
    <Card.Root>
      <Card.Body>
        <Stack gap="card">
          {/* THE TITLE AND WHAT THE CARD IS FOR, then the control — and they are separated rather
              than strung along one line. The heading names the section; the line under it says the
              thing a person cannot see from the table itself, which is that every figure on these
              rows is measured against the WAREHOUSE chosen above and not against the catalogue.
              `justify="space-between"` keeps the picker on the right of the header on a wide screen
              and drops it under the text on a narrow one. */}
          <Flex align="start" gap="card" wrap="wrap" justify="space-between">
            <Stack gap="0.5" minW="0">
              {/* `md`, a step up from the `sm` the other section headings on this page carry (owner).
                  The lines are the SUBJECT of an order — the shop, the customer and the note are all
                  about goods that are named here — so the card that holds them reads as the main one
                  rather than as one of five equals. */}
              <Heading as="h3" size="md">{t("orders.items")}</Heading>
              <Text fontSize="xs" color="fg.muted" data-testid="order-items-help">
                {t("orders.itemsHelp")}
              </Text>
            </Stack>

            <Flex align="center" gap="card" wrap="wrap">
              {/* Picking is a DIALOG, as it is on a restock request (#165) — several products at once,
                  searchable, with what the warehouse holds on every row. There is no per-line product
                  control: swapping one product for another is untick, tick.

                  THE "ALL" PICKER, NOT THE OWN ONE, and that is the load-bearing choice. An order
                  draws whatever is on the shelf — StockPick drains the warehouse regardless of which
                  restock brought a unit in — so narrowing to this team's own catalogue would hide
                  stock the building can plainly ship.

                  It is TABBED — My Product, Priority Product, Other Product — and the tabs are a
                  partition rather than three browses: a product sits on exactly one of them. Ticks
                  survive crossing, so one order can draw from all three without the selection
                  resetting. Priority is hidden while no team has been granted the feature (see the
                  picker's own note). */}
              <AllProductPicker
                // THE CATALOGUE IS THE CATALOGUE (owner) — the browse is every team's products
                // (ProductDiscover), and the warehouse's figures ride along as COLUMNS rather than
                // deciding what is listed at all.
                //
                // This replaced the warehouse-as-catalogue picker, and the trade is deliberate: a
                // product with nothing on the shelf now REACHES the dialog and reads 0 in the READY
                // column. That is the more honest screen — "we stock it, this building has none right
                // now" is a different fact from "no such product", and it is the one the person taking
                // the order has to tell the buyer. The form still refuses the line (the short-line
                // alert the page raises), so nothing unshippable can be placed.
                teamId={teamId}
                // WHICH BUILDING the READY column is measured against.
                stockWarehouseId={warehouseId}
                // ⚠ THE SELLING LENS, and it is not interchangeable with the default. "owned" answers
                // "how much of MINE is there" — right when buying, and wrong here: an order takes
                // whatever is on the shelf, so the ownership figure would read 0 for stock this order
                // would happily draw. "available" is what a pick would find.
                readyLens="available"
                disabled={noWarehouse}
                value={pickedIds}
                onChange={onPick}
                trigger={
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={noWarehouse}
                    data-testid="order-create-add-line"
                  >
                    <Icon as={PackagePlus} boxSize="4" />
                    {t("orders.addLine")}
                  </Button>
                }
              />

              {/* WHY it is disabled, beside the disabled thing. */}
              {noWarehouse && (
                <Text fontSize="sm" color="orange.fg" data-testid="order-create-need-warehouse">
                  {t("orders.pickWarehouseFirst")}
                </Text>
              )}
            </Flex>
          </Flex>

          {lines.length === 0 && (
            <Text fontSize="sm" color="fg.muted" data-testid="order-create-no-products">
              {t("orders.noProducts")}
            </Text>
          )}

          {/* It scrolls inside its own box: six columns on a phone would otherwise push the whole page
              sideways. */}
          {lines.length > 0 && (
            <Box overflowX="auto">
              <Table.Root size="sm" data-testid="order-lines-table">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>{t("orders.product")}</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">{t("orders.inStock")}</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">{t("orders.qty")}</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">{t("orders.hpp")}</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">{t("orders.lineTotal")}</Table.ColumnHeader>
                    <Table.ColumnHeader />
                  </Table.Row>
                </Table.Header>

                <Table.Body>
                  {lines.map((line, i) => (
                    <OrderLineRow
                      key={line.productId.toString()}
                      index={i}
                      line={line}
                      stock={lineStock(line, stock)}
                      costs={costs}
                      onPatch={(patch) => onPatch(line.productId, patch)}
                      onRemove={() => onRemove(line.productId)}
                    />
                  ))}
                </Table.Body>
              </Table.Root>
            </Box>
          )}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
