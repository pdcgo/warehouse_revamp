import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Pencil, Trash2 } from "lucide-react";
import { rpcError } from "../../api/clients";
import type { Product } from "../../gen/warehouse/product/v1/product_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Pagination } from "../../components/Pagination";
import { toaster } from "../../components/Toaster";
import { Badge } from "../../components/ui/Badge";
import { Button, IconButton } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Spinner } from "../../components/ui/Spinner";
import { Table } from "../../components/ui/Table";
import { useProducts, useDeleteProduct } from "../../features/products/queries";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// ProductsPage lists the CURRENT TEAM's catalogue. Every RPC carries `current.teamId` in its
// body — the team is the scope, and a selling/warehouse team only ever sees its own products.
// Create and edit are a dedicated PAGE (issue #60), reached from here.
export function ProductsPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();

  // Only the filters are state (#176) — the rows, the count, the spinner and the error come off the
  // query. The warehouse/selling branch moved into the query function with them.
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const teamId = current?.teamId;
  // A warehouse reads a different list entirely — see useProducts.
  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;

  const query = useProducts({ teamId, isWarehouse, q, page, pageSize });
  const deleteProduct = useDeleteProduct();

  const products = query.data?.products ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  async function remove(product: Product) {
    if (teamId === undefined) {
      return;
    }

    try {
      await deleteProduct.mutateAsync({ teamId, productId: product.id });
      toaster.create({ type: "success", title: t("products.toast.deleted", { sku: product.sku }) });
    } catch (err) {
      toaster.create({ type: "error", title: t("products.toast.deleteFailed"), description: rpcError(err) });
    }
  }

  // No current team means there is no scope to list against — the whole page is meaningless.
  if (!current) {
    return (
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("products.heading")}</h1>
        <p className="text-fg-muted" data-testid="products-no-team">
          {t("products.noTeam")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-section">
      <div className="flex flex-wrap items-center gap-card">
        <h1 className="text-[22px] font-bold">{t("products.heading")}</h1>
        <Badge colorPalette="brand">{current.teamName || `Team #${current.teamId}`}</Badge>
        <div className="flex-1" />
        {/* A warehouse team stocks products but does not create them (#101) — no create action. */}
        {current.teamType !== TeamType.WAREHOUSE && (
          <Button
            size="xs"
            colorPalette="brand"
            data-testid="open-create-product"
            onClick={() => navigate("/products/new")}
          >
            {t("products.newProduct")}
          </Button>
        )}
      </div>

      {/* No search for a warehouse (#142): WarehouseProductList takes no query, so the box would look
          like a working control and do nothing. A dead input is worse than an absent one. */}
      {!isWarehouse && (
        <div className="flex">
          <Input
            className="max-w-sm"
            placeholder={t("products.searchPlaceholder")}
            value={q}
            data-testid="product-search"
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
          />
        </div>
      )}

      {error && (
        <p className="text-red-600 dark:text-red-400" data-testid="products-error">
          {error}
        </p>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <Table.Root data-testid="products-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader className="w-12">{t("products.table.image")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("products.table.sku")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("products.table.name")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("products.table.description")}</Table.ColumnHeader>
              <Table.ColumnHeader className="text-right">{t("products.table.actions")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {products.map((product) => {
              const cover = product.defaultImageThumbnailUrl || product.defaultImageUrl;

              return (
                <Table.Row
                  key={product.id.toString()}
                  data-testid={`product-row-${product.sku}`}
                  className="cursor-pointer hover:bg-surface-2"
                  // A WAREHOUSE opens the stock view (#158), not the catalogue entry it does not own.
                  onClick={() =>
                    navigate(isWarehouse ? `/inventories/products/${product.id}` : `/products/${product.id}`)
                  }
                >
                  <Table.Cell>
                    {cover ? (
                      <img
                        src={cover}
                        alt={product.name}
                        className="size-8 rounded-control object-cover"
                        data-testid={`product-cover-${product.sku}`}
                      />
                    ) : (
                      <span className="text-xs text-fg-muted">—</span>
                    )}
                  </Table.Cell>
                  <Table.Cell>{product.sku}</Table.Cell>
                  <Table.Cell>
                    {/* The whole row navigates to the detail page (#92); this keeps the stable
                        testid the e2e clicks. */}
                    <span data-testid={`open-product-${product.sku}`}>{product.name}</span>
                  </Table.Cell>
                  <Table.Cell>{product.description}</Table.Cell>

                  {/* Row-action clicks must not bubble to the row's navigate. */}
                  <Table.Cell className="text-right" onClick={(e) => e.stopPropagation()}>
                    {/* A warehouse HANDLES these products; it does not own them (#142). Editing or
                        deleting somebody else's catalogue entry is not its call — and ProductUpdate /
                        ProductDelete are scoped to the OWNING team, so these would only ever produce a
                        refusal. Offering an action that cannot work is worse than omitting it. */}
                    <div className="flex justify-end gap-1">
                      {!isWarehouse && (
                        <IconButton
                          size="xs"
                          variant="ghost"
                          aria-label="Edit"
                          data-testid={`edit-${product.sku}`}
                          onClick={() => navigate(`/products/${product.id}/edit`)}
                        >
                          <Pencil className="size-4" />
                        </IconButton>
                      )}

                      {!isWarehouse && (
                        <ConfirmDialog
                          title={t("products.deleteDialog.title")}
                          message={t("products.deleteDialog.message", { sku: product.sku })}
                          confirmLabel={t("products.deleteDialog.confirmLabel")}
                          onConfirm={() => remove(product)}
                          trigger={
                            <IconButton
                              size="xs"
                              variant="ghost"
                              colorPalette="red"
                              aria-label="Delete"
                              data-testid={`delete-${product.sku}`}
                            >
                              <Trash2 className="size-4" />
                            </IconButton>
                          }
                        />
                      )}
                    </div>
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
      )}

      {!loading && products.length === 0 && !error && (
        <p className="text-fg-muted" data-testid="products-empty">
          {t("products.empty")}
        </p>
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
    </div>
  );
}
