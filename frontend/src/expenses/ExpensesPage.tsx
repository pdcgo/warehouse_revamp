import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Card,
  Flex,
  Heading,
  Icon,
  IconButton,
  Input,
  Menu,
  Portal,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { Ban, MoreHorizontal, Pencil } from "lucide-react";

import { rpcError } from "../api/clients";
import type { ExpenseRecord } from "../gen/warehouse/expense/v1/expense_pb";
import { ExpenseKind } from "../gen/warehouse/expense/v1/expense_pb";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ExpenseKindSelect, expenseKindLabel } from "../components/ExpenseKindSelect";
import { Pagination } from "../components/Pagination";
import { toaster } from "../components/Toaster";
import { formatRupiah } from "../lib/money";
import { useTeam } from "../team/TeamContext";
import { thisMonth } from "../lib/period";
import { RecordExpenseDialog } from "./RecordExpenseDialog";
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
      <Stack gap="section">
        <Heading size="md">{t("expenses.title")}</Heading>
        <Text color="fg.muted" data-testid="expenses-no-team">
          {t("expenses.selectTeam")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      <Flex align="center" gap="card" wrap="wrap">
        <Heading size="md">{t("expenses.title")}</Heading>
        <Badge colorPalette="brand">{current.teamName}</Badge>
        <Spacer />

        {/* The period. First control on the page because it decides what every number below means. */}
        <Input
          type="month"
          w="40"
          value={month}
          data-testid="expenses-month"
          onChange={(e) => {
            setMonth(e.target.value);
            setPage(1);
          }}
        />

        <RecordExpenseDialog teamId={current.teamId} />
      </Flex>

      {/* The summary — per kind and in total, for the WHOLE month rather than the page below. The
          server computes them (#168) precisely so this cannot drift into a page-derived figure. */}
      {!loading && totals && (
        <Card.Root data-testid="expenses-totals">
          <Card.Body>
            <SimpleGrid columns={{ base: 2, md: 4 }} gap="card">
              {[ExpenseKind.ADS, ExpenseKind.PAYROLL, ExpenseKind.OPERATIONAL].map((k) => (
                <Stack key={k} gap="0">
                  <Text fontSize="xs" color="fg.muted">
                    {expenseKindLabel(t, k)}
                  </Text>
                  <Text fontWeight="medium" data-testid={`expenses-total-kind-${k}`}>
                    {/* A kind with nothing this month is ABSENT from the map (#168), which reads as
                        0 here — the only place absent and zero are allowed to look the same, because
                        on a summary card they mean the same thing. */}
                    {formatRupiah(totals.byKind[k] ?? 0n)}
                  </Text>
                </Stack>
              ))}

              <Stack gap="0">
                <Text fontSize="xs" color="fg.muted">
                  {t("expenses.total")}
                </Text>
                <Text fontWeight="medium" data-testid="expenses-total">
                  {formatRupiah(totals.total)}
                </Text>
              </Stack>
            </SimpleGrid>
          </Card.Body>
        </Card.Root>
      )}

      <Flex gap="card" wrap="wrap">
        <ExpenseKindSelect
          filter
          testId="expenses-kind-filter"
          value={kind}
          onChange={(k) => {
            setKind(k);
            setPage(1);
          }}
        />
      </Flex>

      {error && (
        <Text color="red.fg" data-testid="expenses-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <Table.Root size="sm" data-testid="expenses-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("expenses.table.date")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("expenses.table.kind")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("expenses.table.note")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("expenses.table.amount")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">{t("expenses.table.actions")}</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {expenses.map((cost) => (
              <Table.Row
                key={String(cost.id)}
                data-testid={`expense-row-${cost.id}`}
                // A VOIDED cost is shown, muted and struck through (#169). It was entered and then
                // retracted, and that is worth seeing — hidden is indistinguishable from deleted.
                color={cost.voided ? "fg.muted" : undefined}
                textDecoration={cost.voided ? "line-through" : undefined}
              >
                <Table.Cell>{cost.occurredAt}</Table.Cell>
                <Table.Cell>
                  {expenseKindLabel(t, cost.kind)}
                  {cost.voided && (
                    <Badge ml="2" colorPalette="gray" data-testid={`expense-voided-${cost.id}`}>
                      {t("expenses.voided")}
                    </Badge>
                  )}
                </Table.Cell>
                <Table.Cell>{cost.note}</Table.Cell>
                <Table.Cell textAlign="end">{formatRupiah(cost.amount)}</Table.Cell>

                <Table.Cell textAlign="end" onClick={(e) => e.stopPropagation()}>
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
                          <Icon as={MoreHorizontal} boxSize="4" />
                        </IconButton>
                      </Menu.Trigger>
                      <Portal>
                        <Menu.Positioner>
                          <Menu.Content>
                            <Menu.Item
                              value="edit"
                              data-testid={`expense-edit-${cost.id}`}
                              onClick={() => setEditing(cost)}
                            >
                              <Icon as={Pencil} boxSize="4" />
                              {t("expenses.edit")}
                            </Menu.Item>

                            {/* Voiding changes a profit figure, so it confirms first. */}
                            <ConfirmDialog
                              title={t("expenses.voidDialog.title")}
                              message={t("expenses.voidDialog.message")}
                              confirmLabel={t("expenses.voidDialog.confirm")}
                              onConfirm={() => voidCost(cost)}
                              trigger={
                                <Menu.Item
                                  value="void"
                                  color="red.fg"
                                  data-testid={`expense-void-${cost.id}`}
                                  // The menu must NOT close on this one: it opens a confirm dialog,
                                  // and a menu that closes takes the dialog's trigger with it.
                                  closeOnSelect={false}
                                >
                                  <Icon as={Ban} boxSize="4" />
                                  {t("expenses.void")}
                                </Menu.Item>
                              }
                            />
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
        <Text color="fg.muted" data-testid="expenses-empty">
          {t("expenses.empty")}
        </Text>
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

      {/* The edit form is the record re-opened — the same dialog, given a cost to start from. */}
      {editing && (
        <RecordExpenseDialog
          teamId={current.teamId}
          editing={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Stack>
  );
}
