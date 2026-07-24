import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { IconButton } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Spinner } from "../../components/ui/Spinner";
import { Table } from "../../components/ui/Table";
import { rpcError } from "../../api/clients";
import type { Shop } from "../../gen/warehouse/selling/v1/selling_pb";
import { useTeam } from "../../features/team/TeamContext";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { MarketplaceBadge } from "../../components/MarketplaceBadge";
import { Pagination } from "../../components/Pagination";
import { toaster } from "../../components/Toaster";
import { useShops, useDeleteShop } from "../../features/shops/queries";
import { ShopFormDialog } from "../../features/shops/ShopFormDialog";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// ShopsPage lists the CURRENT selling TEAM's marketplace shops (#66). Every RPC carries
// `current.teamId` in its body — the team is the scope, and a team only ever sees its own shops.
export function ShopsPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [editing, setEditing] = useState<Shop | null>(null);

  const teamId = current?.teamId;

  const query = useShops({ teamId, q, page, pageSize });
  const deleteShop = useDeleteShop();

  const shops = query.data?.shops ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  // `mutateAsync`, not `mutate`, because ConfirmDialog AWAITS its onConfirm to hold the button in its
  // loading state — a fire-and-forget `mutate` resolves instantly, so the dialog would close while the
  // delete was still in flight. mutateAsync REJECTS on failure, which is why the catch is not optional
  // here the way it would be with mutate's onError.
  async function remove(shop: Shop) {
    if (teamId === undefined) {
      return;
    }

    try {
      await deleteShop.mutateAsync({ teamId, shopId: shop.id });
      toaster.create({ type: "success", title: t("shops.deleted", { name: shop.name }) });
    } catch (err) {
      toaster.create({ type: "error", title: t("shops.deleteFailed"), description: rpcError(err) });
    }
  }

  if (!current) {
    return (
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("shops.title")}</h1>
        <p className="text-fg-muted" data-testid="shops-no-team">
          {t("shops.selectTeam")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-section">
      <div className="flex items-center gap-card">
        <h1 className="text-[22px] font-bold">{t("shops.title")}</h1>
        <Badge colorPalette="brand">{current.teamName || `Team #${current.teamId}`}</Badge>
        <div className="flex-1" />
        <ShopFormDialog />
      </div>

      <div className="max-w-sm">
        <Input
          placeholder={t("shops.searchPlaceholder")}
          value={q}
          data-testid="shop-search"
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
        />
      </div>

      {error && (
        <p className="text-red-600 dark:text-red-400" data-testid="shops-error">
          {error}
        </p>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <Table.Root data-testid="shops-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("shops.table.name")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("shops.table.code")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("shops.table.marketplace")}</Table.ColumnHeader>
              <Table.ColumnHeader className="text-right">{t("shops.table.actions")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {shops.map((shop) => (
              <Table.Row key={shop.id.toString()} data-testid={`shop-row-${shop.shopCode}`}>
                <Table.Cell>
                  <div
                    className="cursor-pointer"
                    data-testid={`open-shop-${shop.shopCode}`}
                    onClick={() => navigate(`/shops/${shop.id}`)}
                  >
                    {shop.name}
                  </div>
                </Table.Cell>
                <Table.Cell>{shop.shopCode}</Table.Cell>
                <Table.Cell>
                  <MarketplaceBadge marketplace={shop.marketplace} />
                </Table.Cell>

                <Table.Cell className="text-right">
                  <div className="flex justify-end gap-1">
                    <IconButton
                      size="xs"
                      variant="ghost"
                      aria-label="Edit"
                      data-testid={`edit-${shop.shopCode}`}
                      onClick={() => setEditing(shop)}
                    >
                      <Pencil className="size-4" />
                    </IconButton>

                    <ConfirmDialog
                      title={t("shops.deleteShop")}
                      message={t("shops.deleteConfirm", { name: shop.name })}
                      confirmLabel={t("shops.delete")}
                      onConfirm={() => remove(shop)}
                      trigger={
                        <IconButton
                          size="xs"
                          variant="ghost"
                          colorPalette="red"
                          aria-label="Delete"
                          data-testid={`delete-${shop.shopCode}`}
                        >
                          <Trash2 className="size-4" />
                        </IconButton>
                      }
                    />
                  </div>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {!loading && shops.length === 0 && !error && (
        <p className="text-fg-muted" data-testid="shops-empty">
          {t("shops.empty")}
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

      {/* One edit dialog, driven by the row's Edit action. Keyed so it re-initialises per shop. */}
      {editing && (
        <ShopFormDialog
          key={editing.id.toString()}
          shop={editing}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      )}
    </div>
  );
}
