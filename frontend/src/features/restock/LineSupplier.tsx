import { HStack, Span, Stack } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import type { RestockRequestItem } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import type { SupplierChannel } from "../../gen/warehouse/supplier/v1/supplier_channel_pb";
import { DeletedBadge } from "../../components/badges/DeletedBadge";
import { MarketplaceBadge } from "../../components/badges/MarketplaceBadge";
import type { SupplierRecord } from "../suppliers/adapt";
import { useSupplierChannelsByIds, useSuppliersByIds } from "../suppliers/queries";

// WHERE A RESTOCK LINE WAS BOUGHT — its supplier and, when it has one, the store (a-line-names-the-channel-it-was-
// bought-from, a-line-may-name-a-supplier-without-a-channel). Shared by the form's line rows and both detail pages, so
// a line reads the same on every screen.
//
// A deleted supplier or store is still shown, read from the kept rows, with a DeletedBadge
// (a-deleted-supplier-still-shows-with-a-badge). A line connected to nothing says so.

// Resolve every line's supplier and store in two by-id reads — one per kind, not one per line.
export function useLineSuppliers(teamId: bigint | undefined, items: Pick<RestockRequestItem, "supplierId" | "supplierChannelId">[]) {
  const suppliers = useSuppliersByIds({ teamId, supplierIds: items.map((i) => i.supplierId) });
  const channels = useSupplierChannelsByIds({ teamId, channelIds: items.map((i) => i.supplierChannelId) });

  const supplierMap: Record<string, SupplierRecord> = {};
  for (const [id, s] of suppliers.data ?? new Map<string, SupplierRecord>()) supplierMap[id] = s;

  return { suppliers: supplierMap, channels: (channels.data ?? {}) as Record<string, SupplierChannel> };
}

export interface LineSupplierProps {
  supplierId: bigint;
  supplierChannelId: bigint;
  suppliers: Record<string, SupplierRecord>;
  channels: Record<string, SupplierChannel>;
  testId?: string;
}

export function LineSupplier({ supplierId, supplierChannelId, suppliers, channels, testId }: LineSupplierProps) {
  const { t } = useTranslation();

  if (supplierId === 0n) {
    return (
      <Span fontSize="sm" color="fg.muted" data-testid={testId}>
        {t("restock.lineSupplier.none")}
      </Span>
    );
  }

  const supplier = suppliers[supplierId.toString()];
  const channel = supplierChannelId > 0n ? channels[supplierChannelId.toString()] : undefined;

  return (
    <Stack gap="0.5" minW="0" data-testid={testId}>
      <HStack gap="1.5" minW="0">
        <Span fontSize="sm" fontWeight="medium" lineClamp={1}>
          {supplier?.name ?? t("restock.lineSupplier.unknownSupplier", { id: supplierId.toString() })}
        </Span>
        {supplier?.deleted && <DeletedBadge />}
      </HStack>
      {supplierChannelId > 0n ? (
        <HStack gap="1.5" minW="0">
          {channel && <MarketplaceBadge marketplace={channel.channelType} />}
          <Span fontSize="xs" color="fg.muted" lineClamp={1}>
            {channel?.name ?? t("restock.lineSupplier.unknownStore", { id: supplierChannelId.toString() })}
          </Span>
          {channel?.deleted && <DeletedBadge />}
        </HStack>
      ) : (
        <Span fontSize="xs" color="fg.muted">
          {t("restock.lineSupplier.noStore")}
        </Span>
      )}
    </Stack>
  );
}
