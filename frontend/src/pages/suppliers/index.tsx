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
import type { Supplier } from "../../gen/warehouse/inventory/v1/supplier_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useDeleteSupplier, useSuppliers } from "../../features/suppliers/queries";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Pagination } from "../../components/Pagination";
import { toaster } from "../../components/Toaster";
import { SupplierFormDialog } from "./components/SupplierFormDialog";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// SuppliersPage lists the CURRENT team's suppliers (#103) — the vendors the team buys stock from,
// managed under the Inventory area. Every RPC carries `current.teamId` in its body — the team is the
// scope, and a team only ever sees its own suppliers.
export function SuppliersPage() {
  const { current } = useTeam();
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Only a selling team (and root/admin) manages suppliers; a warehouse team is read-only (#107).
  const canManage = current?.teamType !== TeamType.WAREHOUSE;

  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [editing, setEditing] = useState<Supplier | null>(null);

  const teamId = current?.teamId;

  const query = useSuppliers({ teamId, q, page, pageSize });
  const deleteSupplier = useDeleteSupplier();

  const suppliers = query.data?.suppliers ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  // `mutateAsync`, not `mutate`, because ConfirmDialog AWAITS its onConfirm to hold the button in its
  // loading state — a fire-and-forget `mutate` would resolve instantly and the dialog would close
  // while the delete was still in flight. mutateAsync REJECTS on failure, so the catch is not optional
  // here the way it would be with mutate's onError.
  async function remove(supplier: Supplier) {
    if (teamId === undefined) {
      return;
    }

    try {
      await deleteSupplier.mutateAsync({ teamId, supplierId: supplier.id });
      toaster.create({ type: "success", title: t("suppliers.deleted", { name: supplier.name }) });
    } catch (err) {
      toaster.create({ type: "error", title: t("suppliers.deleteFailed"), description: rpcError(err) });
    }
  }

  // No current team means there is no scope to list against — the whole page is meaningless.
  if (!current) {
    return (
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("suppliers.title")}</h1>
        <p className="text-fg-muted" data-testid="suppliers-no-team">
          {t("suppliers.selectTeam")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-section">
      <div className="flex items-center gap-card">
        <h1 className="text-[22px] font-bold">{t("suppliers.title")}</h1>
        <Badge colorPalette="brand">{current.teamName || `Team #${current.teamId}`}</Badge>
        <div className="flex-1" />
        {canManage && <SupplierFormDialog />}
      </div>

      <div className="max-w-sm">
        <Input
          placeholder={t("suppliers.searchPlaceholder")}
          value={q}
          data-testid="supplier-search"
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
        />
      </div>

      {error && (
        <p className="text-red-600 dark:text-red-400" data-testid="suppliers-error">
          {error}
        </p>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <Table.Root data-testid="suppliers-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("suppliers.table.code")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("suppliers.table.name")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("suppliers.table.contact")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("suppliers.table.city")}</Table.ColumnHeader>
              {canManage && (
                <Table.ColumnHeader className="text-right">{t("suppliers.table.actions")}</Table.ColumnHeader>
              )}
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {suppliers.map((supplier) => (
              <Table.Row
                key={supplier.id.toString()}
                data-testid={`supplier-row-${supplier.code}`}
                className="cursor-pointer hover:bg-surface-2"
                onClick={() => navigate(`/inventories/suppliers/${supplier.id}`)}
              >
                <Table.Cell data-testid={`supplier-open-${supplier.id}`}>{supplier.code}</Table.Cell>
                <Table.Cell>{supplier.name}</Table.Cell>
                <Table.Cell>{supplier.contact}</Table.Cell>
                <Table.Cell>{supplier.city}</Table.Cell>

                {canManage && (
                  // Stop the row's navigate from firing when a row action is used.
                  <Table.Cell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <IconButton
                        size="xs"
                        variant="ghost"
                        aria-label="Edit"
                        data-testid={`edit-${supplier.code}`}
                        onClick={() => setEditing(supplier)}
                      >
                        <Pencil className="size-4" />
                      </IconButton>

                      <ConfirmDialog
                        title={t("suppliers.deleteSupplier")}
                        message={t("suppliers.deleteConfirm", { name: supplier.name })}
                        confirmLabel={t("suppliers.delete")}
                        onConfirm={() => remove(supplier)}
                        trigger={
                          <IconButton
                            size="xs"
                            variant="ghost"
                            colorPalette="red"
                            aria-label="Delete"
                            data-testid={`delete-${supplier.code}`}
                          >
                            <Trash2 className="size-4" />
                          </IconButton>
                        }
                      />
                    </div>
                  </Table.Cell>
                )}
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {!loading && suppliers.length === 0 && !error && (
        <p className="text-fg-muted" data-testid="suppliers-empty">
          {t("suppliers.empty")}
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

      {/* One edit dialog, driven by the row's Edit action. Keyed so it re-initialises per supplier. */}
      {editing && (
        <SupplierFormDialog
          key={editing.id.toString()}
          supplier={editing}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      )}
    </div>
  );
}
