import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Flex, HStack, Stack, Table, Text } from "@chakra-ui/react";
import type { SupplierChannelRecord } from "./adapt";
import { sampleProductsFor } from "./sampleProducts";
import { useIsMobile } from "../../layouts/shell";
import { FilterBar, FilterSearch } from "../../components/chrome/FilterBar";
import { Pagination } from "../../components/chrome/Pagination";
import { MarketplaceBadge } from "../../components/badges/MarketplaceBadge";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// ProductBrowser is a supplier's PRODUCTS tab — on the manage detail and on the discover detail alike
// (supplier-detail-has-channels-and-products-tabs): the products it sells, each with the channel it is bought
// from (products-hang-off-a-channel), searched and paged.
//
// ⚠ SAMPLE ROWS. How a product is linked to a channel is deferred (linking-products-is-deferred), so the rows
// are invented from the supplier's channels; each page that mounts this carries the `sample` mark. The search
// and the pager run over those rows here; the real read will do both on the server.
export function ProductBrowser({ channels }: { channels: SupplierChannelRecord[] }) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const all = sampleProductsFor(channels);
  const term = q.trim().toLowerCase();
  // The product, its SKU, or the channel it is bought from — what somebody looking for a source would type.
  const matching = term
    ? all.filter((p) => [p.name, p.sku, p.channel.name].some((field) => field.toLowerCase().includes(term)))
    : all;
  const products = matching.slice((page - 1) * pageSize, page * pageSize);

  function list() {
    if (products.length === 0) {
      return term ? (
        <Text color="fg.muted" data-testid="products-none-match">
          {t("supplierChannel.products.none")}
        </Text>
      ) : (
        <Text color="fg.muted" data-testid="products-empty">
          {t("supplierChannel.products.empty")}
        </Text>
      );
    }

    if (isMobile) {
      return (
        <Stack gap="2" data-testid="products-table">
          {products.map((p) => (
            <Flex key={p.key} data-testid={`product-row-${p.key}`} borderWidth="1px" borderRadius="md" p="3">
              <Stack gap="1" minW="0">
                <Text fontWeight="bold">{p.name}</Text>
                <HStack gap="2" fontSize="sm" color="fg.muted">
                  <Text>{p.sku}</Text>
                  <MarketplaceBadge marketplace={p.channel.channelType} />
                  <Text>{p.channel.name}</Text>
                </HStack>
              </Stack>
            </Flex>
          ))}
        </Stack>
      );
    }

    return (
      <Table.Root size="sm" data-testid="products-table">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("supplierChannel.products.product")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("supplierChannel.products.sku")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("supplierChannel.products.channel")}</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>

        <Table.Body>
          {products.map((p) => (
            <Table.Row key={p.key} data-testid={`product-row-${p.key}`}>
              <Table.Cell>{p.name}</Table.Cell>
              <Table.Cell>{p.sku}</Table.Cell>
              <Table.Cell>
                <HStack gap="2">
                  <MarketplaceBadge marketplace={p.channel.channelType} />
                  <Text>{p.channel.name}</Text>
                </HStack>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    );
  }

  return (
    <Stack gap="card" data-testid="products-section">
      <FilterBar
        testId="products-filter"
        active={term !== ""}
        onClear={() => {
          setQ("");
          setPage(1);
        }}
      >
        <FilterSearch
          value={q}
          onChange={(value) => {
            setQ(value);
            setPage(1);
          }}
          placeholder={t("supplierChannel.products.search")}
          testId="products-search"
        />
      </FilterBar>

      {list()}

      <Pagination
        count={matching.length}
        pageSize={pageSize}
        page={page}
        onPageChange={setPage}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
      />
    </Stack>
  );
}
