import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Badge, Box, HStack, Icon, IconButton, Spinner, Stack, Switch, Table, Text } from "@chakra-ui/react";
import { Archive, Pencil, RotateCcw } from "lucide-react";
import { Code, ConnectError } from "@connectrpc/connect";
import { rpcError } from "../../../api/clients";
import type { Product } from "../../../gen/warehouse/product/v1/product_pb";
import { ProductStatus } from "../../../gen/warehouse/product/v1/product_pb";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { Pagination } from "../../../components/Pagination";
import { ProductListItem } from "../../../components/ProductListItem";
import { toaster } from "../../../components/Toaster";
import {
  useArchiveProduct,
  useProducts,
  useRestoreProduct,
  useSetProductLocked,
} from "../../../features/products/queries";
import { formatUnixDate } from "../../../lib/datetime";
import { formatMarkup } from "../../../lib/markup";
import { formatRupiah } from "../../../lib/money";
import { RestoreProductDialog } from "../../../features/products/RestoreProductDialog";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// Which list this table is: the two tabs of a selling team's own catalogue, or the warehouse's
// "what am I holding" list, which is a different RPC entirely (see useProducts).
export type ProductsMode = "active" | "archived" | "warehouse";

interface ProductsTableProps {
  mode: ProductsMode;
  teamId: bigint | undefined;
  /** The search box lives on the page, above the tabs, so both lists answer the same question. */
  q: string;
  /**
   * The warehouse LENS — 0n means all of them. It narrows what the stock columns MEAN, not which
   * products are listed: your catalogue is yours wherever the goods happen to sit.
   */
  warehouseId: bigint;
  /** Its name, for the column headers — a figure that silently became one warehouse's is a trap. */
  warehouseName?: string;
}

// ── The stock cells ──────────────────────────────────────────────────────────────────────────────
//
// Every figure comes from another service — stock, costs, batches and restocks from inventory_service
// (OwnerStockByIds), sales from selling_service (OrderProductActivityByIds) — batched once per PAGE
// and looked up here by product id.
//
// A product those reads say nothing about renders an em dash, NOT a zero. Absent means the ownership
// join found no stock and no order behind it, and "you have none on a shelf" is a claim neither read
// actually made. The distinction matters most on exactly the row you would act on.

// A quantity over what it is worth AT COST. Used for READY (sellable now) and ONGOING (ordered, not
// yet accepted onto a rack — an estimate until it lands, #74, which is why it is never summed into
// ready).
function StockCell({ qty, value }: { qty?: bigint; value?: bigint }) {
  const { t } = useTranslation();

  if (qty === undefined) {
    return <Unknown />;
  }

  return (
    <Stack gap="0" align="end">
      <Text fontWeight="medium">{t("products.stat.pcs", { n: qty.toString() })}</Text>
      {value !== undefined && (
        <Text fontSize="xs" color="fg.muted">
          {formatRupiah(value)}
        </Text>
      )}
    </Stack>
  );
}

// RESERVED is a COUNT and nothing else. It is the product's HOLD-BACK BUFFER — the units never
// offered for sale, so that `available = on hand − reserved` — and not a quantity of goods, so there
// is no money to put under it. It also belongs to the PRODUCT rather than to a warehouse, which is
// why the warehouse lens does not touch its header the way it touches the stock columns'.
function CountCell({ qty }: { qty?: bigint }) {
  const { t } = useTranslation();

  if (qty === undefined) {
    return <Unknown />;
  }

  return <Text fontWeight="medium">{t("products.stat.pcs", { n: qty.toString() })}</Text>;
}

// The HPP (cost) RANGE for one product — the cheapest and dearest units currently held, across every
// warehouse. A range rather than one number because it genuinely is one: the same product arrives at
// different prices, each delivery keeps its own cost, and averaging them would hide exactly the
// spread somebody opens this screen to see.
function PriceRangeCell({ min, max }: { min?: bigint; max?: bigint }) {
  if (min === undefined || max === undefined) {
    return <Unknown />;
  }

  // One price when every layer agrees — printing "Rp 5.000 – Rp 5.000" would be noise.
  if (min === max) {
    return <Text>{formatRupiah(min)}</Text>;
  }

  return (
    <Stack gap="0" align="end">
      <Text>{formatRupiah(min)}</Text>
      <Text fontSize="xs" color="fg.muted">
        {formatRupiah(max)}
      </Text>
    </Stack>
  );
}

