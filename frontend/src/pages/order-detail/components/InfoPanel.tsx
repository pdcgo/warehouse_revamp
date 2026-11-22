import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card, Flex, Separator, SimpleGrid, Stack, Table, Text } from "@chakra-ui/react";

import type { Order } from "../../../gen/warehouse/selling/v1/order_pb";
import { OrderCourierBadge } from "../../../features/orders/OrderCourierBadge";
import { AddressField, Field } from "../../../features/orders/components/OrderFields";
import { lineTotalBeli, lineUnitBeli, orderFee } from "../../../features/orders/margin";
import { formatRupiah } from "../../../lib/money";
import { ReceiptCard } from "./ReceiptCard";
import { ItemBlocks, lineProductOf } from "./ItemBlocks";
import { useProductsByIds } from "../../../features/products/queries";
import { useIsMobile } from "../../../layouts/shell";
import { CopyText } from "../../../components/chrome/CopyText";
import { TrackingLink, useTrackingHref } from "../../../features/shipment/CourierTrackingLink";

// INFO — WHAT THE ORDER IS: who it is for, where it goes, what is in it and what it came to.
//
// The DEFAULT tab, and it holds everything the page held before the tabs existed. That is deliberate:
// the crew opens an order to work it, and THE PICK LIST IS THE ORDER'S LINES — a landing tab that made
// somebody click to reach the goods would be a tab arrangement designed against its main reader.
export function InfoPanel({
  order,
  teamId,
  tags,
  notes,
}: {
  order: Order;
  teamId: bigint | undefined;
  /** The order's Tags box (OrderTagsBox, the-order-tags-prototype-is-accepted) — absent where the screen draws none. */
  tags?: ReactNode;
  /** The order's notes and the box to add one (`NotesSection`) — absent where the screen does not write notes. */
  notes?: ReactNode;
}) {
  const { t } = useTranslation();
  // THE RESI, AND THE COURIER'S TRACKING PAGE (the-tracking-link-prototype-is-accepted): the resi beside the courier —
  // copyable, with a ↗ to the courier's own page when the courier has a link (the shared catalogue OrderCourierBadge
  // already reads). The warehouse follows a parcel that left its building from here (a return, a lost parcel).
  const trackingHref = useTrackingHref(order.shipmentChannelId, order.receiptCode);
  // A PHONE READS EACH LINE AS A BLOCK (backlog #105, a-phone-reads-each-line-as-a-block) — the seller's page's blocks
  // (`ItemBlocks`), each with its product's picture from ONE batched `ProductByIds` (it answers a warehouse for any team's
  // product). Asked on a phone only: the desktop table draws no picture, so it sends nothing new.
  const mobile = useIsMobile();
  const covers = useProductsByIds({ teamId, productIds: mobile ? order.items.map((item) => item.productId) : [] });

  return (
    <Stack gap="section">
      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("orders.customerAndShipping")}
            </Text>
            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
              <Field label={t("orders.customer")} value={order.customerName} />
              {/* The buyer's marketplace username, beside the customer and only when there is one
                  (the-buyers-username-is-optional) — none is the ordinary case, not a `—` to report. */}
              {order.buyerUsername !== "" && (
                <Field
                  label={t("orders.buyerUsername")}
                  value={
                    <Text fontSize="sm" data-testid="order-detail-buyer-username">
                      {order.buyerUsername}
                    </Text>
                  }
                />
              )}
              <Field label={t("orders.phone")} value={order.customerPhone} />
              <AddressField label={t("orders.address")} address={order.address} />
              {/* No status field here — the badge is in the page header, beside the order number,
                  where it stays visible whichever tab is open. A second copy inside Info would be the
                  same fact in two places, and the two would eventually disagree. */}
              <Field
                label={t("orders.shipping")}
                value={<OrderCourierBadge channelId={order.shipmentChannelId} />}
              />
              <Field
                label={t("orders.receiptColumn")}
                value={
                  order.receiptCode.trim() !== "" ? (
                    <Flex gap="2" align="center" wrap="wrap" data-testid="order-detail-resi">
                      <CopyText value={order.receiptCode.trim()} mono />
                      {trackingHref && <TrackingLink href={trackingHref} hint testId="order-detail-resi-track" />}
                    </Flex>
                  ) : undefined
                }
              />
              {/* The MARKETPLACE'S own id, and only when there is one — it is the name the buyer and
                  the storefront's support use, so whoever is on the phone about this order needs it
                  readable rather than hunted for. An order taken by phone has none, and a blank row
                  saying so would be a field reporting the ordinary case. */}
              {order.orderExternalRefId !== "" && (
                <Field
                  label={t("orders.orderExternalRefId")}
                  value={
                    <Text fontSize="sm" data-testid="order-detail-external-ref">
                      {order.orderExternalRefId}
                    </Text>
                  }
                />
              )}
            </SimpleGrid>
          </Stack>
        </Card.Body>
      </Card.Root>

      {order.receipt && order.receipt.documentId !== "" && (
        <ReceiptCard order={order} teamId={teamId} />
      )}

      {/* THE NOTES — the order's note rows and the box to add one (a-note-is-a-timeline-row). There is no
          `order.note` any more: a note is a timeline row with no status, written by either end.

          On the DEFAULT tab on purpose. A note is what nobody could put in a structured field ("deliver after
          5pm", "wrap the glass one"), which makes it an instruction to whoever opens this page — and an
          instruction filed behind a tab is one nobody reads. The card is drawn here and the section inside it
          bare, so it is never a card inside a card. */}
      {/* THE ORDER'S TAGS (the-order-tags-prototype-is-accepted), on the default tab right before the notes, as a
          restock's Tag box sits before its note: the warehouse sees and tags the same tags the selling team does. */}
      {tags && (
        <Card.Root data-testid="order-detail-tags">
          <Card.Body>
            <Stack gap="card">
              <Text fontSize="sm" fontWeight="medium" color="fg.muted">
                {t("orders.tags.title")}
              </Text>
              {tags}
            </Stack>
          </Card.Body>
        </Card.Root>
      )}

      {notes && (
        <Card.Root data-testid="order-detail-notes">
          <Card.Body>
            <Stack gap="card">
              <Text fontSize="sm" fontWeight="medium" color="fg.muted">
                {t("orderDetail.notes.title")}
              </Text>
              {notes}
            </Stack>
          </Card.Body>
        </Card.Root>
      )}

      <Card.Root>
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("orders.items")}
            </Text>

            {/* ON A PHONE, ONE BLOCK PER LINE (a-phone-reads-each-line-as-a-block): the name at the full width, then
                harga beli × qty and the line total — the facts of the desktop row, no table scrolling in its card. The
                list and each block keep the table's test ids. A JS breakpoint, never CSS hiding. */}
            {mobile ? (
              <ItemBlocks
                items={order.items}
                productOf={(item) => lineProductOf(item, covers.data)}
                testId="order-detail-items"
                itemTestId={(item) => `order-item-${item.productCode}`}
              />
            ) : (
              // The table scrolls INSIDE its own box. A vertical Tabs.Root is a flex row and its panel
              // will not shrink below its content, so a wide line table would widen the panel and hand
              // the whole page a horizontal scrollbar instead of scrolling here.
              <Table.ScrollArea>
                <Table.Root size="sm" data-testid="order-detail-items">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader>{t("orders.sku")}</Table.ColumnHeader>
                      <Table.ColumnHeader>{t("orders.name")}</Table.ColumnHeader>
                      <Table.ColumnHeader textAlign="end">{t("orders.qty")}</Table.ColumnHeader>
                      {/* HARGA BELI — what one unit cost the seller (a borrowed line with its owner's markup). A line
                          carries no selling price (an-order-line-carries-no-marketplace-price). */}
                      <Table.ColumnHeader textAlign="end">{t("orderDetail.items.unitCost")}</Table.ColumnHeader>
                      <Table.ColumnHeader textAlign="end">{t("orders.lineTotal")}</Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {order.items.map((it) => (
                      <Table.Row key={it.id.toString()} data-testid={`order-item-${it.productCode}`}>
                        <Table.Cell>{it.productCode}</Table.Cell>
                        <Table.Cell>{it.name}</Table.Cell>
                        <Table.Cell textAlign="end">{it.quantity}</Table.Cell>
                        <Table.Cell textAlign="end">{it.unitCost > 0 ? formatRupiah(lineUnitBeli(it)) : "—"}</Table.Cell>
                        <Table.Cell textAlign="end">
                          {it.unitCost > 0 ? formatRupiah(lineTotalBeli(it)) : "—"}
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </Table.ScrollArea>
            )}

            <Separator />

            <Stack gap="1" align="end">
              {/* THE ORDER'S THREE FROZEN FIGURES — the owner's `goods_cost`, `warehouse_fee` and `total_cost` (goods +
                  fee). No subtotal and no shipping: an order records no shipping (an-order-records-no-shipping-cost). A
                  fee never priced (an order placed before fees were frozen) is a dash, never Rp 0. */}
              <Text fontSize="sm" color="fg.muted" data-testid="order-detail-goods-cost">
                {t("orderDetail.money.productTotal")}: {order.goodsCost > 0 ? formatRupiah(order.goodsCost) : "—"}
              </Text>
              <Text fontSize="sm" color="fg.muted" data-testid="order-detail-fee">
                {t("orderDetail.money.fees")}: {orderFee(order) === null ? "—" : formatRupiah(orderFee(order)!)}
              </Text>
              <Text fontSize="md" fontWeight="semibold" data-testid="order-detail-total">
                {t("orderDetail.money.systemTotal")}:{" "}
                {order.goodsCost > 0 ? formatRupiah(order.totalCost) : "—"}
              </Text>

              {/* What the storefront took — shown BELOW our total and outside it, because it is the platform's figure,
                  not ours (the-total-is-ours-the-platform-total-is-theirs). Hidden at 0, which means "nobody wrote it
                  down": an order predating the rule is in that state, and "Rp 0" would read as a sale of nothing. */}
              {order.platformTotal > 0 && (
                <Text fontSize="sm" color="fg.muted" data-testid="order-detail-marketplace-total">
                  {t("orders.marketplaceTotal")}: {formatRupiah(order.platformTotal)}
                </Text>
              )}
            </Stack>
          </Stack>
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}
