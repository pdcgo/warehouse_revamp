import { useTranslation } from "react-i18next";
import { Box, Flex, Stack, Table, Text } from "@chakra-ui/react";

import type { ProductPick } from "../../../features/picking/bulkPick";
import { RackLine } from "./RackLine";

/** Every new table's row lights up under the pointer, every cell (a-table-row-lights-up). */
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

/**
 * PER PRODUK — *each product shown with total quantity and its racks* (acceptance inventory/order.md, bulk pick order,
 * grouped by product). One row per product over every ticked order, in WALK ORDER (by its first rack), so the crew takes
 * the whole of it in one stop per rack. The orders it is for are counted, not listed — Per Pesanan is that list.
 *
 * A desktop table; on a phone one block per product (a-phone-reads-each-line-as-a-block): the name and the total on the
 * first line, the racks under it.
 */
export function ByProductView({ products, mobile }: { products: ProductPick[]; mobile: boolean }) {
  const { t } = useTranslation();

  if (mobile) {
    return (
      <Stack gap="2" data-testid="bulk-pick-by-product" data-layout="blocks">
        {products.map((product) => (
          <Box
            key={product.productId.toString()}
            borderWidth="1px"
            borderColor="border"
            borderRadius="l2"
            bg="bg"
            p="3"
            data-testid={`bulk-pick-product-${product.productId}`}
            data-total={product.total}
          >
            <Stack gap="2">
              <Flex align="flex-start" gap="3">
                <Stack gap="0" flex="1" minW="0">
                  <Text fontWeight="bold" lineClamp={2}>
                    {product.name}
                  </Text>
                  <Text fontSize="xs" color="fg.muted">
                    {product.productCode} · {t("bulkPick.forOrders", { count: product.orderCount })}
                  </Text>
                </Stack>
                <Stack gap="0" align="flex-end" flexShrink={0}>
                  <Text fontSize="2xl" fontWeight="bold" lineHeight="1" data-testid={`bulk-pick-product-total-${product.productId}`}>
                    {product.total}
                  </Text>
                  <Text fontSize="xs" color="fg.muted">
                    {t("bulkPick.col.total")}
                  </Text>
                </Stack>
              </Flex>
              <RackLine
                racks={product.racks}
                unrecorded={product.unrecorded}
                testId={`bulk-pick-product-rack-${product.productId}`}
              />
            </Stack>
          </Box>
        ))}
      </Stack>
    );
  }

  return (
    <Box overflowX="auto" w="full" maxW="full" minW="0" borderWidth="1px" borderColor="border" borderRadius="l2" bg="bg">
      <Table.Root size="sm" data-testid="bulk-pick-by-product" data-layout="table">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("picking.table.product")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("bulkPick.col.total")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("bulkPick.col.racks")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("bulkPick.col.orders")}</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {products.map((product) => (
            <Table.Row
              key={product.productId.toString()}
              css={LIGHTS_UP}
              data-testid={`bulk-pick-product-${product.productId}`}
              data-total={product.total}
            >
              <Table.Cell>
                <Stack gap="0">
                  <Text>{product.name}</Text>
                  <Text fontSize="xs" color="fg.muted">
                    {product.productCode}
                  </Text>
                </Stack>
              </Table.Cell>
              <Table.Cell textAlign="end">
                <Text fontSize="lg" fontWeight="bold" data-testid={`bulk-pick-product-total-${product.productId}`}>
                  {product.total}
                </Text>
              </Table.Cell>
              <Table.Cell>
                <RackLine
                  racks={product.racks}
                  unrecorded={product.unrecorded}
                  testId={`bulk-pick-product-rack-${product.productId}`}
                />
              </Table.Cell>
              <Table.Cell textAlign="end" color="fg.muted" data-testid={`bulk-pick-product-orders-${product.productId}`}>
                {t("bulkPick.forOrders", { count: product.orderCount })}
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}
