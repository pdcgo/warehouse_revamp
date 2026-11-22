import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import { Flex, HStack, Icon, Link, Spinner, Stack, Table, Text } from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";

import { DeletedBadge } from "../../components/badges/DeletedBadge";
import { MarketplaceBadge } from "../../components/badges/MarketplaceBadge";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import type { SupplierChannel } from "../../gen/warehouse/supplier/v1/supplier_channel_pb";
import { useIsMobile } from "../../layouts/shell";
import { formatUnixDate } from "../../lib/datetime";
import { formatRupiah } from "../../lib/money";
import type { SupplierRecord } from "../suppliers/adapt";
import { useSupplierChannelsByIds, useSuppliersByIds } from "../suppliers/queries";
import { useTeamsByIds } from "../teams/queries";
import type { ProductSupplierRow } from "./adapt";
import { useProductSupplierGoods } from "./queries";

// A ROW LIGHTS UP under the pointer, every cell of it (a-table-row-lights-up).
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

const PAGE_SIZE = 20;

// THE PRODUCT'S SUPPLIERS — who has delivered it, AT WHICH OF THEIR STORES it was bought, how often, how much, and when
// last (owner: *"pemasok di keduanya ada toko pemasoknya, lalu kalau ada linknya bearti toko pemasok bisa buka link
// itu"*, the-supplier-tab-names-the-store). The Pemasok tab of the product's own page and of its discover detail — ONE
// component, so the two pages say the same suppliers.
//
//   Pemasok            the supplier, its team under it — opens the supplier's discover detail (it is usually another team's)
//   Toko pemasok       the store it was bought at — the name, the marketplace under it; the name OPENS THE STORE when it
//                      has a link; — for lines that named the supplier and no store (a-line-with-no-store-links-under-the-
//                      supplier)
//   Kiriman · Unit     how many accepted restocks brought it, and their good units
//   Modal terakhir     the owner's last unit cost — the owner's page only (`showCost`): the server sends it to the owning
//                      team alone, so another team never even receives a cost
//   Kiriman terakhir
//
// REAL since 2026-11-21: InventoryService.ProductSupplierGoods groups the owner's restock batches per supplier and store
// — a transfer-in is not a delivery — and the names come from supplier_service's by-id reads, as a restock line names
// its supplier (LineSupplier). It follows the page's WAREHOUSE PICKER (the-warehouse-picker-splits-the-page): only the
// deliveries received there. Mounted only while its tab is open, so the suppliers are read only then.
export function SuppliersSection({
  teamId,
  productId,
  warehouseId,
  showCost,
}: {
  teamId: bigint | undefined;
  productId: bigint;
  /** The page's warehouse lens — 0n is every warehouse. */
  warehouseId: bigint;
  /** The owner's last unit cost — the owner's own page. */
  showCost: boolean;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [page, setPage] = useLensPage(warehouseId);
  const goods = useProductSupplierGoods({ teamId, productId, warehouseId, page, pageSize: PAGE_SIZE });
  const rows = goods.data?.rows ?? [];
  const totalItems = goods.data?.totalItems ?? 0;

  // THE NAMES, in two by-id reads for the page — one per kind, not one per row — and the suppliers' teams in a third.
  const suppliers = useSuppliersByIds({ teamId, supplierIds: rows.map((r) => r.supplierId) });
  const channels = useSupplierChannelsByIds({ teamId, channelIds: rows.map((r) => r.storeId) });
  const supplierOf = (id: bigint) => suppliers.data?.get(id.toString());
  const teams = useTeamsByIds({ ids: [...(suppliers.data?.values() ?? [])].map((s) => s.teamId) });
  const teamNameOf = (s: SupplierRecord | undefined) => (s ? (teams.data?.[s.teamId.toString()]?.name ?? "") : "");
  const channelOf = (id: bigint): SupplierChannel | undefined => channels.data?.[id.toString()];

  if (goods.isPending) {
    return <Spinner colorPalette="brand" size="sm" />;
  }

  if (rows.length === 0 && page === 1) {
    return (
      <Stack gap="1" data-testid="pd-suppliers-empty">
        <Text color="fg.muted" fontSize="sm">
          {t("products.detail.suppliers.none")}
        </Text>
        {warehouseId > 0n && (
          <Text color="fg.muted" fontSize="xs">
            {t("products.detail.emptyInWarehouse")}
          </Text>
        )}
      </Stack>
    );
  }

  // ON PAGE 1, A LIST THAT FITS HAS NO PAGER (no-list-on-the-product-page-pages-when-it-fits) — from page 2 on it always
  // shows, so the way back is never lost.
  const fits = page === 1 && totalItems <= PAGE_SIZE;
  const refreshing = goods.isFetching && !goods.isPending;

  const cost = (r: ProductSupplierRow) => (r.lastUnitCost === undefined ? "—" : formatRupiah(r.lastUnitCost));

  const list = isMobile ? (
    // A PHONE READS EACH SUPPLIER AS A BLOCK (a-phone-reads-each-line-as-a-block): the supplier and its last delivery,
    // the store, then how often and how many — and the last cost on the owner's page.
    <Stack gap="2" data-testid="pd-suppliers-table">
      {rows.map((r, i) => (
        <Stack
          key={r.id.toString()}
          borderWidth="1px"
          borderRadius="md"
          p="3"
          gap="1"
          data-testid={`pd-supplier-row-${i}`}
          data-supplier-id={r.supplierId.toString()}
          data-store-id={r.storeId.toString()}
        >
          <HStack justify="space-between" gap="2" align="start">
            <SupplierName supplierId={r.supplierId} supplier={supplierOf(r.supplierId)} teamName={teamNameOf(supplierOf(r.supplierId))} />
            <Text fontSize="sm" color="fg.muted" flexShrink={0} data-testid={`pd-supplier-last-${i}`}>
              {formatUnixDate(r.lastDeliveryUnix)}
            </Text>
          </HStack>
          <StoreName supplierId={r.supplierId} storeId={r.storeId} channel={channelOf(r.storeId)} />
          <HStack justify="space-between" gap="2" fontSize="sm">
            <Text>
              <Text as="span" data-testid={`pd-supplier-deliveries-${i}`}>
                {t("products.detail.suppliers.deliveriesCount", { count: Number(r.deliveries) })}
              </Text>{" "}
              ·{" "}
              <Text as="span" data-testid={`pd-supplier-units-${i}`}>
                {t("products.stat.pcs", { n: r.units.toString() })}
              </Text>
            </Text>
            {showCost && (
              <Text fontWeight="medium" data-testid={`pd-supplier-cost-${i}`}>
                {cost(r)}
              </Text>
            )}
          </HStack>
        </Stack>
      ))}
    </Stack>
  ) : (
    <Table.Root size="sm" data-testid="pd-suppliers-table">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>{t("products.detail.suppliers.supplier")}</Table.ColumnHeader>
          <Table.ColumnHeader>{t("products.detail.suppliers.store")}</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end">{t("products.detail.suppliers.deliveries")}</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end">{t("products.detail.suppliers.units")}</Table.ColumnHeader>
          {showCost && <Table.ColumnHeader textAlign="end">{t("products.detail.suppliers.lastCost")}</Table.ColumnHeader>}
          <Table.ColumnHeader>{t("products.detail.suppliers.last")}</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map((r, i) => (
          <Table.Row
            key={r.id.toString()}
            css={LIGHTS_UP}
            data-testid={`pd-supplier-row-${i}`}
            data-supplier-id={r.supplierId.toString()}
            data-store-id={r.storeId.toString()}
          >
            <Table.Cell>
              <SupplierName supplierId={r.supplierId} supplier={supplierOf(r.supplierId)} teamName={teamNameOf(supplierOf(r.supplierId))} />
            </Table.Cell>
            <Table.Cell>
              <StoreName supplierId={r.supplierId} storeId={r.storeId} channel={channelOf(r.storeId)} />
            </Table.Cell>
            <Table.Cell textAlign="end" data-testid={`pd-supplier-deliveries-${i}`}>
              {r.deliveries.toString()}
            </Table.Cell>
            <Table.Cell textAlign="end" data-testid={`pd-supplier-units-${i}`}>
              {t("products.stat.pcs", { n: r.units.toString() })}
            </Table.Cell>
            {showCost && (
              <Table.Cell textAlign="end" data-testid={`pd-supplier-cost-${i}`}>
                {cost(r)}
              </Table.Cell>
            )}
            <Table.Cell data-testid={`pd-supplier-last-${i}`}>{formatUnixDate(r.lastDeliveryUnix)}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );

  return (
    <Stack gap="card">
      <RefreshOverlay busy={refreshing}>{list}</RefreshOverlay>

      {/* THE PAGES GROW AS THEY ARE OPENED (every-list-pages-with-the-growing-pager) — and only when there is more than
          one page to open. */}
      {!fits && (
        <Flex justify="flex-end">
          <GrowingPager
            page={page}
            onPageChange={setPage}
            hasNext={goods.isPlaceholderData ? undefined : page * PAGE_SIZE < totalItems}
            resetKey={warehouseId.toString()}
            pageSize={PAGE_SIZE}
            testId="pd-suppliers-pager"
          />
        </Flex>
      )}
    </Stack>
  );
}

/**
 * The page's warehouse lens and the page it is on — a NEW LENS IS A NEW SET OF ROWS, so page 2 of the old one means
 * nothing: the section starts again at page 1 (state adjusted during render, React's own pattern for a prop that resets
 * it) — Riwayat Stok's rule.
 */
function useLensPage(warehouseId: bigint) {
  const [page, setPage] = useState(1);
  const [lens, setLens] = useState(warehouseId);
  if (lens !== warehouseId) {
    setLens(warehouseId);
    setPage(1);
  }

  return [page, setPage] as const;
}

/**
 * Two lines, one context: the supplier, and whose list it is on. Opens the supplier's discover detail — a DELETED
 * supplier is still named, badged, and opens nothing (a-deleted-supplier-still-shows-with-a-badge: its page is gone).
 */
function SupplierName({
  supplierId,
  supplier,
  teamName,
}: {
  supplierId: bigint;
  supplier: SupplierRecord | undefined;
  teamName: string;
}) {
  const { t } = useTranslation();
  const name = supplier?.name ?? t("products.detail.suppliers.unknownSupplier", { id: supplierId.toString() });

  return (
    <Stack gap="0" minW="0">
      {supplier && !supplier.deleted ? (
        <Link asChild fontWeight="bold" colorPalette="brand">
          <RouterLink to={`/inventories/suppliers/discover/${supplierId}`} data-testid={`supplier-open-${supplierId}`}>
            {name}
          </RouterLink>
        </Link>
      ) : (
        <HStack gap="1.5" minW="0">
          <Text fontWeight="bold" lineClamp={1} data-testid={`supplier-name-${supplierId}`}>
            {name}
          </Text>
          {supplier?.deleted && <DeletedBadge />}
        </HStack>
      )}
      <Text fontSize="xs" color="fg.muted" lineClamp={1}>
        {teamName}
      </Text>
    </Stack>
  );
}

/**
 * THE SUPPLIER'S STORE — its name, and its marketplace UNDER it (owner: *"badge toko di bawah nama toko, kepanjangan
 * soalnya"*): side by side the two ran too long. With a link, the name OPENS THE STORE in a new tab, an arrow saying it
 * leaves the app; without one it is plain text, never a link to nowhere. Lines that named no store read — under their
 * supplier (a-line-with-no-store-links-under-the-supplier), as the supplier's Produk tab says it.
 */
function StoreName({
  supplierId,
  storeId,
  channel,
}: {
  supplierId: bigint;
  storeId: bigint;
  channel: SupplierChannel | undefined;
}) {
  const { t } = useTranslation();

  if (storeId === 0n) {
    return (
      <Text color="fg.muted" title={t("products.detail.suppliers.noStore")} data-testid={`supplier-store-none-${supplierId}`}>
        —
      </Text>
    );
  }

  if (!channel) {
    return (
      <Text color="fg.muted" data-testid={`supplier-store-${storeId}`}>
        {t("products.detail.suppliers.unknownStore", { id: storeId.toString() })}
      </Text>
    );
  }

  return (
    <Stack gap="1" align="start" minW="0" data-testid={`supplier-store-${channel.id}`}>
      {channel.uri ? (
        <Link
          href={channel.uri}
          target="_blank"
          rel="noreferrer"
          colorPalette="brand"
          minW="0"
          data-testid={`supplier-store-link-${channel.id}`}
        >
          <Text as="span" lineClamp={1}>
            {channel.name}
          </Text>
          <Icon as={ExternalLink} boxSize="3" flexShrink={0} />
        </Link>
      ) : (
        <Text lineClamp={1}>{channel.name}</Text>
      )}
      <HStack gap="1.5">
        <MarketplaceBadge marketplace={channel.channelType} />
        {channel.deleted && <DeletedBadge />}
      </HStack>
    </Stack>
  );
}
