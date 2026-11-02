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
import { Ban, MoreHorizontal, SlidersHorizontal } from "lucide-react";

import { rpcError } from "../../api/clients";
import type { ExpenseRecord } from "../../gen/warehouse/expense/v1/expense_pb";
import { ExpenseKind } from "../../gen/warehouse/expense/v1/expense_pb";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { COST_FILTER_KINDS, ExpenseKindSelect, expenseKindLabel } from "../../components/pickers/ExpenseKindSelect";
import { Pagination } from "../../components/chrome/Pagination";
import { toaster } from "../../components/feedback/Toaster";
import { formatRupiah, formatSignedRupiah } from "../../lib/money";
import { canWrite, useTeam } from "../../features/team/TeamContext";
import { thisMonth } from "../../lib/period";
import { type UrlCodec, enumCodec, useUrlState } from "../../lib/urlState";
import { AdjustExpenseDialog } from "./components/AdjustExpenseDialog";
import { RecordExpenseDialog } from "./components/RecordExpenseDialog";
import { useAdjustExpense, useExpenses } from "./queries";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// The month as the URL carries it — `2026-10`; anything else is read as "this month".
const MONTH_CODEC: UrlCodec<string> = {
  encode: (v) => v,
  decode: (raw) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : undefined),
};
const KIND_CODEC = enumCodec(COST_FILTER_KINDS);


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
  //
  // THE MONTH AND THE KIND LIVE IN THE URL (a-lists-filters-live-in-the-url) — a refresh opens the same month. This
  // month is the default, so it is left out: a bare link means "this month" whenever it is opened.
  const [month, setMonth] = useUrlState("month", thisMonth(), MONTH_CODEC);
  const [kind, setKind] = useUrlState<ExpenseKind>("kind", ExpenseKind.UNSPECIFIED, KIND_CODEC);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [adjusting, setAdjusting] = useState<ExpenseRecord | null>(null);

  const teamId = current?.teamId;

  const query = useExpenses({ teamId, month, kind, page, pageSize });
  const adjustExpense = useAdjustExpense();

  const expenses = query.data?.expenses ?? [];
  const totals = query.data?.totals;
  const totalItems = query.data?.totalItems ?? 0;
  const loading = query.isPending;
  const error = query.isError ? rpcError(query.error) : "";

  // `mutateAsync`, not `mutate`, because ConfirmDialog AWAITS its onConfirm to hold the button in its
  // loading state — a fire-and-forget `mutate` would resolve instantly and the dialog would close
  // while the write was still in flight. mutateAsync REJECTS on failure, so the catch is not optional
  // here the way it would be with mutate's onError.
  //
  // BATALKAN is an adjustment of minus what the expense still counts for (every-correction-is-a-signed-adjustment) —
  // the whole of it, so nobody types it. Its net, not its original amount: an expense already corrected down is
  // cancelled by what is left.
  async function cancelCost(cost: ExpenseRecord) {
    if (teamId === undefined) return;

    try {
      await adjustExpense.mutateAsync({
        teamId,
        expenseId: cost.id,
        amount: -cost.netAmount,
        note: t("expenses.cancelNote"),
      });
      toaster.create({ type: "success", title: t("expenses.toast.cancelled") });
    } catch (err) {
      toaster.create({
        type: "error",
        title: t("expenses.toast.cancelFailed"),
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

        {canWrite(current) && <RecordExpenseDialog teamId={current.teamId} />}
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
        <Text color="error.fg" data-testid="expenses-error">
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
            {expenses.map((cost) => {
              // An ADJUSTMENT is a row of its own, on its expense's day (an-adjustment-counts-on-the-day-it-fixes) — the
              // correction, signed, muted, with no actions: a mistaken one is fixed by correcting the expense again.
              const isAdjustment = cost.adjustsExpenseId !== 0n;

              return (
                <Table.Row
                  key={String(cost.id)}
                  data-testid={`expense-row-${cost.id}`}
                  color={isAdjustment ? "fg.muted" : undefined}
                >
                  <Table.Cell>{cost.occurredAt}</Table.Cell>
                  <Table.Cell>
                    {expenseKindLabel(t, cost.kind)}
                    {isAdjustment && (
                      <Badge ml="2" colorPalette="gray" data-testid={`expense-adjustment-${cost.id}`}>
                        {t("expenses.adjustment")}
                      </Badge>
                    )}
                  </Table.Cell>
                  <Table.Cell>{cost.note}</Table.Cell>
                  <Table.Cell textAlign="end">
                    {isAdjustment ? (
                      <Text data-testid={`expense-amount-${cost.id}`}>{formatSignedRupiah(cost.amount)}</Text>
                    ) : (
                      <Stack gap="0" align="end">
                        <Text data-testid={`expense-amount-${cost.id}`}>{formatRupiah(cost.amount)}</Text>
                        {/* What it counts for after its corrections — the figure the totals hold. Only shown when a
                            correction moved it, so an untouched expense stays one line. */}
                        {cost.netAmount !== cost.amount && (
                          <Text fontSize="xs" color="fg.muted" data-testid={`expense-net-${cost.id}`}>
                            {t("expenses.netNow", { net: formatRupiah(cost.netAmount) })}
                          </Text>
                        )}
                      </Stack>
                    )}
                  </Table.Cell>

                  <Table.Cell textAlign="end" onClick={(e) => e.stopPropagation()}>
                    {/* Two actions behind an overflow menu, each with a leading icon. Batalkan is not offered once
                        the expense counts for nothing — there is nothing left to cancel. */}
                    {!isAdjustment && canWrite(current) && (
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
                                value="adjust"
                                data-testid={`expense-adjust-${cost.id}`}
                                onClick={() => setAdjusting(cost)}
                              >
                                <Icon as={SlidersHorizontal} boxSize="4" />
                                {t("expenses.adjust")}
                              </Menu.Item>

                              {/* Cancelling moves a profit figure, so it confirms first. */}
                              {cost.netAmount > 0n && (
                                <ConfirmDialog
                                  title={t("expenses.cancelDialog.title")}
                                  message={t("expenses.cancelDialog.message", { net: formatRupiah(cost.netAmount) })}
                                  confirmLabel={t("expenses.cancelDialog.confirm")}
                                  onConfirm={() => cancelCost(cost)}
                                  trigger={
                                    <Menu.Item
                                      value="cancel"
                                      color="error.fg"
                                      data-testid={`expense-cancel-${cost.id}`}
                                      // The menu must NOT close on this one: it opens a confirm dialog,
                                      // and a menu that closes takes the dialog's trigger with it.
                                      closeOnSelect={false}
                                    >
                                      <Icon as={Ban} boxSize="4" />
                                      {t("expenses.cancel")}
                                    </Menu.Item>
                                  }
                                />
                              )}
                            </Menu.Content>
                          </Menu.Positioner>
                        </Portal>
                      </Menu.Root>
                    )}
                  </Table.Cell>
                </Table.Row>
              );
            })}
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

      {/* A correction is a new row, written by its own dialog — the expense itself never changes. */}
      {adjusting && (
        <AdjustExpenseDialog teamId={current.teamId} expense={adjusting} onClose={() => setAdjusting(null)} />
      )}
    </Stack>
  );
}
