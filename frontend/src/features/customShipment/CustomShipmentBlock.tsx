import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Box, Flex, Span, Spacer, Stack, Text } from "@chakra-ui/react";

import type { ShipmentChannel } from "../../gen/warehouse/shipment/v1/shipment_pb";
import { ShipmentChannelBadge } from "../../components/badges/ShipmentChannelBadge";
import { formatUnixDateTimeShort } from "../../lib/datetime";
import { formatRupiahNumber } from "../../lib/money";
import { PRESSABLE } from "../../lib/motion";
import type { CustomShipment } from "./customShipments";
import { unitsOf } from "./customShipments";
import { CustomShipmentKindBadge, CustomShipmentStatusBadge } from "./CustomShipmentBadges";
import { SellingCustomShipmentActions } from "./SellingCustomShipmentActions";
// The *Barang tidak ketemu* badge on a line of its own while the parcel waits on the team (backlog #88 P6).
import { GoodsMissingBlockLine } from "./GoodsMissing";

/** "Beras Pandan Wangi 5kg +1 lainnya" — the first product by name, the rest counted (the lists' items cell). */
export function ItemsLine({ shipment }: { shipment: CustomShipment }) {
  const { t } = useTranslation();
  const [first, ...rest] = shipment.items;

  return (
    <Stack gap="0" minW="0" data-testid={`custom-shipment-items-${shipment.id}`}>
      <Span fontSize="sm" wordBreak="break-word">
        {first?.name ?? "—"}
        {rest.length > 0 && (
          <Span color="fg.muted"> {t("customShipment.table.more", { count: rest.length })}</Span>
        )}
      </Span>
      <Span fontSize="xs" color="fg.muted">
        {t("customShipment.table.itemsSummary", { count: shipment.items.length, pieces: unitsOf(shipment).toString() })}
      </Span>
    </Stack>
  );
}

/**
 * How it travels and who pays, as this reader may know it: the courier, then *Kami bayar Rp 15.000* / *Gudang bayar* for
 * the team; *Gudang bayar Rp 12.000* once handed over, or *Dibayar tim* — never the team's amount — for the warehouse.
 */
export function PayLine({ shipment, side }: { shipment: CustomShipment; side: "selling" | "warehouse" }) {
  const { t } = useTranslation();
  const handed = shipment.status === "HANDED_OVER";
  const text =
    shipment.payer === "TEAM"
      ? side === "selling"
        ? t("customShipment.table.teamPays", {
            amount:
              (shipment.shippingCost ?? 0) > 0 ? formatRupiahNumber(shipment.shippingCost ?? 0) : t("customShipment.table.costNotYet"),
          })
        : t("customShipment.table.teamPaysForWarehouse")
      : handed
        ? t("customShipment.table.warehousePaid", { amount: formatRupiahNumber(shipment.shippingCost ?? 0) })
        : t("customShipment.table.warehousePays");

  return (
    <Span fontSize="xs" color="fg.muted" data-testid={`custom-shipment-pay-${shipment.id}`}>
      {text}
    </Span>
  );
}

// ONE PARCEL ON A PHONE — a block (a-phone-reads-each-line-as-a-block), the desktop row's facts one context per line, as
// the transfer lists' blocks (the-transfer-lists-read-as-blocks-on-a-phone):
//
//   #801 [Diminta] [🎁 Sampel]                          ⋯     which, where it has got to, what it allows (the team's)
//   Bu Rina Kusuma · 0812-7777-1010                          who it goes to
//   Gudang Pusat                                             the other end — the warehouse (team) / the owner (warehouse)
//   Beras Pandan Wangi 5kg                      Rp 195.000   what is in it, and its value (the team's sample only)
//   1 produk · 3 pcs
//   [JNE] Gudang bayar                                       how it travels, and who pays
//   10 Nov 08:47 · oleh Eko Prasetyo                         when it was asked for, and by whom
export function CustomShipmentBlock({
  shipment,
  side,
  otherTeam,
  createdBy,
  courier,
  onOpen,
}: {
  shipment: CustomShipment;
  side: "selling" | "warehouse";
  /** The other end's name — the warehouse for the team, the owning team for the warehouse. */
  otherTeam: string;
  createdBy: string;
  courier: ShipmentChannel | undefined;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const id = shipment.id.toString();
  const stop = (e: MouseEvent) => e.stopPropagation();
  const value = side === "selling" && shipment.kind === "SAMPLE";

  return (
    <Stack
      data-testid={`custom-shipment-row-${id}`}
      borderWidth="1px"
      borderRadius="md"
      p="4"
      gap="2"
      minW="0"
      {...PRESSABLE}
      onClick={onOpen}
    >
      <Flex align="center" gap="2" minW="0" wrap="wrap">
        <Text fontWeight="bold" flexShrink={0}>
          #{id}
        </Text>
        <CustomShipmentStatusBadge status={shipment.status} />
        <CustomShipmentKindBadge kind={shipment.kind} />
        <Spacer />
        {side === "selling" && (
          <Box display="inline-flex" flexShrink={0} onClick={stop}>
            <SellingCustomShipmentActions shipment={shipment} variant="menu" />
          </Box>
        )}
      </Flex>
      <GoodsMissingBlockLine shipment={shipment} />

      <Text fontSize="sm" fontWeight="medium" wordBreak="break-word" data-testid={`custom-shipment-recipient-${id}`}>
        {shipment.recipient.name}
        <Span color="fg.muted" fontWeight="normal">
          {" · "}
          {shipment.recipient.phone}
        </Span>
      </Text>
      <Text fontSize="sm" wordBreak="break-word" data-testid={`custom-shipment-other-${id}`}>
        {otherTeam}
      </Text>

      <Flex align="flex-start" justify="space-between" gap="3" minW="0">
        <ItemsLine shipment={shipment} />
        {value && (
          <Text fontWeight="bold" whiteSpace="nowrap" data-testid={`custom-shipment-value-${id}`}>
            {formatRupiahNumber(shipment.total ?? 0)}
          </Text>
        )}
      </Flex>

      <Flex align="center" gap="2" minW="0" wrap="wrap">
        <ShipmentChannelBadge channelId={shipment.shipmentChannelId} channel={courier} />
        <PayLine shipment={shipment} side={side} />
      </Flex>

      <Text fontSize="xs" color="fg.muted" minW="0" truncate data-testid={`custom-shipment-when-${id}`}>
        {formatUnixDateTimeShort(shipment.createdAtUnix)}
        {createdBy && ` · ${t("customShipment.table.by", { name: createdBy })}`}
      </Text>
    </Stack>
  );
}
