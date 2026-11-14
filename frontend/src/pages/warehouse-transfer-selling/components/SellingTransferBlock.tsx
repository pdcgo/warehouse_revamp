import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Box, Flex, Icon, Span, Spacer, Stack, Text } from "@chakra-ui/react";
import { ArrowRight } from "lucide-react";

import type { WarehouseTransfer } from "../../../gen/warehouse/inventory/v1/warehouse_transfer_pb";
import type { ShipmentChannel } from "../../../gen/warehouse/shipment/v1/shipment_pb";
import { problemUnits } from "../../../features/warehouseTransfer/summary";
import { TransferItemsCell } from "../../../features/warehouseTransfer/TransferItemsCell";
import { SellingTransferActions } from "../../../features/warehouseTransfer/SellingTransferActions";
import { WarehouseTransferStatusBadge } from "../../../components/badges/WarehouseTransferStatusBadge";
import { ShipmentChannelBadge } from "../../../components/badges/ShipmentChannelBadge";
import { RootTeamBadge } from "../../../components/entity/ActorName";
import { formatUnixDateTimeShort } from "../../../lib/datetime";
import { formatRupiahNumber } from "../../../lib/money";
import { PRESSABLE } from "../../../lib/motion";

// ONE TRANSFER ON A PHONE — the team's own transfer as a block (a-phone-reads-each-line-as-a-block), the desktop row's
// facts one context per line, names at full width:
//
//   #603 [Dikirim] 2 unit rusak atau kurang                 ⋯     which, where it has got to, what it allows
//   Gudang Pusat → Gudang Cabang                                  the route leads — by warehouse NAME, wrapping when long
//   3 produk · 64 pcs                              Rp 1.250.000   what is in it, and the goods' value
//   SKU-BERAS-5K +2 lainnya                                       (the whole list a tap away, ProductLinesDialog)
//   [JNE] Ongkir Rp 18.000                                        how it travels, and what that costs — BESIDE the value,
//                                                                 never inside it (a-transfer-has-the-restocks-two-costs)
//   10 Nov 08:47 · oleh Fajar Nugroho [oleh Tim Root]             when it was opened, and by whom
//
// The ⋯ heads the block as on the restock list's block (the-restock-list-follows-the-screen-rules); the by-line ends it
// with the override badge after the name (an-override-shows-a-platform-badge) — that line wraps rather than cut the badge
// off (an inline-flex badge inside `truncate` or a clamp vanishes whole; a long name at 320px needs more than two rows). Room as the restock blocks: 16px inside,
// 8px between lines. The block opens the transfer, so it lights up and gives under a thumb (a-table-row-lights-up).
export function SellingTransferBlock({
  transfer,
  teamId,
  warehouseName,
  createdBy,
  courier,
  onOpen,
}: {
  transfer: WarehouseTransfer;
  teamId: bigint;
  warehouseName: (id: bigint) => string;
  /** Who opened it, as the page names them — empty when not recorded. */
  createdBy: string;
  courier: ShipmentChannel | undefined;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const id = transfer.id.toString();
  const problems = problemUnits(transfer);
  const stop = (e: MouseEvent) => e.stopPropagation();

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
        {problems > 0n && (
          <Span fontSize="xs" color="warning.fg" minW="0" truncate data-testid={`transfer-problems-${id}`}>
            {t("warehouseTransfer.table.problemUnits", { count: Number(problems) })}
          </Span>
        )}
        <Spacer />
        <Box display="inline-flex" flexShrink={0} onClick={stop}>
          <SellingTransferActions transfer={transfer} teamId={teamId} variant="menu" />
        </Box>
      </Flex>

      <Flex
        align="center"
        columnGap="1.5"
        wrap="wrap"
        fontSize="sm"
        fontWeight="medium"
        minW="0"
        data-testid={`transfer-route-${id}`}
      >
        <Span wordBreak="break-word">{warehouseName(transfer.fromWarehouseId)}</Span>
        <Icon as={ArrowRight} boxSize="3" color="fg.muted" flexShrink={0} />
        <Span wordBreak="break-word">{warehouseName(transfer.toWarehouseId)}</Span>
      </Flex>

      <Flex align="flex-start" justify="space-between" gap="3" minW="0">
        {/* The product list opens in its dialog, not the transfer — as the restock blocks keep theirs. */}
        <Box minW="0" fontSize="sm" onClick={stop}>
          <TransferItemsCell items={transfer.items} />
        </Box>
        <Text fontWeight="bold" whiteSpace="nowrap" data-testid={`transfer-value-${id}`}>
          {formatRupiahNumber(transfer.total)}
        </Text>
      </Flex>

      <Flex align="center" gap="2" fontSize="xs" color="fg.muted" minW="0">
        {transfer.shipmentId > 0n && <ShipmentChannelBadge channelId={transfer.shipmentId} channel={courier} />}
        <Span data-testid={`transfer-cost-${id}`}>
          {transfer.shipmentCost > 0
            ? t("warehouseTransfer.shippingCost", { amount: formatRupiahNumber(transfer.shipmentCost) })
            : t("warehouseTransfer.table.noCost")}
        </Span>
      </Flex>

      <Text
        fontSize="xs"
        color="fg.muted"
        minW="0"
        {...(transfer.createdByIsOverride ? { wordBreak: "break-word" } : { truncate: true })}
        data-testid={`transfer-when-${id}`}
      >
        {formatUnixDateTimeShort(transfer.createdAtUnix)}
        {createdBy && (
          <Span data-testid={`transfer-created-by-${id}`}>
            {" · "}
            {t("warehouseTransfer.table.by", { name: createdBy })}
            {transfer.createdByIsOverride && <RootTeamBadge size="xs" ms="1.5" />}
          </Span>
        )}
      </Text>
    </Stack>
  );
}
