import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import { Button, IconButton } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Menu, Portal } from "../../components/ui/Menu";
import { Spinner } from "../../components/ui/Spinner";
import { Table } from "../../components/ui/Table";

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
    <div className="flex flex-col gap-section">
      <div className="flex flex-wrap items-center gap-card">
        <h1 className="text-[22px] font-bold">{title ?? t("inventory.title")}</h1>
        <div className="flex-1" />
        <TeamSelect
          value={warehouseId}
          onChange={(id) => {
            setWarehouseId(id);
            setPage(1);
          }}
          placeholder={t("inventory.pickWarehousePlaceholder")}
        />
      </div>

      {warehouseId === undefined ? (
        <p className="text-fg-muted" data-testid="inventory-pick-warehouse">
          {t("inventory.pickWarehousePrompt")}
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <div className="w-full max-w-sm">
              <Input
                placeholder={t("inventory.searchPlaceholder")}
                value={q}
                data-testid="inventory-search"
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>

          {error && (
            <p className="text-neg" data-testid="inventory-error">
              {error}
            </p>
          )}

          {loading ? (
            <Spinner />
          ) : products.length === 0 ? (
            <p className="text-fg-muted" data-testid="inventory-empty">
              {t("inventory.empty")}
            </p>
          ) : (
            <Table.Root data-testid="inventory-table">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("inventory.table.sku")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("inventory.table.product")}</Table.ColumnHeader>
                  <Table.ColumnHeader className="text-right">{t("inventory.table.onHand")}</Table.ColumnHeader>
                  <Table.ColumnHeader className="text-right">{t("inventory.table.actions")}</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>

              <Table.Body>
                {products.map((product) => {
                  const stock = onHand.get(product.id.toString()) ?? 0n;

                  return (
                    <Table.Row key={product.id.toString()} data-testid={`stock-row-${product.sku}`}>
                      <Table.Cell>{product.sku}</Table.Cell>
                      <Table.Cell>{product.name}</Table.Cell>
                      <Table.Cell className="text-right" data-testid={`stock-onhand-${product.sku}`}>
                        {stock.toString()}
                      </Table.Cell>
                      {/* Receive stays inline — it is the one action someone comes to this row to do,
                          and burying the common case behind a kebab costs a click every time. Adjust
                          and Move collapse into the overflow: three actions is where the house rule
                          says a row stops being a row and starts being a toolbar, and #136's Move is
                          what pushed this one over. */}
                      <Table.Cell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="xs"
                            variant="outline"
                            data-testid={`receive-${product.sku}`}
                            onClick={() => setDialog({ kind: "receive", product })}
                          >
                            <Plus className="size-4" />
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
                                <MoreHorizontal className="size-4" />
                              </IconButton>
                            </Menu.Trigger>

                            <Portal>
                              <Menu.Positioner>
                                <Menu.Content>
                                  <Menu.Item
                                    value="adjust"
                                    data-testid={`adjust-${product.sku}`}
                                    onSelect={() => setDialog({ kind: "adjust", product })}
                                  >
                                    <Pencil className="size-4" />
                                    {t("inventory.adjust")}
                                  </Menu.Item>

                                  <Menu.Item
                                    value="move"
                                    data-testid={`move-${product.sku}`}
                                    onSelect={() => setDialog({ kind: "move", product })}
                                  >
                                    <ArrowRightLeft className="size-4" />
                                    {t("inventory.move")}
                                  </Menu.Item>
                                </Menu.Content>
                              </Menu.Positioner>
                            </Portal>
                          </Menu.Root>
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>
          )}

          {!loading && (
            <div className="flex items-center justify-end">
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
            </div>
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
    </div>
  );
}
