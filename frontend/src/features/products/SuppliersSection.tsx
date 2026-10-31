import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import { HStack, Icon, Link, Spinner, Stack, Table, Text } from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";

import { MarketplaceBadge } from "../../components/badges/MarketplaceBadge";
import { useIsMobile } from "../../layouts/shell";
import { formatUnixDate } from "../../lib/datetime";
import { formatRupiah } from "../../lib/money";
import type { SupplierChannelRecord } from "../suppliers/adapt";
import { type ProductSupplierRow, useProductSupplierSample } from "./supplierSample";

// A ROW LIGHTS UP under the pointer, every cell of it (a-table-row-lights-up).
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

// THE PRODUCT'S SUPPLIERS — who has delivered it, AT WHICH OF THEIR STORES it was bought, how often, how much, and when
// last (owner: *"pemasok di keduanya ada toko pemasoknya, lalu kalau ada linknya bearti toko pemasok bisa buka link
// itu"*, the-supplier-tab-names-the-store). The Pemasok tab of the product's own page and of its discover detail — ONE
// component, so the two pages say the same suppliers.
//
//   Pemasok            the supplier, its team under it — opens the supplier's discover detail (it is usually another team's)
//   Toko pemasok       the store it was bought at — the name, the marketplace under it; the name OPENS THE STORE when it
//                      has a link
//   Kiriman · Unit     how often, how many
//   Modal terakhir     the owner's last unit cost — the owner's page only (`showCost`): another team never sees a cost
//   Kiriman terakhir
//
// ⚠ The rows are SAMPLES until the links and the grouping exist (supplierSample.ts) — the tab carries its page's mark.
// Mounted only while its tab is open, so the suppliers are read only then.
export function SuppliersSection({
  teamId,
  productId,
  showCost,
}: {
  teamId: bigint | undefined;
  productId: bigint;
  /** The owner's last unit cost — the owner's own page. */
  showCost: boolean;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { rows, isPending } = useProductSupplierSample({ teamId, productId });

  if (isPending) {
    return <Spinner colorPalette="brand" size="sm" />;
  }

  if (rows.length === 0) {
    return (
      <Text color="fg.muted" fontSize="sm" data-testid="pd-suppliers-empty">
        {t("products.detail.suppliers.none")}
      </Text>
    );
  }

  if (isMobile) {
    // A PHONE READS EACH SUPPLIER AS A BLOCK (a-phone-reads-each-line-as-a-block): the supplier and its last delivery,
    // the store, then how often and how many — and the last cost on the owner's page.
    return (
      <Stack gap="2" data-testid="pd-suppliers-table">
        {rows.map((r, i) => (
          <Stack key={i} borderWidth="1px" borderRadius="md" p="3" gap="1" data-testid={`pd-supplier-row-${i}`}>
            <HStack justify="space-between" gap="2" align="start">
              <SupplierName row={r} />
              <Text fontSize="sm" color="fg.muted" flexShrink={0}>
                {formatUnixDate(r.lastDeliveryUnix)}
              </Text>
            </HStack>
            <StoreName channel={r.channel} />
            <HStack justify="space-between" gap="2" fontSize="sm">
              <Text>
                {t("products.detail.suppliers.deliveriesCount", { count: r.deliveries })} ·{" "}
                {t("products.stat.pcs", { n: r.units })}
              </Text>
              {showCost && <Text fontWeight="medium">{formatRupiah(r.lastUnitCost)}</Text>}
            </HStack>
          </Stack>
        ))}
      </Stack>
    );
  }

  return (
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
          <Table.Row key={i} css={LIGHTS_UP} data-testid={`pd-supplier-row-${i}`}>
            <Table.Cell>
              <SupplierName row={r} />
            </Table.Cell>
            <Table.Cell>
              <StoreName channel={r.channel} />
            </Table.Cell>
            <Table.Cell textAlign="end">{r.deliveries}</Table.Cell>
            <Table.Cell textAlign="end">{t("products.stat.pcs", { n: r.units })}</Table.Cell>
            {showCost && (
              <Table.Cell textAlign="end" data-testid={`pd-supplier-cost-${i}`}>
                {formatRupiah(r.lastUnitCost)}
              </Table.Cell>
            )}
            <Table.Cell>{formatUnixDate(r.lastDeliveryUnix)}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}

/** Two lines, one context: the supplier, and whose list it is on. Opens the supplier's discover detail. */
function SupplierName({ row }: { row: ProductSupplierRow }) {
  return (
    <Stack gap="0" minW="0">
      <Link asChild fontWeight="bold" colorPalette="brand">
        <RouterLink to={`/inventories/suppliers/discover/${row.supplier.id}`} data-testid={`supplier-open-${row.supplier.id}`}>
          {row.supplier.name}
        </RouterLink>
      </Link>
      <Text fontSize="xs" color="fg.muted" lineClamp={1}>
        {row.supplier.teamName}
      </Text>
    </Stack>
  );
}

/**
 * THE SUPPLIER'S STORE — its name, and its marketplace UNDER it (owner: *"badge toko di bawah nama toko, kepanjangan
 * soalnya"*): side by side the two ran too long. With a link, the name OPENS THE STORE in a new tab, an arrow saying it
 * leaves the app; without one it is plain text, never a link to nowhere.
 */
function StoreName({ channel }: { channel: SupplierChannelRecord }) {
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
      <MarketplaceBadge marketplace={channel.channelType} />
    </Stack>
  );
}
