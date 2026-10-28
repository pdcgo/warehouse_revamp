import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card, Separator, SimpleGrid, Stack, Table, Text } from "@chakra-ui/react";

import type { Order } from "../../../gen/warehouse/selling/v1/order_pb";
import { ShippingBadge } from "../../../components/badges/ShippingBadge";
import { AddressField, Field } from "../../../features/orders/components/OrderFields";
import { lineTotalBeli, lineUnitBeli, orderFee } from "../../../features/orders/margin";
import { formatRupiah } from "../../../lib/money";
import { ReceiptCard } from "./ReceiptCard";

// INFO — WHAT THE ORDER IS: who it is for, where it goes, what is in it and what it came to.
//
// The DEFAULT tab, and it holds everything the page held before the tabs existed. That is deliberate:
// the crew opens an order to work it, and THE PICK LIST IS THE ORDER'S LINES — a landing tab that made
// somebody click to reach the goods would be a tab arrangement designed against its main reader.
export function InfoPanel({
  order,
  teamId,
  notes,
}: {
  order: Order;
  teamId: bigint | undefined;
  /** The order's notes and the box to add one (`NotesSection`) — absent where the screen does not write notes. */
  notes?: ReactNode;
}) {
  const { t } = useTranslation();

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
                value={<ShippingBadge code={order.shippingCode} />}
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

            {/* The table scrolls INSIDE its own box. A vertical Tabs.Root is a flex row and its panel
                will not shrink below its content, so a wide line table would widen the panel and hand
                the whole page a horizontal scrollbar instead of scrolling here. */}
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
                    <Table.Row key={it.id.toString()} data-testid={`order-item-${it.sku}`}>
                      <Table.Cell>{it.sku}</Table.Cell>
                      <Table.Cell>{it.name}</Table.Cell>
                      <Table.Cell textAlign="end">{it.quantity}</Table.Cell>
                      <Table.Cell textAlign="end">{it.unitCost > 0n ? formatRupiah(lineUnitBeli(it)) : "—"}</Table.Cell>
                      <Table.Cell textAlign="end">
                        {it.unitCost > 0n ? formatRupiah(BigInt(Math.round(lineTotalBeli(it)))) : "—"}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Table.ScrollArea>

            <Separator />

            <Stack gap="1" align="end">
              {/* THE ORDER'S THREE FROZEN FIGURES — the owner's `goods_cost`, `warehouse_fee` and `total_cost` (goods +
                  fee). No subtotal and no shipping: an order records no shipping (an-order-records-no-shipping-cost). A
                  fee never priced (an order placed before fees were frozen) is a dash, never Rp 0. */}
              <Text fontSize="sm" color="fg.muted" data-testid="order-detail-goods-cost">
                {t("orderDetail.money.productTotal")}: {order.goodsCost > 0n ? formatRupiah(order.goodsCost) : "—"}
              </Text>
              <Text fontSize="sm" color="fg.muted" data-testid="order-detail-fee">
                {t("orderDetail.money.fees")}: {orderFee(order) === null ? "—" : formatRupiah(orderFee(order)!)}
              </Text>
              <Text fontSize="md" fontWeight="semibold" data-testid="order-detail-total">
                {t("orderDetail.money.systemTotal")}:{" "}
                {order.goodsCost > 0n ? formatRupiah(BigInt(Math.round(order.totalCost))) : "—"}
              </Text>

              {/* What the storefront took — shown BELOW our total and outside it, because it is the platform's figure,
                  not ours (the-total-is-ours-the-platform-total-is-theirs). Hidden at 0, which means "nobody wrote it
                  down": an order predating the rule is in that state, and "Rp 0" would read as a sale of nothing. */}
              {order.platformTotal > 0n && (
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
