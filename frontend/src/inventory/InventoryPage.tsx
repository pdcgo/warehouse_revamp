import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Flex,
  HStack,
  Heading,
  Icon,
  IconButton,
  Input,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { Pencil, Plus } from "lucide-react";
import { inventoryClient, productClient, rpcError } from "../api/clients";
import type { Product } from "../gen/warehouse/product/v1/product_pb";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../team/TeamContext";
import { TeamSelect } from "../components/TeamSelect";
import { Pagination } from "../components/Pagination";
import { ReceiveStockDialog } from "./ReceiveStockDialog";
import { AdjustStockDialog } from "./AdjustStockDialog";

const PAGE_SIZE = 20;
// StockList is not filterable by product, so we pull a generous page of levels and join client-side.
// A warehouse with more than this many stocked lines would need paging here too (noted for later).
const LEVEL_LIMIT = 200;

// InventoryPage is the warehouse stock screen (#55): pick a warehouse, see its products with on-hand,
// and receive or adjust stock. It assumes a warehouse stocks its OWN team's catalogue (product
// team_id = warehouse_id) — the cross-team-storage question is still open (see the brainstorming doc).
// `title` lets it serve both the root/admin "Inventory" route and the "Restock" sub-menu (#95).
export function InventoryPage({ title = "Inventory" }: { title?: string } = {}) {
  const { current } = useTeam();

  // Default to the current team when it IS a warehouse; otherwise the user picks one.
  const [warehouseId, setWarehouseId] = useState<bigint | undefined>(
    current?.teamType === TeamType.WAREHOUSE ? current.teamId : undefined,
  );

  const [products, setProducts] = useState<Product[]>([]);
  const [onHand, setOnHand] = useState<Map<string, bigint>>(new Map());
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [dialog, setDialog] = useState<{ kind: "receive" | "adjust"; product: Product } | null>(
    null,
  );

  const load = useCallback(async () => {
    if (warehouseId === undefined) {
      setProducts([]);
      setOnHand(new Map());
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [productRes, stockRes] = await Promise.all([
        productClient.productList({ teamId: warehouseId, q, page: { page, limit: PAGE_SIZE } }),
        inventoryClient.stockList({ warehouseId, page: { page: 1, limit: LEVEL_LIMIT } }),
      ]);

      setProducts(productRes.products);
      setTotalItems(Number(productRes.pageInfo?.totalItems ?? 0n));

      const map = new Map<string, bigint>();
      for (const level of stockRes.levels) {
        map.set(level.productId.toString(), level.onHand);
      }
      setOnHand(map);
    } catch (err) {
      setError(rpcError(err));
      setProducts([]);
      setOnHand(new Map());
    } finally {
      setLoading(false);
    }
  }, [warehouseId, q, page]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Stack gap="section">
      <Flex align="center" gap="card" wrap="wrap">
        <Heading size="md">{title}</Heading>
        <Spacer />
        <TeamSelect
          value={warehouseId}
          onChange={(id) => {
            setWarehouseId(id);
            setPage(1);
          }}
          placeholder="Pick a warehouse"
        />
      </Flex>

      {warehouseId === undefined ? (
        <Text color="fg.muted" data-testid="inventory-pick-warehouse">
          Pick a warehouse to see its stock.
        </Text>
      ) : (
        <>
          <HStack>
            <Input
              maxW="sm"
              placeholder="Search products by SKU or name"
              value={q}
              data-testid="inventory-search"
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </HStack>

          {error && (
            <Text color="red.fg" data-testid="inventory-error">
              {error}
            </Text>
          )}

          {loading ? (
            <Spinner colorPalette="brand" />
          ) : products.length === 0 ? (
            <Text color="fg.muted" data-testid="inventory-empty">
              No products in this warehouse's catalogue.
            </Text>
          ) : (
            <Table.Root size="sm" data-testid="inventory-table">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>SKU</Table.ColumnHeader>
                  <Table.ColumnHeader>Product</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">On hand</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">Actions</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>

              <Table.Body>
                {products.map((product) => {
                  const stock = onHand.get(product.id.toString()) ?? 0n;

                  return (
                    <Table.Row key={product.id.toString()} data-testid={`stock-row-${product.sku}`}>
                      <Table.Cell>{product.sku}</Table.Cell>
                      <Table.Cell>{product.name}</Table.Cell>
                      <Table.Cell textAlign="end" data-testid={`stock-onhand-${product.sku}`}>
                        {stock.toString()}
                      </Table.Cell>
                      <Table.Cell textAlign="end">
                        <HStack justify="end" gap="1">
                          <Button
                            size="xs"
                            variant="outline"
                            data-testid={`receive-${product.sku}`}
                            onClick={() => setDialog({ kind: "receive", product })}
                          >
                            <Icon as={Plus} boxSize="4" />
                            Receive
                          </Button>
                          <IconButton
                            size="xs"
                            variant="ghost"
                            aria-label="Adjust"
                            data-testid={`adjust-${product.sku}`}
                            onClick={() => setDialog({ kind: "adjust", product })}
                          >
                            <Icon as={Pencil} boxSize="4" />
                          </IconButton>
                        </HStack>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>
          )}

          {!loading && (
            <HStack justify="end">
              <Pagination count={totalItems} pageSize={PAGE_SIZE} page={page} onPageChange={setPage} />
            </HStack>
          )}
        </>
      )}

      {dialog?.kind === "receive" && warehouseId !== undefined && (
        <ReceiveStockDialog
          key={dialog.product.id.toString()}
          warehouseId={warehouseId}
          product={dialog.product}
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          onDone={() => void load()}
        />
      )}

      {dialog?.kind === "adjust" && warehouseId !== undefined && (
        <AdjustStockDialog
          key={dialog.product.id.toString()}
          warehouseId={warehouseId}
          product={dialog.product}
          currentOnHand={onHand.get(dialog.product.id.toString()) ?? 0n}
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
          onDone={() => void load()}
        />
      )}
    </Stack>
  );
}
