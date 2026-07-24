import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { rpcError } from "../../api/clients";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Checkbox } from "../../components/ui/Checkbox";
import { Spinner } from "../../components/ui/Spinner";
import { Table } from "../../components/ui/Table";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Pagination } from "../../components/Pagination";
import { toaster } from "../../components/Toaster";
import { useTeam } from "../../features/team/TeamContext";
import { draftGaps } from "../../features/orderDrafts/draftReadiness";
import { useDeleteOrderDrafts, useOrderDrafts } from "../../features/orderDrafts/queries";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// OrderDraftsPage lists the CALLER'S OWN drafts (#195) — incomplete orders pushed in by a
// third-party app, waiting for somebody here to finish them.
//
// ⚠ ITS OWN ROUTE, not a tab on the orders list. Drafts are not orders, and the UI says so the same
// way the schema does: a tab would put not-orders inside the orders screen, which is the concern the
// separate table was built around.
//
// The screen has two jobs, and the second is easy to under-build: opening a draft to finish it, and
// PRUNING. Nothing expires, and an app pushing continuously fills this list far faster than a person
// finishes one — so bulk delete is load-bearing, not a convenience.
export function OrderDraftsPage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const navigate = useNavigate();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const teamId = current?.teamId;

  const query = useOrderDrafts({ teamId, page, pageSize });
  const remove = useDeleteOrderDrafts();

  const drafts = query.data?.drafts ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  // The selection is held as ids rather than as a per-row flag so it survives a refetch — a delete
  // that reorders the page must not silently transfer a tick from one draft to another.
  const allOnPageSelected = drafts.length > 0 && drafts.every((d) => selected.has(d.id.toString()));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }

  function toggleAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);

      for (const draft of drafts) {
        const id = draft.id.toString();

        if (allOnPageSelected) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }

      return next;
    });
  }

  async function deleteSelected() {
    if (!teamId) {
      return;
    }

    try {
      const res = await remove.mutateAsync({
        teamId,
        draftIds: [...selected].map((id) => BigInt(id)),
      });

      setSelected(new Set());
      toaster.create({
        type: "success",
        title: t("orderDrafts.deleted", { count: res.deleted }),
      });
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    }
  }

  if (!current) {
    return (
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("orderDrafts.title")}</h1>
        <p className="text-fg-muted" data-testid="order-drafts-no-team">
          {t("orderDrafts.selectTeamView")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-section">
      <div className="flex flex-wrap items-center gap-card">
        <h1 className="text-[22px] font-bold">{t("orderDrafts.title")}</h1>
        <Badge colorPalette="brand">
          {current.teamName || t("orders.teamFallback", { id: current.teamId.toString() })}
        </Badge>
        <div className="flex-1" />

        {selected.size > 0 && (
          <Button
            size="xs"
            colorPalette="red"
            data-testid="delete-selected-drafts"
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 className="size-4" />
            {t("orderDrafts.deleteSelected", { count: selected.size })}
          </Button>
        )}
      </div>

      <p className="text-sm text-fg-muted">{t("orderDrafts.intro")}</p>

      {error && (
        <p className="text-red-600 dark:text-red-400" data-testid="order-drafts-error">
          {error}
        </p>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <Table.Root data-testid="order-drafts-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader className="w-1">
                <Checkbox
                  checked={allOnPageSelected}
                  onCheckedChange={toggleAllOnPage}
                  aria-label={t("orderDrafts.selectAll")}
                  data-testid="select-all-drafts"
                />
              </Table.ColumnHeader>
              <Table.ColumnHeader>{t("orderDrafts.reference")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("orders.customer")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("orderDrafts.lines")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("orderDrafts.remaining")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>

          <Table.Body>
            {drafts.map((d) => {
              const gaps = draftGaps(d);

              return (
                <Table.Row key={d.id.toString()} data-testid={`draft-row-${d.id}`}>
                  <Table.Cell>
                    <Checkbox
                      checked={selected.has(d.id.toString())}
                      onCheckedChange={() => toggle(d.id.toString())}
                      aria-label={t("orderDrafts.selectOne", { id: d.id.toString() })}
                      data-testid={`select-draft-${d.id}`}
                    />
                  </Table.Cell>

                  <Table.Cell>
                    <div
                      className="cursor-pointer font-medium text-accent-fg hover:underline"
                      data-testid={`open-draft-${d.id}`}
                      onClick={() => navigate(`/order-drafts/${d.id}`)}
                    >
                      {d.externalId}
                    </div>
                    {/* WHICH APP pushed it, kept beside the reference: two apps can scrape the same
                        marketplace, and an external id alone does not say whose it is. */}
                    <p className="text-xs text-fg-muted">{d.source}</p>
                  </Table.Cell>

                  <Table.Cell>{d.customerName || "—"}</Table.Cell>

                  <Table.Cell>
                    {d.unmappedItemCount > 0 ? (
                      <Badge colorPalette="orange" data-testid={`draft-unmapped-${d.id}`}>
                        {t("orderDrafts.unmappedOf", {
                          unmapped: d.unmappedItemCount,
                          total: d.itemCount,
                        })}
                      </Badge>
                    ) : (
                      <span>{d.itemCount}</span>
                    )}
                  </Table.Cell>

                  {/* WHAT IS LEFT TO DO, spelled out rather than reduced to ready/not-ready. Somebody
                      scanning forty drafts is deciding which to open next, and "needs a warehouse" is
                      a different amount of work from "three lines unmapped". */}
                  <Table.Cell>
                    {gaps.length === 0 ? (
                      <Badge colorPalette="green" data-testid={`draft-ready-${d.id}`}>
                        {t("orderDrafts.ready")}
                      </Badge>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1">
                        {gaps.map((gap) => (
                          <Badge key={gap.key} colorPalette="gray">
                            {t(gap.key)}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
      )}

      {!loading && drafts.length === 0 && !error && (
        <p className="text-fg-muted" data-testid="order-drafts-empty">
          {t("orderDrafts.noDrafts")}
        </p>
      )}

      {!loading && (
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
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("orderDrafts.deleteTitle")}
        message={t("orderDrafts.deleteMessage", { count: selected.size })}
        confirmLabel={t("orderDrafts.deleteConfirm")}
        onConfirm={deleteSelected}
      />
    </div>
  );
}
