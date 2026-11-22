import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, Flex, Icon, Spacer, Stack, Text } from "@chakra-ui/react";
import { PackageCheck } from "lucide-react";

import { CopyText } from "../../../components/chrome/CopyText";
import { MarketplaceBadge } from "../../../components/badges/MarketplaceBadge";
import { OrderStatusBadge } from "../../../components/badges/OrderStatusBadge";
import { OrderCourierBadge } from "../../../features/orders/OrderCourierBadge";
import type { ShopNames } from "../../../features/shops/queries";
import type { Order } from "../../../gen/warehouse/selling/v1/order_pb";
import { OrderStatus } from "../../../gen/warehouse/selling/v1/order_pb";
import { formatUnixDateTimeShort, formatUnixRelative } from "../../../lib/datetime";

// THE PARTS OF ONE RETURN on Inventaris › Retur (the-retur-list-prototype-is-accepted) — the state cell, the row's Terima
// and the phone's block. Used by `pages/returns` alone.

/** The row's state in the tab's words — a row reads what the tab above it says; the colour stays the status's. */
export function returnStateKey(status: OrderStatus): string {
  return status === OrderStatus.RETURN_COMPLETED ? "returnList.tab.accepted" : "returnList.tab.waiting";
}

/** The state badge in the tab's words, and — when the return is not this warehouse's to accept — where it goes. */
export function ReturnStateCell({ order, goesTo }: { order: Order; goesTo?: string }) {
  const { t } = useTranslation();

  return (
    <Stack gap="0.5" minW="0" align="start" data-testid={`return-list-state-${order.id}`}>
      <OrderStatusBadge status={order.status} label={t(returnStateKey(order.status))} />
      {goesTo && (
        <Text fontSize="xs" color="warning.fg" lineClamp={1} data-testid={`return-list-goes-to-${order.id}`}>
          {goesTo}
        </Text>
      )}
    </Stack>
  );
}

/** TERIMA — opens the accept page for a return this warehouse may accept. */
export function ReturnAcceptButton({ order, onAccept }: { order: Order; onAccept: () => void }) {
  const { t } = useTranslation();

  return (
    <Button
      size="xs"
      variant="outline"
      colorPalette="brand"
      aria-label={t("returnList.acceptLabel", { id: order.id.toString() })}
      data-testid={`return-list-accept-${order.id}`}
      onClick={(e) => {
        e.stopPropagation();
        onAccept();
      }}
    >
      <Icon as={PackageCheck} boxSize="4" />
      {t("returnList.accept")}
    </Button>
  );
}

/**
 * ONE RETURN ON A PHONE — a block, not eight clamped columns (a-phone-reads-each-line-as-a-block). The state and the
 * Accept lead; the storefront, the parcel's label and whose it is follow, then when it was asked and accepted.
 */
export function ReturnBlock({
  order,
  team,
  shops,
  goesTo,
  accept,
  onOpen,
}: {
  order: Order;
  team: string;
  shops: ShopNames;
  goesTo?: string;
  accept?: ReactNode;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const shop = shops.get(order.shopId.toString());
  const when = (unix: bigint) => `${formatUnixDateTimeShort(unix)} (${formatUnixRelative(unix)})`;

  return (
    <Box
      borderWidth="1px"
      borderColor="border"
      bg="bg"
      borderRadius="l2"
      p="3"
      cursor="pointer"
      onClick={onOpen}
      data-testid={`return-list-block-${order.id}`}
    >
      <Stack gap="1.5">
        <Flex align="center" gap="2" wrap="wrap">
          <OrderStatusBadge status={order.status} label={t(returnStateKey(order.status))} />
          <Text fontSize="xs" color="fg.muted" data-testid={`return-list-qty-${order.id}`}>
            {t("orders.qty")} {Number(order.itemQuantity)}
          </Text>
          <Spacer />
          {accept && <Box onClick={(e) => e.stopPropagation()}>{accept}</Box>}
        </Flex>
        {goesTo && (
          <Text fontSize="xs" color="warning.fg" data-testid={`return-list-goes-to-${order.id}`}>
            {goesTo}
          </Text>
        )}
        <Flex align="center" gap="1.5" minW="0" wrap="wrap">
          {shop && <MarketplaceBadge marketplace={shop.marketplace} size="sm" />}
          <Text fontSize="sm" lineClamp={1}>
            {shop?.name ?? "—"}
          </Text>
          {order.orderExternalRefId && (
            <Box onClick={(e) => e.stopPropagation()}>
              <CopyText value={order.orderExternalRefId} fontSize="xs" />
            </Box>
          )}
        </Flex>
        <Flex align="center" gap="1.5" wrap="wrap">
          {order.shipmentChannelId > 0n && <OrderCourierBadge channelId={order.shipmentChannelId} />}
          {order.receiptCode && (
            <Box onClick={(e) => e.stopPropagation()}>
              <CopyText value={order.receiptCode} mono fontSize="xs" />
            </Box>
          )}
        </Flex>
        <Text fontSize="xs" color="fg.muted" lineClamp={1} data-testid={`return-list-order-${order.id}`}>
          #{order.id.toString()} · {team} · {order.customerName || "—"}
        </Text>
        <Text fontSize="xs" color="fg.muted" data-testid={`return-list-asked-${order.id}`}>
          {t("returnList.block.asked", { when: order.dateEnteredAtUnix > 0n ? when(order.dateEnteredAtUnix) : "—" })}
        </Text>
        {order.status === OrderStatus.RETURN_COMPLETED && (
          <Text fontSize="xs" color="fg.muted" data-testid={`return-list-accepted-${order.id}`}>
            {t("returnList.block.accepted", { when: when(order.statusAtUnix) })}
          </Text>
        )}
      </Stack>
    </Box>
  );
}
