import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Pencil, Trash2 } from "lucide-react";
import { rpcError } from "../../api/clients";
import type { Rack } from "../../gen/warehouse/inventory/v1/rack_pb";
import { useTeam } from "../../features/team/TeamContext";
import { useDeleteRack, useRacks } from "./queries";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Pagination } from "../../components/Pagination";
import { toaster } from "../../components/Toaster";
import { RackFormDialog } from "./components/RackFormDialog";
import { Badge } from "../../components/ui/Badge";
import { IconButton } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Spinner } from "../../components/ui/Spinner";
import { Table } from "../../components/ui/Table";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// RacksPage lists the CURRENT team's racks (#129) — the physical places inside ONE warehouse, since
// a warehouse IS a team. Every RPC carries `current.teamId` in its body: the team is the scope, and
// a warehouse only ever sees its own racks.
//
// This is the registry — write down the shelves you have. A row opens the rack's detail page (#138),
// which is where the interesting question is answered: what is actually ON that shelf, and how much.
//
// The Racks menu shows for warehouse teams only, but the page is not gated here — root/admin reach
// the route directly and the server's policy is the real gate.
export function RacksPage() {
  const { current } = useTeam();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [editing, setEditing] = useState<Rack | null>(null);

  const teamId = current?.teamId;

  // The server already orders by code — the code is how a person reads the warehouse.
  const query = useRacks({ teamId, q, page, pageSize });
  const deleteRack = useDeleteRack();

  const racks = query.data?.racks ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  // `mutateAsync`, not `mutate`, because ConfirmDialog AWAITS its onConfirm to hold the button in its
  // loading state — a fire-and-forget `mutate` would resolve instantly and the dialog would close
  // while the delete was still in flight. mutateAsync REJECTS on failure, so the catch is not optional
  // here the way it would be with mutate's onError.
  async function remove(rack: Rack) {
    if (teamId === undefined) {
      return;
    }

    try {
      await deleteRack.mutateAsync({ teamId, rackId: rack.id });
      toaster.create({ type: "success", title: t("racks.deleted", { code: rack.code }) });
    } catch (err) {
      toaster.create({ type: "error", title: t("racks.deleteFailed"), description: rpcError(err) });
    }
  }

  // No current team means there is no warehouse to list against — the whole page is meaningless.
  if (!current) {
    return (
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("racks.title")}</h1>
        <p className="text-fg-muted" data-testid="racks-no-team">
          {t("racks.selectTeam")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-section">
      <div className="flex items-center gap-card">
        <h1 className="text-[22px] font-bold">{t("racks.title")}</h1>
        <Badge colorPalette="brand">{current.teamName || `Team #${current.teamId}`}</Badge>
        <div className="flex-1" />
        <RackFormDialog />
      </div>

      <div className="flex items-center gap-2">
        <div className="w-full max-w-sm">
          <Input
            placeholder={t("racks.searchPlaceholder")}
            value={q}
            data-testid="rack-search"
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
          />
        </div>
      </div>

      {error && (
        <p className="text-neg" data-testid="racks-error">
          {error}
        </p>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <Table.Root data-testid="racks-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("racks.table.code")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("racks.table.name")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("racks.table.description")}</Table.ColumnHeader>
              <Table.ColumnHeader className="text-right">{t("racks.table.actions")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {racks.map((rack) => (
              <Table.Row
                key={rack.id.toString()}
                data-testid={`rack-row-${rack.code}`}
                className="cursor-pointer hover:bg-surface-2"
                onClick={() => navigate(`/inventories/racks/${rack.id}`)}
              >
                {/* The code is what is painted on the shelf — it IS the rack's identity, so it
                    carries the row. */}
                <Table.Cell className="font-medium">{rack.code}</Table.Cell>
                <Table.Cell>{rack.name}</Table.Cell>
                <Table.Cell className="text-fg-muted">{rack.description}</Table.Cell>

                {/* Stop the row's navigate from firing when a row action is used. */}
                <Table.Cell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    <IconButton
                      size="xs"
                      variant="ghost"
                      aria-label="Edit"
                      data-testid={`edit-rack-${rack.code}`}
                      onClick={() => setEditing(rack)}
                    >
                      <Pencil className="size-4" />
                    </IconButton>

                    <ConfirmDialog
                      title={t("racks.deleteRack")}
                      message={t("racks.deleteConfirm", { code: rack.code })}
                      confirmLabel={t("racks.delete")}
                      onConfirm={() => remove(rack)}
                      trigger={
                        <IconButton
                          size="xs"
                          variant="ghost"
                          colorPalette="red"
                          aria-label="Delete"
                          data-testid={`delete-rack-${rack.code}`}
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

      {!loading && racks.length === 0 && !error && (
        <p className="text-fg-muted" data-testid="racks-empty">
          {t("racks.empty")}
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

      {/* One edit dialog, driven by the row's Edit action. Keyed so it re-initialises per rack. */}
      {editing && (
        <RackFormDialog
          key={editing.id.toString()}
          rack={editing}
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      )}
    </div>
  );
}
