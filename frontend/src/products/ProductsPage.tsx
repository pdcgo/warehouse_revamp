import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  Flex,
  HStack,
  Heading,
  Icon,
  IconButton,
  Image,
  Input,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { Pencil, Trash2 } from "lucide-react";
import { productClient, rpcError } from "../api/clients";
import type { Product } from "../gen/warehouse/product/v1/product_pb";
import { useTeam } from "../team/TeamContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { toaster } from "../components/Toaster";

const PAGE_SIZE = 20;

// ProductsPage lists the CURRENT TEAM's catalogue. Every RPC carries `current.teamId` in its
// body — the team is the scope, and a selling/warehouse team only ever sees its own products.
// Create and edit are a dedicated PAGE (issue #60), reached from here.
export function ProductsPage() {
  const { current } = useTeam();
  const navigate = useNavigate();

  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [totalPage, setTotalPage] = useState(1);
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
      const res = await productClient.productList({
        teamId,
        q,
        page: { page, limit: PAGE_SIZE },
      });

      setProducts(res.products);
      setTotalPage(res.pageInfo?.totalPage ?? 1);
    } catch (err) {
      setError(rpcError(err));
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [teamId, q, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(product: Product) {
    if (teamId === undefined) {
      return;
    }

    try {
      await productClient.productDelete({ teamId, productId: product.id });
      toaster.create({ type: "success", title: `Product "${product.sku}" deleted` });
      await load();
    } catch (err) {
      toaster.create({ type: "error", title: "Delete failed", description: rpcError(err) });
    }
  }

  // No current team means there is no scope to list against — the whole page is meaningless.
  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">Products</Heading>
        <Text color="fg.muted" data-testid="products-no-team">
          Select a team to manage its products.
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      <Flex align="center" gap="card">
        <Heading size="md">Products</Heading>
        <Badge colorPalette="brand">{current.teamName || `Team #${current.teamId}`}</Badge>
        <Spacer />
        <Button
          size="xs"
          colorPalette="brand"
          data-testid="open-create-product"
          onClick={() => navigate("/products/new")}
        >
          New product
        </Button>
      </Flex>

      <HStack>
        <Input
          maxW="sm"
          placeholder="Search SKU or name"
          value={q}
          data-testid="product-search"
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
        />
      </HStack>

      {error && (
        <Text color="red.fg" data-testid="products-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <Table.Root size="sm" data-testid="products-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader w="12">Image</Table.ColumnHeader>
              <Table.ColumnHeader>SKU</Table.ColumnHeader>
              <Table.ColumnHeader>Name</Table.ColumnHeader>
              <Table.ColumnHeader>Description</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">Actions</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {products.map((product) => {
              const cover = product.defaultImageThumbnailUrl || product.defaultImageUrl;

              return (
                <Table.Row key={product.id.toString()} data-testid={`product-row-${product.sku}`}>
                  <Table.Cell>
                    {cover ? (
                      <Image
                        src={cover}
                        alt={product.name}
                        boxSize="8"
                        borderRadius="sm"
                        objectFit="cover"
                        data-testid={`product-cover-${product.sku}`}
                      />
                    ) : (
                      <Text color="fg.muted" fontSize="xs">
                        —
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell>{product.sku}</Table.Cell>
                  <Table.Cell>{product.name}</Table.Cell>
                  <Table.Cell>{product.description}</Table.Cell>

                  <Table.Cell textAlign="end">
                    <HStack justify="end" gap="1">
                      <IconButton
                        size="xs"
                        variant="ghost"
                        aria-label="Edit"
                        data-testid={`edit-${product.sku}`}
                        onClick={() => navigate(`/products/${product.id}/edit`)}
                      >
                        <Icon as={Pencil} boxSize="4" />
                      </IconButton>

                      <ConfirmDialog
                        title="Delete Product"
                        message={`Delete "${product.sku}"? This cannot be undone.`}
                        confirmLabel="Delete"
                        onConfirm={() => remove(product)}
                        trigger={
                          <IconButton
                            size="xs"
                            variant="ghost"
                            colorPalette="red"
                            aria-label="Delete"
                            data-testid={`delete-${product.sku}`}
                          >
                            <Icon as={Trash2} boxSize="4" />
                          </IconButton>
                        }
                      />
                    </HStack>
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
      )}

      {!loading && products.length === 0 && !error && (
        <Text color="fg.muted" data-testid="products-empty">
          No products found.
        </Text>
      )}

      <HStack>
        <Button
          size="xs"
          variant="outline"
          disabled={page <= 1}
          data-testid="products-prev"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Previous
        </Button>

        <Text fontSize="xs" color="fg.muted" data-testid="products-page">
          Page {page} of {totalPage}
        </Text>

        <Button
          size="xs"
          variant="outline"
          disabled={page >= totalPage}
          data-testid="products-next"
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </HStack>
    </Stack>
  );
}
