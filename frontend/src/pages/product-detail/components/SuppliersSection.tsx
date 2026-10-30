import { useTranslation } from "react-i18next";
import { HStack, Stack, Table, Text } from "@chakra-ui/react";

import { useIsMobile } from "../../../layouts/shell";
import { formatUnixDate } from "../../../lib/datetime";
import { formatRupiah } from "../../../lib/money";
import type { SampleSupplier } from "../sampleMock";
import { LIGHTS_UP } from "./parts";

// THE PRODUCT'S SUPPLIERS — who has delivered it, how often, how much, at what last price, and when last. Every
// warehouse, so above the picker (the-warehouse-picker-splits-the-page). ⚠ The rows are SAMPLES until the server groups
// the batches by supplier — the section's mark says so (pending.ts `suppliers`).
export function SuppliersSection({ suppliers }: { suppliers: SampleSupplier[] }) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  if (isMobile) {
    // A PHONE READS EACH SUPPLIER AS A BLOCK (a-phone-reads-each-line-as-a-block).
    return (
      <Stack gap="2" data-testid="pd-suppliers-table">
        {suppliers.map((s, i) => (
          <Stack key={i} borderWidth="1px" borderRadius="md" p="3" gap="1" data-testid={`pd-supplier-row-${i}`}>
            <HStack justify="space-between" gap="2">
              <Text fontWeight="bold" truncate>
                {s.name}
              </Text>
              <Text fontSize="sm" color="fg.muted" flexShrink={0}>
                {formatUnixDate(s.lastDeliveryUnix)}
              </Text>
            </HStack>
            <HStack justify="space-between" gap="2" fontSize="sm">
              <Text>
                {t("products.detail.suppliers.deliveriesCount", { count: s.deliveries })} ·{" "}
                {t("products.stat.pcs", { n: s.units })}
              </Text>
              <Text fontWeight="medium">{formatRupiah(s.lastUnitCost)}</Text>
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
          <Table.ColumnHeader textAlign="end">{t("products.detail.suppliers.deliveries")}</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end">{t("products.detail.suppliers.units")}</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end">{t("products.detail.suppliers.lastCost")}</Table.ColumnHeader>
          <Table.ColumnHeader>{t("products.detail.suppliers.last")}</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {suppliers.map((s, i) => (
          <Table.Row key={i} css={LIGHTS_UP} data-testid={`pd-supplier-row-${i}`}>
            <Table.Cell>{s.name}</Table.Cell>
            <Table.Cell textAlign="end">{s.deliveries}</Table.Cell>
            <Table.Cell textAlign="end">{t("products.stat.pcs", { n: s.units })}</Table.Cell>
            <Table.Cell textAlign="end">{formatRupiah(s.lastUnitCost)}</Table.Cell>
            <Table.Cell>{formatUnixDate(s.lastDeliveryUnix)}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}