function DateCell({ unix }: { unix?: bigint }) {
  if (unix === undefined) {
    return <Unknown />;
  }

  return <Text>{formatUnixDate(unix)}</Text>;
}

function Unknown() {
  return (
    <Text color="fg.subtle" data-testid="stock-unknown">
      —
    </Text>
  );
}

// One table, three lists. They share their whole body — a page of products, searched and paginated —
// and differ only in which rows they ask for and what may be done to a row, so splitting them into
// three components would be three copies of the same table drifting apart.
export function ProductsTable({ mode, teamId, q, warehouseId, warehouseName }: ProductsTableProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  // Every stock header carries the warehouse when one is chosen, so nobody reads a single
  // warehouse's number as the total. With none chosen the headers stay bare — "everywhere" is the
  // default reading of a stock figure and does not need saying.
  const scoped = (label: string) => (warehouseName ? `${label} · ${warehouseName}` : label);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  // The archived product whose restore was refused because its SKU is taken, plus what the server
  // said. Held here rather than inside the row so the dialog survives the list refetching under it.
  const [conflict, setConflict] = useState<{ product: Product; reason: string } | null>(null);

  const isWarehouse = mode === "warehouse";
  const isArchived = mode === "archived";

  const query = useProducts({
    teamId,
    isWarehouse,
    // WarehouseProductList takes no query (#142), so the shared search box simply does not reach it.
    q: isWarehouse ? "" : q,
    page,
    pageSize,
    status: isArchived ? ProductStatus.ARCHIVED : ProductStatus.ACTIVE,
    warehouseId,
  });
  const archiveProduct = useArchiveProduct();
  const restoreProduct = useRestoreProduct();
  const setLocked = useSetProductLocked();

  const products = query.data?.products ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const error = query.isError ? rpcError(query.error) : "";

  // Looked up by id rather than merged into the product: the two reads answer for the PAGE, and a
  // product they say nothing about has to stay undefined so its cells read "unknown", not "none".
  const stockOf = (product: Product) => query.data?.stock?.get(product.id.toString());
  const activityOf = (product: Product) => query.data?.activity?.get(product.id.toString());

  async function archive(product: Product) {
    if (teamId === undefined) {
      return;
    }

    try {
      await archiveProduct.mutateAsync({ teamId, productId: product.id });
      toaster.create({ type: "success", title: t("products.toast.archived", { sku: product.sku }) });
    } catch (err) {
      toaster.create({
        type: "error",
        title: t("products.toast.archiveFailed"),
        description: rpcError(err),
      });
    }
  }

  // `sku` empty = restore under the SKU it was archived with; that is the call that can come back
  // AlreadyExists, and the only sane answer to that is to let the user pick a free one.
  async function restore(product: Product, sku?: string) {
    if (teamId === undefined) {
      return;
    }

    try {
      await restoreProduct.mutateAsync({ teamId, productId: product.id, sku });
      setConflict(null);
      toaster.create({ type: "success", title: t("products.toast.restored", { sku: sku || product.sku }) });
    } catch (err) {
      if (ConnectError.from(err).code === Code.AlreadyExists) {
        setConflict({ product, reason: rpcError(err) });

        return;
      }

      toaster.create({
        type: "error",
        title: t("products.toast.restoreFailed"),
        description: rpcError(err),
      });
    }
  }

  // Locking is edited in place, so it has no dialog and no save button — which means the only way a
  // failure can be noticed is a toast. The row falls back to the server's answer on the refetch.
  async function toggleLocked(product: Product, locked: boolean) {
    if (teamId === undefined) {
      return;
    }

    try {
      await setLocked.mutateAsync({ teamId, productId: product.id, locked });
    } catch (err) {
      toaster.create({
        type: "error",
        title: t("products.toast.lockFailed"),
        description: rpcError(err),
      });
    }
  }

  function openRow(product: Product) {
    // A WAREHOUSE opens the stock view (#158), not the catalogue entry it does not own.
    if (isWarehouse) {
      navigate(`/inventories/products/${product.id}`);

      return;
    }

    // An archived product has no detail page to open: ProductDetail serves active rows only, so a
    // click would land on "Product not found". Restore it first — that is what the tab is for.
    if (!isArchived) {
      navigate(`/products/${product.id}`);
    }
  }

  return (
    <Stack gap="section">
      {error && (
        <Text color="red.fg" data-testid="products-error">
          {error}
        </Text>
      )}

      {query.isPending ? (
        <Spinner colorPalette="brand" />
      ) : (
        <Table.ScrollArea>
          <Table.Root size="sm" data-testid="products-table">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>{t("products.table.product")}</Table.ColumnHeader>
                {/* What the units on hand cost us — a low-to-high range across the warehouses. */}
                <Table.ColumnHeader textAlign="end">{scoped(t("products.table.priceRange"))}</Table.ColumnHeader>
                {/* The stock trio, in the order a seller asks them: what can I sell, what of it is
                    already spoken for, and what is coming. */}
                <Table.ColumnHeader textAlign="end">{scoped(t("products.table.ready"))}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t("products.table.reserved")}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{scoped(t("products.table.ongoing"))}</Table.ColumnHeader>
                {/* How long the oldest units have been sitting — the column that finds dead stock
                    before it is written off. */}
                <Table.ColumnHeader>{scoped(t("products.table.oldestBatch"))}</Table.ColumnHeader>
                <Table.ColumnHeader>{t("products.table.lastOrder")}</Table.ColumnHeader>
                <Table.ColumnHeader>{t("products.table.lastRestock")}</Table.ColumnHeader>
                {/* What another team pays over our cost to sell this one, and whether it may at all. */}
                <Table.ColumnHeader textAlign="end">{t("products.table.cross")}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="center">{t("products.table.locked")}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t("products.table.actions")}</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>

            <Table.Body>
              {products.map((product) => (
                <Table.Row
                  key={product.id.toString()}
                  data-testid={`product-row-${product.sku}`}
                  cursor={isArchived ? undefined : "pointer"}
                  onClick={() => openRow(product)}
                >
                  <Table.Cell>
                    {/* ONE cell, not image + SKU + name: a product is one thing, and this is the
                        app's one way of drawing it (#128). The team badge is passed ONLY on the
                        warehouse list, where the rows genuinely belong to other teams — on your own
                        catalogue it would be your own name on every row. */}
                    <Box data-testid={`open-product-${product.sku}`} minW="15rem">
                      <ProductListItem
                        product={
                          isWarehouse
                            ? product
                            : {
                                id: product.id,
                                sku: product.sku,
                                name: product.name,
                                defaultImageUrl: product.defaultImageUrl,
                                defaultImageThumbnailUrl: product.defaultImageThumbnailUrl,
                              }
                        }
                      />
                    </Box>
                  </Table.Cell>

                  <Table.Cell textAlign="end">
                    {/* Only pass the spread when a cost is actually known — costMin/costMax are 0
                        when no ready unit was ever costed, and 0..0 would read as "it was free". */}
                    <PriceRangeCell
                      min={stockOf(product)?.costKnown ? stockOf(product)?.costMin : undefined}
                      max={stockOf(product)?.costKnown ? stockOf(product)?.costMax : undefined}
                    />
                  </Table.Cell>
                  <Table.Cell textAlign="end">
                    <StockCell qty={stockOf(product)?.readyQty} value={stockOf(product)?.readyValue} />
                  </Table.Cell>
                  <Table.Cell textAlign="end">
                    <CountCell qty={BigInt(product.reservedStock)} />
                  </Table.Cell>
                  <Table.Cell textAlign="end">
                    <StockCell
                      qty={stockOf(product)?.ongoingQty}
                      value={stockOf(product)?.ongoingValueEst}
                    />
                  </Table.Cell>
                  <Table.Cell>
                    <DateCell unix={stockOf(product)?.oldestBatchUnix} />
                  </Table.Cell>
                  <Table.Cell>
                    <DateCell unix={activityOf(product)?.lastOrderUnix} />
                  </Table.Cell>
                  <Table.Cell>
                    <DateCell unix={stockOf(product)?.lastRestockUnix} />
                  </Table.Cell>

                  <Table.Cell textAlign="end">
                    {/* 0 is not "unset" — it is a decision to charge another team nothing, so it
                        reads as a plain 0%, not a dash. */}
                    <Badge colorPalette={product.crossMarkupBps > 0 ? "brand" : "gray"}>
                      {formatMarkup(product.crossMarkupBps)}
                    </Badge>
                  </Table.Cell>

                  {/* LOCKED is edited HERE, in the row — deciding who may sell what is a pass down
                      the whole catalogue, and making it a trip into each product's edit page would
                      turn a two-minute review into forty. The click must not also open the row. */}
                  <Table.Cell textAlign="center" onClick={(e) => e.stopPropagation()}>
                    <Switch.Root
                      size="sm"
                      checked={product.crossLocked}
                      // Only the owner may set this, and only on a live product: a warehouse does not
                      // own these rows, and an archived one is already out of everybody's reach.
                      disabled={mode !== "active"}
                      data-testid={`locked-${product.sku}`}
                      onCheckedChange={(e) => toggleLocked(product, e.checked)}
                    >
                      <Switch.HiddenInput aria-label={t("products.table.locked")} />
                      <Switch.Control />
                    </Switch.Root>
                  </Table.Cell>

                  {/* Row-action clicks must not bubble to the row's navigate. */}
                  <Table.Cell textAlign="end" onClick={(e) => e.stopPropagation()}>
                    <HStack justify="end" gap="1">
                      {/* A warehouse HANDLES these products; it does not own them (#142). Editing or
                          archiving somebody else's catalogue entry is not its call — and the writes
                          are scoped to the OWNING team, so these would only ever be refused. */}
                      {mode === "active" && (
                        <>
                          <IconButton
                            size="xs"
                            variant="ghost"
                            aria-label={t("products.edit")}
                            data-testid={`edit-${product.sku}`}
                            onClick={() => navigate(`/products/${product.id}/edit`)}
                          >
                            <Icon as={Pencil} boxSize="4" />
                          </IconButton>

                          <ConfirmDialog
                            title={t("products.archiveDialog.title")}
                            message={t("products.archiveDialog.message", { sku: product.sku })}
                            confirmLabel={t("products.archiveDialog.confirmLabel")}
                            onConfirm={() => archive(product)}
                            trigger={
                              <IconButton
                                size="xs"
                                variant="ghost"
                                colorPalette="red"
                                aria-label={t("products.archiveDialog.confirmLabel")}
                                data-testid={`delete-${product.sku}`}
                              >
                                <Icon as={Archive} boxSize="4" />
                              </IconButton>
                            }
                          />
                        </>
                      )}

                      {isArchived && (
                        <IconButton
                          size="xs"
                          variant="ghost"
                          aria-label={t("products.restore")}
                          data-testid={`restore-${product.sku}`}
                          onClick={() => restore(product)}
                        >
                          <Icon as={RotateCcw} boxSize="4" />
                        </IconButton>
                      )}
                    </HStack>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Table.ScrollArea>
      )}

      {!query.isPending && products.length === 0 && !error && (
        <Text color="fg.muted" data-testid="products-empty">
          {isArchived ? t("products.emptyArchived") : t("products.empty")}
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

      <RestoreProductDialog
        product={conflict?.product ?? null}
        reason={conflict?.reason ?? ""}
        onClose={() => setConflict(null)}
        onRestore={(sku) => restore(conflict!.product, sku)}
      />
    </Stack>
  );
}
