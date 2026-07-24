import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Ban, MoreHorizontal, Pencil } from "lucide-react";

import { Badge } from "../../components/ui/Badge";
import { IconButton } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Menu, Portal } from "../../components/ui/Menu";
import { Spinner } from "../../components/ui/Spinner";
import { StatTile } from "../../components/ui/StatTile";
import { Table } from "../../components/ui/Table";
import { rpcError } from "../../api/clients";
import type { ExpenseRecord } from "../../gen/warehouse/expense/v1/expense_pb";
import { ExpenseKind } from "../../gen/warehouse/expense/v1/expense_pb";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ExpenseKindSelect, expenseKindLabel } from "../../components/ExpenseKindSelect";
import { Pagination } from "../../components/Pagination";
import { toaster } from "../../components/Toaster";
import { formatRupiah } from "../../lib/money";
import { useTeam } from "../../features/team/TeamContext";
import { thisMonth } from "../../lib/period";
import { RecordExpenseDialog } from "./components/RecordExpenseDialog";
import { useExpenses, useVoidExpense } from "./queries";

const PAGE_SIZE_OPTIONS = [10, 20, 50];


// ExpensesPage lists what a team spent in a month (#170) — the money no order caused.
//
// The MONTH PICKER is the primary control, not a nicety: a cost list without a period is a wall of
// every cost ever recorded, and the same period is what the profit screen subtracts against.
export function ExpensesPage() {
  const { current } = useTeam();
  const { t } = useTranslation();

  // Only the FILTERS are state now (#175). The rows, the totals, the page count, the spinner and the
  // error are all derived from the query — nothing here re-declares them, so they cannot drift out
  // of step with each other the way six independent useStates could.
  const [month, setMonth] = useState(thisMonth);
  const [kind, setKind] = useState<ExpenseKind>(ExpenseKind.UNSPECIFIED);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [editing, setEditing] = useState<ExpenseRecord | null>(null);
  const [voiding, setVoiding] = useState<ExpenseRecord | null>(null);

  const teamId = current?.teamId;

  const query = useExpenses({ teamId, month, kind, page, pageSize });
  const voidExpense = useVoidExpense();

  const expenses = query.data?.expenses ?? [];
  const totals = query.data?.totals;
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  // `mutateAsync`, not `mutate`, because ConfirmDialog AWAITS its onConfirm to hold the button in its
  // loading state — a fire-and-forget `mutate` would resolve instantly and the dialog would close
  // while the write was still in flight. mutateAsync REJECTS on failure, so the catch is not optional
  // here the way it would be with mutate's onError.
  async function voidCost(cost: ExpenseRecord) {
    if (teamId === undefined) return;

    try {
      await voidExpense.mutateAsync({ teamId, expenseId: cost.id });
      toaster.create({ type: "success", title: t("expenses.toast.voided") });
    } catch (err) {
      toaster.create({
        type: "error",
        title: t("expenses.toast.voidFailed"),
        description: rpcError(err),
      });
    }
  }

  if (!current) {
    return (
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("expenses.title")}</h1>
        <p className="text-fg-muted" data-testid="expenses-no-team">
          {t("expenses.selectTeam")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-section">
      <div className="flex flex-wrap items-center gap-card">
        <h1 className="text-[22px] font-bold">{t("expenses.title")}</h1>
        <Badge colorPalette="brand">{current.teamName}</Badge>
        <div className="flex-1" />

        {/* The period. First control on the page because it decides what every number below means. */}
        <div className="w-40">
          <Input
            type="month"
            value={month}
            data-testid="expenses-month"
            onChange={(e) => {
              setMonth(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <RecordExpenseDialog teamId={current.teamId} />
      </div>

      {/* The summary — per kind and in total, for the WHOLE month rather than the page below. The
          server computes them (#168) precisely so this cannot drift into a page-derived figure. */}
      {!loading && totals && (
        <div className="grid grid-cols-2 gap-card md:grid-cols-4" data-testid="expenses-totals">
          {[ExpenseKind.ADS, ExpenseKind.PAYROLL, ExpenseKind.OPERATIONAL].map((k) => (
            <StatTile
              key={k}
              label={expenseKindLabel(t, k)}
              value={
                <span data-testid={`expenses-total-kind-${k}`}>
                  {/* A kind with nothing this month is ABSENT from the map (#168), which reads as
                      0 here — the only place absent and zero are allowed to look the same, because
                      on a summary card they mean the same thing. */}
                  {formatRupiah(totals.byKind[k] ?? 0n)}
                </span>
              }
            />
          ))}

          <StatTile
            label={t("expenses.total")}
            value={<span data-testid="expenses-total">{formatRupiah(totals.total)}</span>}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-card">
        <div className="w-full sm:w-56">
          <ExpenseKindSelect
            filter
            testId="expenses-kind-filter"
            value={kind}
            onChange={(k) => {
              setKind(k);
              setPage(1);
            }}
          />
        </div>
      </div>

      {error && (
        <p className="text-red-600 dark:text-red-400" data-testid="expenses-error">
          {error}
        </p>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <Table.Root data-testid="expenses-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("expenses.table.date")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("expenses.table.kind")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("expenses.table.note")}</Table.ColumnHeader>
              <Table.ColumnHeader className="text-right">{t("expenses.table.amount")}</Table.ColumnHeader>
              <Table.ColumnHeader className="text-right">{t("expenses.table.actions")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {expenses.map((cost) => (
              <Table.Row
                key={String(cost.id)}
                data-testid={`expense-row-${cost.id}`}
                // A VOIDED cost is shown, muted and struck through (#169). It was entered and then
                // retracted, and that is worth seeing — hidden is indistinguishable from deleted.
                className={cost.voided ? "text-fg-muted line-through" : undefined}
              >
                <Table.Cell>{cost.occurredAt}</Table.Cell>
                <Table.Cell>
                  {expenseKindLabel(t, cost.kind)}
                  {cost.voided && (
                    <Badge className="ml-2" colorPalette="gray" data-testid={`expense-voided-${cost.id}`}>
                      {t("expenses.voided")}
                    </Badge>
                  )}
                </Table.Cell>
                <Table.Cell>{cost.note}</Table.Cell>
                <Table.Cell className="text-right">{formatRupiah(cost.amount)}</Table.Cell>

                <Table.Cell className="text-right" onClick={(e) => e.stopPropagation()}>
                  {/* Two actions behind an overflow menu, each with a leading icon — and a voided cost
                      offers neither, because it can no longer be edited (#169) and voiding it again
                      would do nothing. */}
                  {!cost.voided && (
                    <Menu.Root>
                      <Menu.Trigger asChild>
                        <IconButton
                          size="xs"
                          variant="ghost"
                          aria-label={t("expenses.table.actions")}
                          data-testid={`expense-actions-${cost.id}`}
                        >
                          <MoreHorizontal className="size-4" />
                        </IconButton>
                      </Menu.Trigger>
                      <Portal>
                        <Menu.Positioner>
                          <Menu.Content>
                            <Menu.Item
                              value="edit"
                              data-testid={`expense-edit-${cost.id}`}
                              onSelect={() => setEditing(cost)}
                            >
                              <Pencil className="size-4" />
                              {t("expenses.edit")}
                            </Menu.Item>

                            {/* Voiding changes a profit figure, so it confirms first. */}
                            <Menu.Item
                              value="void"
                              className="text-red-600 dark:text-red-400 [&_svg]:text-current!"
                              data-testid={`expense-void-${cost.id}`}
                              onSelect={() => setVoiding(cost)}
                            >
                              <Ban className="size-4" />
                              {t("expenses.void")}
                            </Menu.Item>
                          </Menu.Content>
                        </Menu.Positioner>
                      </Portal>
                    </Menu.Root>
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {!loading && expenses.length === 0 && !error && (
        <p className="text-fg-muted" data-testid="expenses-empty">
          {t("expenses.empty")}
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

      {/* Voiding changes a profit figure, so it confirms first — the menu closes and this controlled
          ConfirmDialog opens on the chosen cost. */}
      {voiding && (
        <ConfirmDialog
          open
          onOpenChange={(o) => {
            if (!o) setVoiding(null);
          }}
          title={t("expenses.voidDialog.title")}
          message={t("expenses.voidDialog.message")}
          confirmLabel={t("expenses.voidDialog.confirm")}
          onConfirm={() => voidCost(voiding)}
        />
      )}

      {/* The edit form is the record re-opened — the same dialog, given a cost to start from. */}
      {editing && (
        <RecordExpenseDialog
          teamId={current.teamId}
          editing={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
