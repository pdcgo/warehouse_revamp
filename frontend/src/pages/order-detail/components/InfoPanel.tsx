import { useTranslation } from "react-i18next";
import { Card, Separator, SimpleGrid, Stack, Table, Text } from "@chakra-ui/react";

import type { Order } from "../../../gen/warehouse/selling/v1/order_pb";
import { ShippingBadge } from "../../../components/badges/ShippingBadge";
import { AddressField, Field } from "../../../features/orders/components/OrderFields";
import { formatRupiah } from "../../../lib/money";
import { ReceiptCard } from "./ReceiptCard";

// INFO — WHAT THE ORDER IS: who it is for, where it goes, what is in it and what it came to.
//
// The DEFAULT tab, and it holds everything the page held before the tabs existed. That is deliberate:
// the crew opens an order to work it, and THE PICK LIST IS THE ORDER'S LINES — a landing tab that made
// somebody click to reach the goods would be a tab arrangement designed against its main reader.
export function InfoPanel({ order, teamId }: { order: Order; teamId: bigint | undefined }) {
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

      {/* The note, and only when there IS one. An empty note card on every order would be a permanent
          blank panel between the customer and the goods — the field is optional, so its absence is the
          ordinary case rather than something to report.

          It stays on the DEFAULT tab on purpose. A note is what nobody could put in a structured field
          ("deliver after 5pm", "wrap the glass one"), which makes it an instruction to whoever opens
          this page — and an instruction filed behind a tab is one nobody reads.

          `whiteSpace="pre-wrap"` because it was typed as lines: a note listing three things on three
          lines must not arrive as one paragraph. */}
      {order.note !== "" && (
        <Card.Root>
          <Card.Body>
            <Stack gap="card">
              <Text fontSize="sm" fontWeight="medium" color="fg.muted">
                {t("orders.note")}
              </Text>
              <Text fontSize="sm" whiteSpace="pre-wrap" data-testid="order-detail-note">
                {order.note}
              </Text>
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
                    <Table.ColumnHeader textAlign="end">{t("orders.unitPrice")}</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">{t("orders.lineTotal")}</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {order.items.map((it) => (
                    <Table.Row key={it.id.toString()} data-testid={`order-item-${it.sku}`}>
                      <Table.Cell>{it.sku}</Table.Cell>
                      <Table.Cell>{it.name}</Table.Cell>
                      <Table.Cell textAlign="end">{it.quantity}</Table.Cell>
                      <Table.Cell textAlign="end">{formatRupiah(it.unitPrice)}</Table.Cell>
                      <Table.Cell textAlign="end">
                        {formatRupiah(BigInt(it.quantity) * it.unitPrice)}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Table.ScrollArea>

            <Separator />

            <Stack gap="1" align="end">
              <Text fontSize="sm" color="fg.muted">
                {t("orders.subtotal")}: {formatRupiah(order.subtotal)}
              </Text>
              <Text fontSize="sm" color="fg.muted">
                {t("orders.shipping")}: {formatRupiah(order.shippingCost)}
              </Text>
              <Text fontSize="md" fontWeight="semibold" data-testid="order-detail-total">
                {t("orders.total")}: {formatRupiah(order.total)}
              </Text>

              {/* What the storefront took — shown BELOW the total and outside the sum, because that is
                  what it is: a note, not a term. Hidden at 0, which means "nobody wrote it down": every
                  order predating the field is in that state, and a row of "Rp 0" across the history
                  would read as a marketplace that paid nothing. */}
              {order.marketplaceTotal > 0n && (
                <Text fontSize="sm" color="fg.muted" data-testid="order-detail-marketplace-total">
                  {t("orders.marketplaceTotal")}: {formatRupiah(order.marketplaceTotal)}
                </Text>
              )}
            </Stack>
          </Stack>
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}
