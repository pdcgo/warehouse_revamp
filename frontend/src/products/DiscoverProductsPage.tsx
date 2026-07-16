import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Flex, HStack, Heading, Image, Input, Spinner, Stack, Table, Text } from "@chakra-ui/react";
import { productClient, rpcError } from "../api/clients";
import type { Product } from "../gen/warehouse/product/v1/product_pb";
import { useTeam } from "../team/TeamContext";
import { Pagination } from "../components/Pagination";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// DiscoverProductsPage lists products across ALL teams (#106) so a selling team can browse other
// teams' catalogues (to order from, in future). Read-only; the current team is only the authorizing
// scope, not a filter — cross-team discovery is open (owner-confirmed). Each row shows which team
// owns the product.
export function DiscoverProductsPage() {
  const { current } = useTeam();
  const { t } = useTranslation();

  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const teamId = current?.teamId;

  const load = useCallback(async () => {
    if (teamId === undefined) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await productClient.productDiscover({ teamId, q, page: { page, limit: pageSize } });
      setProducts(res.products);
      setTotalItems(Number(res.pageInfo?.totalItems ?? 0n));
    } catch (err) {
      setError(rpcError(err));
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [teamId, q, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("discover.title")}</Heading>
        <Text color="fg.muted" data-testid="discover-no-team">
          {t("discover.selectTeam")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Heading size="md">{t("discover.title")}</Heading>
      </Flex>
      <Text fontSize="sm" color="fg.muted">
        {t("discover.subtitle")}
      </Text>

      <HStack>
        <Input
          maxW="sm"
          placeholder={t("discover.searchPlaceholder")}
          value={q}
          data-testid="discover-search"
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
        />
      </HStack>

      {error && (
        <Text color="red.fg" data-testid="discover-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <Table.Root size="sm" data-testid="discover-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader w="12">{t("discover.table.image")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("discover.table.sku")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("discover.table.name")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("discover.table.team")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {products.map((product) => {
              const cover = product.defaultImageThumbnailUrl || product.defaultImageUrl;

              return (
                <Table.Row key={product.id.toString()} data-testid={`discover-row-${product.sku}`}>
                  <Table.Cell>
                    {cover ? (
                      <Image src={cover} alt={product.name} boxSize="8" borderRadius="sm" objectFit="cover" />
                    ) : (
                      <Text color="fg.muted" fontSize="xs">
                        —
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell>{product.sku}</Table.Cell>
                  <Table.Cell>{product.name}</Table.Cell>
                  <Table.Cell>
                    <Badge colorPalette="gray">{t("discover.teamBadge", { id: product.teamId.toString() })}</Badge>
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
      )}

      {!loading && products.length === 0 && !error && (
        <Text color="fg.muted" data-testid="discover-empty">
          {t("discover.empty")}
        </Text>
      )}

      <Pagination
        count={totalItems}
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
