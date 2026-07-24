import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Flex,
  HStack,
  Heading,
  Icon,
  IconButton,
  Input,
  Menu,
  Portal,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { ArrowRightLeft, MoreHorizontal, Pencil, Plus } from "lucide-react";
import { rpcError } from "../../api/clients";
import type { Product } from "../../gen/warehouse/product/v1/product_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useWarehouseStock } from "../../features/inventory/queries";
import { TeamSelect } from "../../components/TeamSelect";
import { Pagination } from "../../components/Pagination";
import { ReceiveStockDialog } from "../../features/inventory/ReceiveStockDialog";
import { AdjustStockDialog } from "../../features/inventory/AdjustStockDialog";
import { MoveStockDialog } from "../../features/inventory/MoveStockDialog";

const PAGE_SIZE_OPTIONS = [10, 20, 50];
// StockList is not filterable by product, so we pull a generous page of levels and join client-side.
// A warehouse with more than this many stocked lines would need paging here too (noted for later).
const LEVEL_LIMIT = 200;

// InventoryPage is the warehouse stock screen (#55): pick a warehouse, see its products with on-hand,
// and receive or adjust stock. It assumes a warehouse stocks its OWN team's catalogue (product
// team_id = warehouse_id) — the cross-team-storage question is still open (see the brainstorming doc).
// `title` lets it serve both the root/admin "Inventory" route and the "Stock" sub-menu entry (#95).
//
// It used to take a `restock` flag that hid the adjust action, because this screen doubled as
// "Restock" under the superseded "pick a warehouse and receive there" design. Restock is now the
// request flow on its own screen (#105/#122), so this is simply the full stock view again.
export function InventoryPage({ title }: { title?: string } = {}) {
  const { current } = useTeam();
  const { t } = useTranslation();

  // Default to the current team when it IS a warehouse; otherwise the user picks one.
  const [warehouseId, setWarehouseId] = useState<bigint | undefined>(
    current?.teamType === TeamType.WAREHOUSE ? current.teamId : undefined,
  );

  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [dialog, setDialog] = useState<{
    kind: "receive" | "adjust" | "move";
    product: Product;
  } | null>(null);

  const query = useWarehouseStock({ warehouseId, q, page, pageSize, levelLimit: LEVEL_LIMIT });

  const products = query.data?.products ?? [];
  const onHand = query.data?.onHand ?? new Map<string, bigint>();
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending && warehouseId !== undefined;
  const error = query.isError ? rpcError(query.error) : "";

  return (
    <Stack gap="section">
      <Flex align="center" gap="card" wrap="wrap">
        <Heading size="md">{title ?? t("inventory.title")}</Heading>
        <Spacer />
        <TeamSelect
          value={warehouseId}
          onChange={(id) => {
            setWarehouseId(id);
            setPage(1);
          }}
          placeholder={t("inventory.pickWarehousePlaceholder")}
        />
      </Flex>

      {warehouseId === undefined ? (
        <Text color="fg.muted" data-testid="inventory-pick-warehouse">
          {t("inventory.pickWarehousePrompt")}
        </Text>
      ) : (
        <>
          <HStack>
            <Input
              maxW="sm"
              placeholder={t("inventory.searchPlaceholder")}
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
              {t("inventory.empty")}
            </Text>
          ) : (
            <Table.Root size="sm" data-testid="inventory-table">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("inventory.table.sku")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("inventory.table.product")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("inventory.table.onHand")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("inventory.table.actions")}</Table.ColumnHeader>
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
                      {/* Receive stays inline — it is the one action someone comes to this row to do,
                          and burying the common case behind a kebab costs a click every time. Adjust
                          and Move collapse into the overflow: three actions is where the house rule
                          says a row stops being a row and starts being a toolbar, and #136's Move is
                          what pushed this one over. */}
                      <Table.Cell textAlign="end">
                        <HStack justify="end" gap="1">
                          <Button
                            size="xs"
                            variant="outline"
                            data-testid={`receive-${product.sku}`}
                            onClick={() => setDialog({ kind: "receive", product })}
                          >
                            <Icon as={Plus} boxSize="4" />
                            {t("inventory.receive")}
                          </Button>

                          <Menu.Root>
                            <Menu.Trigger asChild>
                              <IconButton
                                size="xs"
                                variant="ghost"
                                aria-label={t("inventory.rowActions")}
                                data-testid={`row-actions-${product.sku}`}
                              >
                                <Icon as={MoreHorizontal} boxSize="4" />
                              </IconButton>
                            </Menu.Trigger>

                            <Portal>
                              <Menu.Positioner>
                                <Menu.Content>
                                  <Menu.Item
                                    value="adjust"
                                    data-testid={`adjust-${product.sku}`}
                                    onClick={() => setDialog({ kind: "adjust", product })}
                                  >
                                    <Icon as={Pencil} boxSize="4" />
                                    {t("inventory.adjust")}
                                  </Menu.Item>

                                  <Menu.Item
                                    value="move"
                                    data-testid={`move-${product.sku}`}
                                    onClick={() => setDialog({ kind: "move", product })}
                                  >
                                    <Icon as={ArrowRightLeft} boxSize="4" />
                                    {t("inventory.move")}
                                  </Menu.Item>
                                </Menu.Content>
                              </Menu.Positioner>
                            </Portal>
                          </Menu.Root>
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
        />
      )}

      {dialog?.kind === "move" && warehouseId !== undefined && (
        <MoveStockDialog
          key={dialog.product.id.toString()}
          warehouseId={warehouseId}
          product={dialog.product}
          currentOnHand={onHand.get(dialog.product.id.toString()) ?? 0n}
          open
          onOpenChange={(o) => {
            if (!o) setDialog(null);
          }}
        />
      )}
    </Stack>
  );
}
