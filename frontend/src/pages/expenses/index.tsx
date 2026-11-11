import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Card,
  Flex,
  HStack,
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
import { useIsMobile } from "../../layouts/shell";
import { formatDayShort } from "../../lib/datetime";
import { thisMonth } from "../../lib/period";
import { canMoveExpenses } from "../../lib/roles";
import { type UrlCodec, enumCodec, useUrlState } from "../../lib/urlState";
import { useShopsByIds } from "../../features/shops/queries";
import { useActors } from "../../features/users/queries";
import { ActorName } from "../../components/entity/ActorName";
import { personName } from "../../lib/users";
import { AdjustExpenseDialog } from "./components/AdjustExpenseDialog";
import { RecordExpenseDialog } from "./components/RecordExpenseDialog";
import { useExpenseAccountNames } from "./components/accountName";
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
  const isMobile = useIsMobile();

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
  // The row whose Batalkan is being confirmed. The confirm is the PAGE's, not the menu item's: the menu closes on select
  // like every other item, so it is not left open behind the dialog (nor after it, refused or not).
  const [cancelling, setCancelling] = useState<ExpenseRecord | null>(null);

  const teamId = current?.teamId;

  // WHO MAY MOVE A COST — expense.proto's ExpenseCreate/ExpenseAdjust policy, and not a monitor. canWrite first: a
  // monitor's role is the screen role, which alone would offer the Owner's writes. Customer service is in no expense
  // policy at all, so it is offered neither Record nor a row's actions (the server would refuse every one).
  const mayMove = canWrite(current) && canMoveExpenses(current?.role);

  const query = useExpenses({ teamId, month, kind, page, pageSize });
  const adjustExpense = useAdjustExpense();

  const expenses = query.data?.expenses ?? [];
  const totals = query.data?.totals;

  // THE PAYING ACCOUNT, BY NAME (an-expense-must-name-the-account-that-paid) — the accounts' own read, one per page. An
  // expense made before Paid from names none, and says so.
  const accountNames = useExpenseAccountNames(
    teamId,
    expenses.map((e) => e.financeAccountId),
  );
  // The shop a row names — an Ads expense's, or an older row's from before a shop was for ads only.
  const shopNames = useShopsByIds({ shopIds: expenses.map((e) => e.shopId) }).data;
  // WHO RECORDED IT (an-override-shows-a-platform-badge: a record that named nobody gains the name, and the badge on an
  // override — the-override-badge-is-accepted-as-by-root-team: a Recorded by column, a line on phones). One UserByIDs
  // for the page's people.
  const creators = useActors(expenses.map((e) => e.createdBy)).data;
  const creatorOf = (cost: ExpenseRecord) =>
    personName(creators?.get(cost.createdBy.toString()), `#${cost.createdBy}`);
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

  // The row being cancelled AS THE LIST HOLDS IT NOW, as Adjust is handed — after a refusal refetches, a second Batalkan
  // offers the figure the server holds.
  const cancelRow = cancelling ? (expenses.find((e) => e.id === cancelling.id) ?? cancelling) : null;

  // A row's two actions behind one overflow menu, each with a leading icon — the same menu on both drawings. Batalkan is
  // not offered once the expense counts for nothing: there is nothing left to cancel.
  function rowActions(cost: ExpenseRecord) {
    return (
      <Menu.Root>
        <Menu.Trigger asChild>
          <IconButton
            size={isMobile ? "sm" : "xs"}
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
              <Menu.Item value="adjust" data-testid={`expense-adjust-${cost.id}`} onClick={() => setAdjusting(cost)}>
                <Icon as={SlidersHorizontal} boxSize="4" />
                {t("expenses.adjust")}
              </Menu.Item>

              {/* Cancelling moves a profit figure, so it confirms first — in the page's dialog, below. */}
              {cost.netAmount > 0n && (
                <Menu.Item
                  value="cancel"
                  color="error.fg"
                  data-testid={`expense-cancel-${cost.id}`}
                  onClick={() => setCancelling(cost)}
                >
                  <Icon as={Ban} boxSize="4" />
                  {t("expenses.cancel")}
                </Menu.Item>
              )}
            </Menu.Content>
          </Menu.Positioner>
        </Portal>
      </Menu.Root>
    );
  }

  // What a row's amount reads — an adjustment signed, an expense its typed amount and, only when a correction moved it,
  // what it counts for now (the figure the totals hold), so an untouched expense stays one line.
  function amountOf(cost: ExpenseRecord, isAdjustment: boolean) {
    if (isAdjustment) {
      return (
        <Text whiteSpace="nowrap" data-testid={`expense-amount-${cost.id}`}>
          {formatSignedRupiah(cost.amount)}
        </Text>
      );
    }

    return (
      <Stack gap="0" align="end">
        <Text whiteSpace="nowrap" data-testid={`expense-amount-${cost.id}`}>
          {formatRupiah(cost.amount)}
        </Text>
        {cost.netAmount !== cost.amount && (
          <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap" data-testid={`expense-net-${cost.id}`}>
            {t("expenses.netNow", { net: formatRupiah(cost.netAmount) })}
          </Text>
        )}
      </Stack>
    );
  }

  // Which account paid — its name, or, on an expense made before Paid from, that it names none.
  function accountOf(cost: ExpenseRecord) {
    const named = cost.financeAccountId !== 0n;

    return (
      <Text
        as="span"
        color={named ? undefined : "fg.muted"}
        data-testid={`expense-account-${cost.id}`}
        data-account-id={cost.financeAccountId.toString()}
      >
        {named ? (accountNames.get(cost.financeAccountId.toString()) ?? "…") : t("expenses.noAccount")}
      </Text>
    );
  }

  const shopOf = (cost: ExpenseRecord) =>
    cost.shopId === 0n ? "" : (shopNames?.get(cost.shopId.toString())?.name ?? "…");

  // Where a cancel's money goes back to — said in its confirm (a-correction-follows-the-expenses-account).
  function cancelMessage(cost: ExpenseRecord) {
    const net = formatRupiah(cost.netAmount);
    const where =
      cost.financeAccountId === 0n
        ? t("expenses.cancelNoAccount")
        : t("expenses.cancelAccount", { net, account: accountNames.get(cost.financeAccountId.toString()) ?? "…" });

    return `${t("expenses.cancelDialog.message", { net })} ${where}`;
  }

  const adjustmentBadge = (cost: ExpenseRecord) => (
    <Badge colorPalette="gray" data-testid={`expense-adjustment-${cost.id}`}>
      {t("expenses.adjustment")}
    </Badge>
  );

  // The period. The first control on the page because it decides what every number below means.
  const monthInput = (
    <Input
      type="month"
      w={isMobile ? "full" : "40"}
      flex={isMobile ? "1" : undefined}
      minW="0"
      value={month}
      data-testid="expenses-month"
      onChange={(e) => {
        setMonth(e.target.value);
        setPage(1);
      }}
    />
  );

  const kindFilter = (
    <ExpenseKindSelect
      filter
      testId="expenses-kind-filter"
      value={kind}
      onChange={(k) => {
        setKind(k);
        setPage(1);
      }}
    />
  );

  // A PHONE READS EACH EXPENSE AS A BLOCK (a-phone-reads-each-line-as-a-block): the kind and the amount on the first
  // line — the amount never wraps its "Rp" off its figure — the day and the note under it, the corrected net under the
  // amount, and the ⋯ at the block's edge. An adjustment is the same block, muted, badged, with no ⋯.
  function phoneList() {
    return (
      <Stack gap="2" data-testid="expenses-table">
        {expenses.map((cost) => {
          const isAdjustment = cost.adjustsExpenseId !== 0n;

          return (
            <HStack
              key={String(cost.id)}
              data-testid={`expense-row-${cost.id}`}
              align="start"
              gap="2"
              borderWidth="1px"
              borderRadius="md"
              p="3"
              color={isAdjustment ? "fg.muted" : undefined}
            >
              <Stack gap="0.5" flex="1" minW="0">
                <HStack gap="2" wrap="wrap">
                  <Text fontWeight="medium">{expenseKindLabel(t, cost.kind)}</Text>
                  {isAdjustment && adjustmentBadge(cost)}
                </HStack>
                {/* The day, then the account that paid — one muted line. */}
                <Text fontSize="sm" color="fg.muted" lineClamp={1}>
                  <Text as="span" data-testid={`expense-date-${cost.id}`}>
                    {formatDayShort(cost.occurredAt)}
                  </Text>
                  {" · "}
                  {accountOf(cost)}
                </Text>
                {cost.shopId !== 0n && (
                  <Text fontSize="sm" color="fg.muted" truncate data-testid={`expense-shop-${cost.id}`}>
                    {shopOf(cost)}
                  </Text>
                )}
                {cost.note && (
                  <Text fontSize="sm" lineClamp={2}>
                    {cost.note}
                  </Text>
                )}
                <Text fontSize="xs" color="fg.muted" data-testid={`expense-by-${cost.id}`}>
                  <ActorName
                    name={t("expenses.recordedBy", { name: creatorOf(cost) })}
                    isOverride={cost.isOverride}
                    size="xs"
                  />
                </Text>
              </Stack>

              <Stack gap="0" align="end" flexShrink={0}>
                {amountOf(cost, isAdjustment)}
              </Stack>

              {mayMove && (
                // The same width on every block, so the amounts line up down the list whether or not a row has a ⋯.
                <Flex w="8" flexShrink={0} justify="end" mt="-1" me="-1">
                  {!isAdjustment && rowActions(cost)}
                </Flex>
              )}
            </HStack>
          );
        })}
      </Stack>
    );
  }

  function desktopTable() {
    return (
      <Table.Root size="sm" data-testid="expenses-table">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("expenses.table.date")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("expenses.table.kind")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("expenses.table.paidFrom")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("expenses.table.note")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("expenses.table.recordedBy")}</Table.ColumnHeader>
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
                {/* The table cell's short day, "5 Nov" (a-table-date-is-short-and-every-time-is-wib). */}
                <Table.Cell whiteSpace="nowrap" data-testid={`expense-date-${cost.id}`}>
                  {formatDayShort(cost.occurredAt)}
                </Table.Cell>
                <Table.Cell>
                  <HStack gap="2" wrap="wrap">
                    {expenseKindLabel(t, cost.kind)}
                    {isAdjustment && adjustmentBadge(cost)}
                  </HStack>
                  {/* The shop under the kind — an Ads expense's, or an older row's. */}
                  {cost.shopId !== 0n && (
                    <Text fontSize="xs" color="fg.muted" truncate data-testid={`expense-shop-${cost.id}`}>
                      {shopOf(cost)}
                    </Text>
                  )}
                </Table.Cell>
                <Table.Cell whiteSpace="nowrap">{accountOf(cost)}</Table.Cell>
                <Table.Cell>{cost.note}</Table.Cell>
                <Table.Cell data-testid={`expense-by-${cost.id}`}>
                  <ActorName name={creatorOf(cost)} isOverride={cost.isOverride} />
                </Table.Cell>
                <Table.Cell textAlign="end">{amountOf(cost, isAdjustment)}</Table.Cell>

                <Table.Cell textAlign="end" onClick={(e) => e.stopPropagation()}>
                  {!isAdjustment && mayMove && rowActions(cost)}
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table.Root>
    );
  }

  return (
    <Stack gap="section">
      {/* A PHONE'S HEADER IS ONE ROW (the-phone-header-is-one-row): the title, the team, and Record as its icon
          (a-phone-header-action-is-an-icon). The month moves to the filter row under it, beside the kind. */}
      {isMobile ? (
        <Flex align="center" gap="2" wrap="nowrap">
          <HStack gap="2" flex="1" minW="0">
            <Heading size="md" flexShrink={0}>
              {t("expenses.title")}
            </Heading>
            <Badge colorPalette="brand" truncate minW="0">
              {current.teamName}
            </Badge>
          </HStack>
          {mayMove && <RecordExpenseDialog teamId={current.teamId} compact />}
        </Flex>
      ) : (
        <Flex align="center" gap="card" wrap="wrap">
          <Heading size="md">{t("expenses.title")}</Heading>
          <Badge colorPalette="brand">{current.teamName}</Badge>
          <Spacer />
          {monthInput}
          {mayMove && <RecordExpenseDialog teamId={current.teamId} />}
        </Flex>
      )}

      {/* The summary — per kind and in total, for the WHOLE month rather than the page below. The
          server computes them (#168) precisely so this cannot drift into a page-derived figure. */}
      {!loading && totals && (
        <Card.Root data-testid="expenses-totals" size={isMobile ? "sm" : undefined}>
          <Card.Body>
            {isMobile ? (
              // COMPACT ON A PHONE: the month's total on its own line, the three kinds under it, three to a row.
              <Stack gap="2">
                <Flex align="baseline" gap="2">
                  <Text fontSize="sm" color="fg.muted">
                    {t("expenses.total")}
                  </Text>
                  <Spacer />
                  <Text fontWeight="bold" whiteSpace="nowrap" data-testid="expenses-total">
                    {formatRupiah(totals.total)}
                  </Text>
                </Flex>
                <SimpleGrid columns={3} gap="2">
                  {[ExpenseKind.ADS, ExpenseKind.PAYROLL, ExpenseKind.OPERATIONAL].map((k) => (
                    <Stack key={k} gap="0" minW="0">
                      <Text fontSize="xs" color="fg.muted" truncate>
                        {expenseKindLabel(t, k)}
                      </Text>
                      <Text fontSize="sm" whiteSpace="nowrap" data-testid={`expenses-total-kind-${k}`}>
                        {formatRupiah(totals.byKind[k] ?? 0n)}
                      </Text>
                    </Stack>
                  ))}
                </SimpleGrid>
              </Stack>
            ) : (
              <SimpleGrid columns={4} gap="card">
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
            )}
          </Card.Body>
        </Card.Root>
      )}

      <Flex gap={isMobile ? "2" : "card"} wrap={isMobile ? "nowrap" : "wrap"}>
        {isMobile && monthInput}
        {isMobile ? (
          <Flex flex="1" minW="0">
            {kindFilter}
          </Flex>
        ) : (
          kindFilter
        )}
      </Flex>

      {error && (
        <Text color="error.fg" data-testid="expenses-error">
          {error}
        </Text>
      )}

      {/* A REFUSED READ shows the refusal alone — no empty table under it to read as an empty month. */}
      {loading ? <Spinner colorPalette="brand" /> : !error && (isMobile ? phoneList() : desktopTable())}

      {!loading && expenses.length === 0 && !error && (
        <Text color="fg.muted" data-testid="expenses-empty">
          {t("expenses.empty")}
        </Text>
      )}

      {!loading && !error && (
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

      {/* A correction is a new row, written by its own dialog — the expense itself never changes. It is handed the row
          AS THE LIST HOLDS IT NOW, so a refetch (after a refusal, say) shows the dialog the figure the server holds. */}
      {adjusting && (
        <AdjustExpenseDialog
          teamId={current.teamId}
          expense={expenses.find((e) => e.id === adjusting.id) ?? adjusting}
          onClose={() => setAdjusting(null)}
        />
      )}

      {/* Batalkan moves a profit figure, so it confirms first. */}
      {cancelRow && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setCancelling(null)}
          title={t("expenses.cancelDialog.title")}
          message={cancelMessage(cancelRow)}
          confirmLabel={t("expenses.cancelDialog.confirm")}
          onConfirm={() => cancelCost(cancelRow)}
        />
      )}
    </Stack>
  );
}
