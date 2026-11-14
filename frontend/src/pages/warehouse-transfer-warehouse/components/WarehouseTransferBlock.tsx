import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Box, Flex, Span, Stack, Text } from "@chakra-ui/react";

import type { WarehouseTransfer } from "../../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import type { ShipmentChannel } from "../../../gen/warehouse/shipment/v1/shipment_pb";
import { useCanWrite } from "../../../features/team/TeamContext";
import { TransferItemsCell } from "../../../features/warehouseTransfer/TransferItemsCell";
import {
  WarehouseTransferActions,
  warehouseTransferActions,
} from "../../../features/warehouseTransfer/WarehouseTransferActions";
import { WarehouseTransferStatusBadge } from "../../../components/badges/WarehouseTransferStatusBadge";
import { ShipmentChannelBadge } from "../../../components/badges/ShipmentChannelBadge";
import { RootTeamBadge } from "../../../components/entity/ActorName";
import { formatUnixDateTimeShort } from "../../../lib/datetime";
import { PRESSABLE } from "../../../lib/motion";

// ONE TRANSFER ON A WAREHOUSE'S PHONE — the restock inbound block's shape (the-warehouse-restock-list-follows-the-
// screen-rules), the crew's facts one context per line, NO values (the goods are a selling team's):
//
//   #601 [Dibuat]                                  13 Nov 08:47   which, where it has got to, when
//   Toko Melati · oleh Ani Rahayu [oleh Tim Root]                 whose goods, and who opened it (the-inbound-row-says-
//                                                                 who-and-when, the-transfer-lists-read-as-blocks-on-a-phone)
//   Ke Gudang Cabang                                              the other end — where it goes, or comes from
//   [JNE] JNE7788990011                                           how the box is found at the door
//   3 produk · 64 pcs                                             what is in it
//   SKU-BERAS-5K +2 lainnya
//                                                    [Proses]     the next act this side can do, named, at its foot —
//                                                                 the desktop row's own WarehouseTransferActions, so it
//                                                                 runs the same dialog and the same write
export function WarehouseTransferBlock({
  transfer,
  teamId,
  direction,
  ownerName,
  otherName,
  createdBy,
  courier,
  onOpen,
}: {
  transfer: WarehouseTransfer;
  /** The warehouse reading it — A or B. */
  teamId: bigint;
  direction: "outgoing" | "incoming";
  ownerName: string;
  /** The other end's name — where it goes (outgoing), or comes from (incoming). */
  otherName: string;
  /** Who opened it, as the page names them — empty when not recorded. */
  createdBy: string;
  courier: ShipmentChannel | undefined;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const id = transfer.id.toString();
  const stop = (e: MouseEvent) => e.stopPropagation();
  // Nothing to do while the admin team monitors (the-admin-team-monitors-read-only): no empty foot either.
  const writable = useCanWrite();
  const hasActs = writable && warehouseTransferActions(transfer.status, direction).length > 0;

  return (
    <Stack
      data-testid={`transfer-row-${id}`}
      borderWidth="1px"
      borderRadius="md"
      p="4"
      gap="2"
      minW="0"
      {...PRESSABLE}
      onClick={onOpen}
    >
      <Flex align="center" gap="2" minW="0">
        <Text fontWeight="bold" flexShrink={0}>
          #{id}
        </Text>
        <WarehouseTransferStatusBadge status={transfer.status} />
        <Text fontSize="xs" color="fg.muted" ms="auto" whiteSpace="nowrap">
          {formatUnixDateTimeShort(transfer.createdAtUnix)}
        </Text>
      </Flex>

      {/* Root's transfer from outside: the line WRAPS rather than cut the badge off — an inline-flex badge inside a
          clamped line vanishes whole, and two rows are not enough for a long shop and a long name at 320px. */}
      <Text
        fontSize="sm"
        minW="0"
        {...(transfer.createdByIsOverride ? { wordBreak: "break-word" } : { truncate: true })}
        data-testid={`transfer-owner-${id}`}
      >
        {ownerName}
        {createdBy && (
          <Span fontSize="xs" color="fg.muted" data-testid={`transfer-created-by-${id}`}>
            {" · "}
            {t("warehouseTransfer.table.by", { name: createdBy })}
            {transfer.createdByIsOverride && <RootTeamBadge size="xs" ms="1.5" />}
          </Span>
        )}
      </Text>

      <Text fontSize="sm" minW="0" wordBreak="break-word" data-testid={`transfer-other-${id}`}>
        <Span fontSize="xs" color="fg.muted">
          {direction === "outgoing" ? t("warehouseTransfer.table.to") : t("warehouseTransfer.table.from")}
        </Span>{" "}
        {otherName}
      </Text>

      {/* A box shipped by the warehouse's own vehicle may carry a number and no courier
          (a-transfer-may-travel-without-a-courier) — the number is still how it is found at the door. */}
      {(transfer.shipmentId > 0n || transfer.receipt !== "") && (
        <Flex align="center" gap="2" fontSize="xs" color="fg.muted" minW="0" data-testid={`transfer-parcel-${id}`}>
          {transfer.shipmentId > 0n && <ShipmentChannelBadge channelId={transfer.shipmentId} channel={courier} />}
          {transfer.receipt && (
            <Span minW="0" truncate fontFamily="mono">
              {transfer.receipt}
            </Span>
          )}
        </Flex>
      )}

      {/* The product list opens in its dialog, not the transfer — as the restock blocks keep theirs. */}
      <Box minW="0" fontSize="sm" onClick={stop}>
        <TransferItemsCell items={transfer.items} showPrices={false} />
      </Box>

      {hasActs && (
        <Flex justify="end" pt="1" onClick={stop}>
          <WarehouseTransferActions transfer={transfer} teamId={teamId} variant="row" />
        </Flex>
      )}
    </Stack>
  );
}
