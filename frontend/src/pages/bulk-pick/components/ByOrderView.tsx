import { useTranslation } from "react-i18next";
import { Box, Button, Card, Flex, Icon, Spacer, Stack, Table, Text } from "@chakra-ui/react";
import { ArrowUpRight } from "lucide-react";

import type { OrderPick } from "../../../features/picking/bulkPick";
import { MarketplaceBadge } from "../../../components/badges/MarketplaceBadge";
import { CopyText } from "../../../components/chrome/CopyText";
import { OrderCourierBadge } from "../../../features/orders/OrderCourierBadge";
import { RackLine } from "./RackLine";

/** Every new table's row lights up under the pointer, every cell (a-table-row-lights-up). */
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

/**
 * PER PESANAN — *each order shown with its products and racks* (acceptance inventory/order.md, bulk pick order, grouped
 * by order). The orders in the order they were ticked; each names itself as the parcel does (the shop and its ref, the
 * courier and its resi) and lists its lines with the racks ITS take drew them from — the single pick page's table, once
 * per order.
 *
 * **Buka** opens that order's pick page, where the parcel is still checked item by item before Sudah diambil
 * (the-item-scans-live-on-the-page) — this list moves no status.
 */
export function ByOrderView({
  picks,
  mobile,
  onOpen,
}: {
  picks: OrderPick[];
  mobile: boolean;
  onOpen: (orderId: bigint) => void;
}) {
  return (
    <Stack gap={mobile ? "2" : "card"} data-testid="bulk-pick-by-order" data-layout={mobile ? "blocks" : "cards"}>
      {picks.map((pick) =>
        mobile ? (
          <OrderBlock key={pick.order.id.toString()} pick={pick} onOpen={() => onOpen(pick.order.id)} />
        ) : (
          <OrderCard key={pick.order.id.toString()} pick={pick} onOpen={() => onOpen(pick.order.id)} />
        ),
      )}
    </Stack>
  );
}

/** The order's own facts, as the parcel carries them — the shop and its ref, the courier and its resi. */
function OrderHead({ pick, onOpen }: { pick: OrderPick; onOpen: () => void }) {
  const { t } = useTranslation();
  const { order } = pick;
  const ref = order.orderExternalRefId || t("picking.detail.title", { id: order.id.toString() });

  return (
    <Flex align="center" gap="2" wrap="wrap" rowGap="1">
      <MarketplaceBadge marketplace={order.marketplace} size="sm" />
      <Text fontSize="sm" fontWeight="bold" lineClamp={1}>
        {order.shopName}
      </Text>
      {order.orderExternalRefId && <CopyText value={order.orderExternalRefId} fontSize="xs" />}
      {order.shipmentChannelId > 0n && <OrderCourierBadge channelId={order.shipmentChannelId} />}
      {order.receiptCode && <CopyText value={order.receiptCode} mono fontSize="xs" />}
      <Text fontSize="xs" color="fg.muted" data-testid={`bulk-pick-order-units-${order.id}`}>
        {t("bulkPick.units", { count: pick.units })}
      </Text>
      <Spacer />
      <Button
        size="xs"
        variant="outline"
        aria-label={t("bulkPick.openLabel", { ref })}
        data-testid={`bulk-pick-order-open-${order.id}`}
        onClick={onOpen}
      >
        <Icon as={ArrowUpRight} boxSize="4" />
        {t("bulkPick.open")}
      </Button>
    </Flex>
  );
}

function OrderCard({ pick, onOpen }: { pick: OrderPick; onOpen: () => void }) {
  const { t } = useTranslation();
  const { order } = pick;

  return (
    <Card.Root data-testid={`bulk-pick-order-${order.id}`}>
      <Card.Body>
        <Stack gap="card">
          <OrderHead pick={pick} onOpen={onOpen} />
          <Table.Root size="sm">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>{t("picking.table.product")}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t("picking.table.qty")}</Table.ColumnHeader>
                <Table.ColumnHeader>{t("bulkPick.col.racks")}</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {pick.lines.map((line) => (
                <Table.Row
                  key={line.productId.toString()}
                  css={LIGHTS_UP}
                  data-testid={`bulk-pick-order-line-${order.id}-${line.productId}`}
                  data-quantity={line.quantity}
                >
                  <Table.Cell>
                    <Stack gap="0">
                      <Text>{line.name}</Text>
                      <Text fontSize="xs" color="fg.muted">
                        {line.productCode}
                      </Text>
                    </Stack>
                  </Table.Cell>
                  <Table.Cell textAlign="end" fontWeight="bold">
                    {line.quantity}
                  </Table.Cell>
                  <Table.Cell w="50%">
                    <RackLine
                      racks={line.racks}
                      unrecorded={line.unrecorded}
                      testId={`bulk-pick-order-rack-${order.id}-${line.productId}`}
                    />
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}

/** ONE ORDER ON A PHONE — its head, then each line as a block: the product and its count, the racks under it. */
function OrderBlock({ pick, onOpen }: { pick: OrderPick; onOpen: () => void }) {
  const { order } = pick;

  return (
    <Box borderWidth="1px" borderColor="border" borderRadius="l2" bg="bg" p="3" data-testid={`bulk-pick-order-${order.id}`}>
      <Stack gap="2">
        <OrderHead pick={pick} onOpen={onOpen} />
        {pick.lines.map((line) => (
          <Stack
            key={line.productId.toString()}
            gap="1"
            pt="2"
            borderTopWidth="1px"
            borderColor="border.muted"
            data-testid={`bulk-pick-order-line-${order.id}-${line.productId}`}
            data-quantity={line.quantity}
          >
            <Flex align="flex-start" gap="3">
              <Stack gap="0" flex="1" minW="0">
                <Text fontSize="sm" lineClamp={2}>
                  {line.name}
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  {line.productCode}
                </Text>
              </Stack>
              <Text fontWeight="bold" flexShrink={0}>
                ×{line.quantity}
              </Text>
            </Flex>
            <RackLine racks={line.racks} unrecorded={line.unrecorded} testId={`bulk-pick-order-rack-${order.id}-${line.productId}`} />
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}
