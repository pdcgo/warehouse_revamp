import { useTranslation } from "react-i18next";
import { Badge, Box, Card, Flex, Heading, HStack, Icon, Spacer, Stack, Table, Text } from "@chakra-ui/react";
import { Archive, Lock } from "lucide-react";

import { TeamType } from "../../../gen/warehouse/team/v1/team_pb";
import { unavailable } from "../../../features/bundles/adapt";
import { SummaryCard, SummaryStrip } from "../../../features/orders/SummaryCard";
import { useIsMobile } from "../../../layouts/shell";
import { TeamSelect } from "../../../components/teams/TeamSelect";
import { ProductListItem } from "../../../components/products/ProductListItem";
import type { BundleMakes, LineMakes } from "../makes";

const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

// WHAT ONE WAREHOUSE'S STOCK CAN MAKE (a-bundle-has-a-detail-page-that-counts-what-stock-can-make) — the warehouse
// picked, the headline "Can make", and per product: how many go in one bundle, what is ready, how many bundles that is
// enough for. The line that runs out first is marked, because that is the product to restock.
export function BundleStockCard({
  makes,
  warehouseId,
  warehouseName,
  onWarehouse,
  owners,
  loading,
}: {
  makes: BundleMakes;
  warehouseId: bigint;
  warehouseName: string | undefined;
  onWarehouse: (id: bigint) => void;
  /** Team names by id — the owner of a borrowed line. */
  owners: Record<string, { name: string }> | undefined;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const ownerOf = (line: LineMakes) =>
    line.product ? owners?.[line.product.teamId.toString()]?.name : undefined;
  const borrowed = (line: LineMakes) => line.state === "borrowed" || line.state === "locked";

  function product(line: LineMakes) {
    return (
      <ProductListItem
        product={{
          id: line.productId,
          teamId: borrowed(line) ? line.product?.teamId : undefined,
          sku: line.product?.sku,
          name: line.product
            ? `${line.product.name}${line.state === "archived" ? ` ${t("bundles.archivedSuffix")}` : ""}`
            : undefined,
          defaultImageUrl: line.product?.defaultImageUrl,
          defaultImageThumbnailUrl: line.product?.defaultImageThumbnailUrl,
        }}
        teamName={borrowed(line) ? ownerOf(line) : undefined}
      />
    );
  }

  // What the line can NOT do, in words — under the product on a phone, beside the figure on a desktop.
  function why(line: LineMakes, i: number) {
    if (unavailable(line.state)) {
      return (
        <HStack gap="1" color="warning.fg" data-testid={`bundle-stock-${i}-unavailable`}>
          <Icon as={line.state === "locked" ? Lock : Archive} boxSize="3.5" />
          <Text fontSize="xs">{line.state === "locked" ? t("bundles.detail.lockedShort") : t("bundles.detail.archivedShort")}</Text>
        </HStack>
      );
    }
    if (line.belowReserve) {
      return (
        <Text fontSize="xs" color="warning.fg" data-testid={`bundle-stock-${i}-reserve`}>
          {t("bundles.detail.belowReserve", { team: ownerOf(line) ?? t("bundles.detail.itsOwner") })}
        </Text>
      );
    }
    if (i === makes.limit) {
      return (
        // Its own width — in a phone block's column a badge would otherwise stretch across the whole block.
        <Badge colorPalette="warning" variant="subtle" alignSelf="flex-start" data-testid={`bundle-stock-${i}-limit`}>
          {t("bundles.detail.runsOutFirst")}
        </Badge>
      );
    }
    return null;
  }

  const figure = (value: bigint | number | undefined) => (value === undefined ? "—" : value.toString());

  return (
    <Card.Root>
      <Card.Body>
        <Stack gap="card">
          <Flex align="center" gap="card" wrap="wrap">
            <Heading size="sm">{t("bundles.detail.stockTitle")}</Heading>
            <Spacer />
            <Box minW={{ base: "full", sm: "16rem" }} data-testid="bundle-stock-warehouse">
              <TeamSelect
                value={warehouseId}
                onChange={onWarehouse}
                teamType={TeamType.WAREHOUSE}
                placeholder={t("bundles.detail.pickWarehouse")}
              />
            </Box>
          </Flex>

          <SummaryStrip testId="bundle-stock-summary">
            <SummaryCard
              label={t("bundles.detail.canMake")}
              value={
                <Text as="span" data-testid="bundle-can-make">
                  {loading || makes.canMake === undefined ? "—" : t("bundles.detail.bundles", { count: makes.canMake })}
                </Text>
              }
              line={warehouseName ? t("bundles.detail.atWarehouse", { name: warehouseName }) : undefined}
              emphasis
              wide={isMobile}
            />
          </SummaryStrip>

          {isMobile ? (
            // A PHONE READS EACH LINE AS A BLOCK (a-phone-reads-each-line-as-a-block): the product at full width, then
            // its arithmetic as one line.
            <Stack gap="2" data-testid="bundle-stock-table">
              {makes.lines.map((line, i) => (
                <Stack key={line.productId.toString()} borderWidth="1px" borderRadius="md" p="3" gap="1.5" data-testid={`bundle-stock-${i}`}>
                  {product(line)}
                  {!unavailable(line.state) && (
                    <Text fontSize="sm" data-testid={`bundle-stock-${i}-sum`}>
                      {t("bundles.detail.sum", { per: line.quantity, ready: figure(line.ready), enough: figure(line.enough) })}
                    </Text>
                  )}
                  {why(line, i)}
                </Stack>
              ))}
            </Stack>
          ) : (
            <Table.Root size="sm" data-testid="bundle-stock-table">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("bundles.detail.col.product")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("bundles.detail.col.perBundle")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("bundles.detail.col.ready")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("bundles.detail.col.enoughFor")}</Table.ColumnHeader>
                  <Table.ColumnHeader />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {makes.lines.map((line, i) => (
                  <Table.Row key={line.productId.toString()} css={LIGHTS_UP} data-testid={`bundle-stock-${i}`}>
                    <Table.Cell>{product(line)}</Table.Cell>
                    <Table.Cell textAlign="end">{line.quantity}</Table.Cell>
                    <Table.Cell textAlign="end" data-testid={`bundle-stock-${i}-ready`}>
                      {figure(line.ready)}
                    </Table.Cell>
                    <Table.Cell textAlign="end" fontWeight={i === makes.limit ? "bold" : undefined} data-testid={`bundle-stock-${i}-enough`}>
                      {figure(line.enough)}
                    </Table.Cell>
                    <Table.Cell>{why(line, i)}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          )}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
