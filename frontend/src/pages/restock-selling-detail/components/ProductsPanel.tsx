import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Card, Separator, Stack, Table, Text } from "@chakra-ui/react";

import type { RestockRequest } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import {
  RestockDamageType,
  RestockRequestStatus,
} from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { lineTotal, unitPrice } from "../../../features/restock/lines";
import {
  askedQuantity,
  brokenQuantity,
  costKindSlug,
  damageReasons,
  goodsTotal,
  lostQuantity,
  receivedQuantity,
  warehouseOutlay,
} from "../../../features/restock/summary";
import { useProductsByIds } from "../../../features/products/queries";
import { ProductListItem } from "../../../components/products/ProductListItem";
import { DamageCell } from "../../../features/restock/DamageCell";
import { formatRupiah } from "../../../lib/money";

export interface ProductsPanelProps {
  request: RestockRequest;
  /** The READING team — whose catalogue the covers are looked up in. */
  teamId: bigint | undefined;
}

// PRODUCT — WHAT WAS ORDERED, WHAT ARRIVED, AND WHAT IT COST.
//
// The lines, and only the lines. The PLACE a line was shelved on is deliberately absent, and it is
// not a permissions dodge: RackList is scoped to the warehouse and would refuse this team outright,
// but more to the point, which shelf inside somebody else's building a line went on is not a fact a
// buyer acts on. What the buyer wants to know — did my stock arrive, and how much of it — is the
// Arrived column, and that stays.
export function ProductsPanel({ request, teamId }: ProductsPanelProps) {
  const { t } = useTranslation();

  // Only a FULFILLED request has been counted, so it is the only one whose `receivedQuantity` means
  // anything. On a pending or cancelled request it is 0 because nobody ever opened the box — showing
  // that would read as "nothing came" when the truth is "not counted yet".
  const isFulfilled = request.status === RestockRequestStatus.FULFILLED;

  const items = useMemo(() => request.items, [request]);

  // THE COVERS, in one call for every line — a restock line stores sku/name and no picture, so the
  // image is resolved by product id (see `useProductsByIds`). It is decoration: an id that does not
  // resolve keeps ProductListItem's placeholder, which is a correct rendering of "no picture", and
  // the table never waits on it.
  const covers = useProductsByIds({
    teamId,
    productIds: useMemo(() => items.map((item) => item.productId), [items]),
  });

  const productsTotal = useMemo(() => goodsTotal(items), [items]);
  const askedTotal = useMemo(() => askedQuantity(items), [items]);
  const receivedTotal = useMemo(() => receivedQuantity(items), [items]);

  // The goods plus EVERY freight charge on them — the same arithmetic the list's Value column does,
  // so a row and the page it opens can never disagree about what a restock cost.
  //
  // The cost lines are what the WAREHOUSE laid out to receive this delivery (00021). It pays and
  // enters them, but they are freight on this team's goods, so they belong in this team's total —
  // and this team is the side that has to settle them. Empty until a delivery is accepted.
  const grandTotal =
    productsTotal + request.shippingCost + warehouseOutlay(request);

  return (
    // maxW="full" so the card can never be wider than the tab panel holding it. Without it a wide
    // table makes the CARD grow, which pushes the whole page into a horizontal scroll — the layout
    // moves instead of the table.
    <Card.Root
      maxW="full"
      overflow="hidden"
      data-testid="restock-detail-products"
    >
      <Card.Body>
        <Stack gap="card">
          <Text fontSize="sm" fontWeight="medium" color="fg.muted">
            {t("restock.form.products")}
          </Text>

          {/* THE TABLE SCROLLS, NOT THE PAGE. Seven columns — a product cell that wants 16rem, three
              count columns and two money ones — do not fit a narrow viewport, and something has to
              give. Chakra's Table.ScrollArea makes it the table: the header row and the totals below
              stay put, and only the columns slide.
              This is the third of three layers, and each is load-bearing: `minW="0"` on the tab panel
              (a flex child will not shrink below its content without it), `maxW="full"` on the card,
              and this. Any one alone still leaves the page scrolling sideways. */}
          <Table.ScrollArea>
            <Table.Root size="sm" data-testid="restock-detail-items">
              <Table.Header>
                <Table.Row>
                  {/* ONE product column, not SKU + Name side by side (owner). A picture, a name and a
                      code are one identity — the thing you are buying — and splitting them across two
                      columns made the row read as two facts while pushing the numbers off to the right.
                      It is also what every other product row in the app looks like: ProductListItem. */}
                  <Table.ColumnHeader>
                    {t("restock.detail.product")}
                  </Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">
                    {t("restock.detail.asked")}
                  </Table.ColumnHeader>
                  {/* ACCEPTED · LOST · BROKEN (owner) — what a delivery actually did, in the three
                      numbers that mean three different things:
                        accepted — sellable, and the only one stock ever heard about;
                        lost     — never turned up in the box;
                        broken   — turned up unsellable.
                      A single "arrived" column collapsed all three, so a buyer reading "8 of 10" could
                      not tell whether to ask for a re-send or file a damage claim. The warehouse had
                      recorded the difference at the door (#154) and this page was throwing it away.

                      ⚠ THEY ARE ALWAYS PRESENT, on a pending restock too. They used to appear only once
                      the delivery was accepted, and the result was a Product tab that looked like it had
                      never gained the columns at all — every restock still waiting is pending, so the
                      common case showed none of them. An uncounted line reads "—" per cell, which says
                      NOT COUNTED YET; a 0 would have said "none arrived", which is a different and false
                      claim about a box nobody has opened. */}
                  <Table.ColumnHeader textAlign="end">
                    {t("restock.detail.accepted")}
                  </Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">
                    {t("restock.accept.problemLost")}
                  </Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">
                    {t("restock.accept.problemBroken")}
                  </Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">
                    {t("restock.detail.unitPrice")}
                  </Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">
                    {t("restock.detail.lineTotal")}
                  </Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {items.map((item) => {
                  // Did the count come out other than what was asked — in EITHER direction, since 11
                  // against 10 is as worth a second look as 9 is. It only weights the number now; the
                  // phrase that used to sit beside it is gone with the badge.
                  const differs = isFulfilled && item.receivedQuantity !== item.quantity;

                  return (
                    <Table.Row
                      key={item.id.toString()}
                      data-testid={`restock-detail-item-${item.productId}`}
                    >
                      {/* sku and name come from the LINE, the image from the lookup. The snapshot is
                          what was ordered and must keep reading that way; only the picture is a fact
                          about the product as it is today. */}
                      <Table.Cell minW="64">
                        <ProductListItem
                          product={{
                            id: item.productId,
                            sku: item.sku,
                            name: item.name,
                            defaultImageUrl: covers.data?.get(
                              item.productId.toString(),
                            )?.defaultImageUrl,
                            defaultImageThumbnailUrl: covers.data?.get(
                              item.productId.toString(),
                            )?.defaultImageThumbnailUrl,
                          }}
                        />
                      </Table.Cell>
                      <Table.Cell textAlign="end">
                        {item.quantity.toString()}
                      </Table.Cell>

                      {/* ACCEPTED — what became sellable stock. Before the count it is an em dash, NOT
                          the 0 the field actually holds: `received_quantity` is 0 on every pending line,
                          and printing that would tell the buyer nothing arrived when the truth is that
                          nobody has opened the box. */}
                      <Table.Cell
                        textAlign="end"
                        color={isFulfilled ? undefined : "fg.muted"}
                        data-testid={`restock-detail-received-${item.productId}`}
                      >
                        {/* NO "short by n" BADGE (owner). It said what the row now says better: Asked
                            15, Accepted 7, Lost 1, Broken 2 IS the discrepancy, itemised — and the
                            badge could only give the total gap while implying it was all shortfall.
                            The number stays BOLD when it differs from the ask, which points at the
                            row without naming a cause the columns beside it already name.
                            The whole-restock badge in the page header is a different thing and stays:
                            it is what tells a reader something went wrong before they open a tab. */}
                        {isFulfilled ? (
                          <Text
                            as="span"
                            fontWeight={differs ? "semibold" : "normal"}
                          >
                            {item.receivedQuantity.toString()}
                          </Text>
                        ) : (
                          "—"
                        )}
                      </Table.Cell>

                      {/* LOST and BROKEN, each with the reason the person at the door typed (#154
                          requires one — a loss with no reason is a number nobody can act on). No status
                          gate needed: an uncounted line has no damage rows, so DamageCell's own
                          zero-is-an-em-dash rule already renders "not counted" correctly. */}
                      <DamageCell
                        quantity={lostQuantity(item)}
                        reasons={damageReasons(item, RestockDamageType.LOST)}
                        testId={`restock-detail-lost-${item.productId}`}
                      />
                      <DamageCell
                        quantity={brokenQuantity(item)}
                        reasons={damageReasons(item, RestockDamageType.BROKEN)}
                        testId={`restock-detail-broken-${item.productId}`}
                      />
                      <Table.Cell textAlign="end">
                        {formatRupiah(unitPrice(item))}
                      </Table.Cell>
                      <Table.Cell textAlign="end">
                        {formatRupiah(lineTotal(item))}
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>
          </Table.ScrollArea>

          <Separator />

          {/* What was ordered, what it cost, and — once counted — what actually landed against it. */}
          <Stack gap="1" align="end">
            {isFulfilled && (
              <Text fontSize="sm" color="fg.muted">
                {t("restock.detail.receivedTotal")}:{" "}
                <Text
                  as="span"
                  fontWeight="medium"
                  data-testid="restock-detail-received-total"
                >
                  {receivedTotal.toString()} / {askedTotal.toString()}
                </Text>
              </Text>
            )}
            <Text fontSize="sm" color="fg.muted">
              {t("restock.summary.productsTotal")}:{" "}
              <Text as="span" data-testid="restock-detail-products-total">
                {formatRupiah(productsTotal)}
              </Text>
            </Text>
            <Text fontSize="sm" color="fg.muted">
              {t("restock.form.shippingCost")}:{" "}
              <Text as="span" data-testid="restock-detail-shipping">
                {formatRupiah(request.shippingCost)}
              </Text>
            </Text>
            {/* ONE ROW PER COST, and nothing at all when there are none: most deliveries cost the
                warehouse nothing, and a "Rp 0" row would invite the reader to wonder what they had
                missed. Each row carries its own note, because this is the screen where the team being
                charged finds out what for.

                ⚠ THE KIND IS NO LONGER SHOWN. It was `Kind — note: amount`, and with one kind the
                prefix was the same word on every row (an-incidental-line-must-say-what-it-was-for).
                The note is what says what the money was, which is why it is required. */}
            {request.costLines.map((line) => (
              <Text key={line.id.toString()} fontSize="sm" color="fg.muted">
                {line.note}:{" "}
                <Text
                  as="span"
                  data-testid={`restock-detail-cost-${costKindSlug(line.kind)}`}
                >
                  {formatRupiah(line.amount)}
                </Text>
              </Text>
            ))}
            <Text
              fontSize="md"
              fontWeight="semibold"
              data-testid="restock-detail-total"
            >
              {t("restock.summary.grandTotal")}: {formatRupiah(grandTotal)}
            </Text>
          </Stack>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
