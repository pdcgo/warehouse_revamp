import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Box, Button, Flex, Heading, Icon, IconButton, Spacer, Stack, Tabs, Text } from "@chakra-ui/react";
import { ArrowLeft, BellRing, Plus } from "lucide-react";

import { rpcError, teamClient } from "../../api/clients";
import { ChangeLogPanel } from "../../features/liability/ChangeLogPanel";
import { TermsPanel } from "./components/TermsPanel";
import { LimitSetOnYou } from "./components/LimitSetOnYou";
import { LiabilityLedgerTable } from "./components/LiabilityLedgerTable";
import { RejectPaymentDialog } from "./components/RejectPaymentDialog";
import { AcceptPaymentDialog } from "./components/AcceptPaymentDialog";
import { PaymentRequestNotice } from "./components/PaymentRequestNotice";
import { MakePaymentDialog } from "./components/MakePaymentDialog";
import { PaymentTable } from "./components/PaymentTable";
import { PairSummary } from "./components/PairSummary";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { toaster } from "../../components/feedback/Toaster";
import { canRequestPayment } from "../../lib/roles";
import { teamByIdsRowData, teamsByIds } from "../../features/teams/adapt";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import {
  LiabilityLogDirection,
  LiabilityPaymentSide,
  type LiabilityPayment,
} from "../../gen/warehouse/liability/v1/liability_pb";
import { formatRupiah, signOfRupiah } from "../../lib/money";
import { ALL_DATES, DateRangePicker, isAllDates, type DateRange } from "../../components/datetime/DateRangePicker";
import { dateRangeCodec, useUrlState } from "../../lib/urlState";
import { canWrite, useTeam } from "../../features/team/TeamContext";
import {
  liabilityPeriod,
  useLiabilityLogs,
  useLiabilityPayments,
  useLiabilityPosition,
  useRequestPayment,
} from "../../features/liability/queries";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { FilterBar, FilterField } from "../../components/chrome/FilterBar";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { useIsMobile } from "../../layouts/shell";
import { CompactActions } from "../../components/chrome/CompactActions";

const ENTRY_PAGE_SIZE = 50;
const PAYMENT_PAGE_SIZE = 50;

// WHICH CUT EACH TAB READS (backlog #34) — a ledger tab's direction and a payment tab's side, sent to the server, so each
// tab is its own filtered page rather than a cut of one loaded page. A tab with no cut of its own reads All / both.
function directionOf(tab: string): LiabilityLogDirection {
  if (tab === "receivable") return LiabilityLogDirection.RECEIVABLE;
  if (tab === "payable") return LiabilityLogDirection.PAYABLE;
  return LiabilityLogDirection.UNSPECIFIED;
}

function sideOf(tab: string): LiabilityPaymentSide {
  // Their payments — the counterparty paid THIS team, the creditor, who alone accepts them. Mine is the default, so the
  // payment read on the other tabs is the one My payments will show.
  return tab === "team" ? LiabilityPaymentSide.RECEIVED : LiabilityPaymentSide.PAID;
}

// The counterparty's kind, as a subtitle under its name.
function teamKindKey(type: TeamType): string {
  switch (type) {
    case TeamType.WAREHOUSE:
      return "liabilityDetail.kindWarehouse";
    case TeamType.SELLING:
      return "liabilityDetail.kindSelling";
    case TeamType.ROOT:
      return "liabilityDetail.kindRoot";
    default:
      return "liabilityDetail.kindOther";
  }
}

// LiabilityDetailPage is the running history of ONE relationship (#222/§5.1 B) — a PAGE, not a dialog
// (CLAUDE.md), reached by clicking a row on the liability list. The balance log in four cuts of one read — ALL, the
// whole running ledger, first and the default (the-team-balance-screens-are-accepted), then the receivable and
// payable directions — the payment records split by who recorded them (mine — you paid them — and theirs, which only
// you accept), the limit's changes and the pair's terms.
//
// A PHONE GETS ITS OWN ARRANGEMENT (the-team-balance-phone-layout-is-accepted) — a JS breakpoint, never CSS hiding: a
// one-row header, the position card full width, the date range in the Filter sheet, the seven tabs scrolling in one
// row, and every ledger entry, payment and limit change a block.
export function LiabilityDetailPage() {
  const { t } = useTranslation();
  const phone = useIsMobile();
  const { current } = useTeam();
  const navigate = useNavigate();
  const params = useParams();

  const counterpartyId = BigInt(params.counterpartyId ?? "0");

  const [entryPage, setEntryPage] = useState(1);
  const [paymentPage, setPaymentPage] = useState(1);
  // The CREDIT LIMIT log pages on its own. Three lists share this screen — entries, payments and
  // limit changes — and one shared page number would turn to page 2 of a log the reader is not
  // looking at, then show them page 2 of the one they are.
  //
  // ⚠ It belongs HERE, with the other hooks, above the `if (!current)` guard below. Declared after
  // that early return it runs on only one of the two paths, and React throws on the hook order.
  const [limitPage, setLimitPage] = useState(1);
  // THE DATE RANGE LIVES IN THE URL (a-lists-filters-live-in-the-url) — it narrows every tab, so a refresh keeps it.
  // The tabs are views of the pair, not filters, and stay where they are.
  const [dateRange, setDateRangeRaw] = useUrlState("range", ALL_DATES, dateRangeCodec);
  // ALL IS FIRST AND THE DEFAULT (the-team-balance-screens-are-accepted) — the whole running ledger, so a payment and a
  // reversal sit in their place and *Balance after* runs row to row.
  const [tab, setTabRaw] = useState("all");

  // A NEW RANGE OR A NEW TAB IS A NEW RESULT SET (backlog #34), so every pager it narrows starts again at page 1 — page 3
  // of the unfiltered ledger is not page 3 of one week of it.
  const setDateRange = (next: DateRange) => {
    setDateRangeRaw(next);
    setEntryPage(1);
    setPaymentPage(1);
    setLimitPage(1);
  };
  const setTab = (next: string) => {
    setTabRaw(next);
    setEntryPage(1);
    setPaymentPage(1);
  };
  const { from, to } = liabilityPeriod(dateRange);
  const direction = directionOf(tab);
  const side = sideOf(tab);
  const tabList = useRef<HTMLDivElement>(null);

  const [recordOpen, setRecordOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<LiabilityPayment | null>(null);
  // ⚠ A SEPARATE TARGET from confirm, not a mode flag on one. The two acts are different failures —
  // reject refuses a claim and posts nothing, confirm posts money — and one piece of state holding
  // both is how a mis-click becomes a settlement.
  const [rejectTarget, setRejectTarget] = useState<LiabilityPayment | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);

  const teamId = current?.teamId;

  // THE OPEN TAB'S OWN PAGE, filtered on the SERVER (backlog #34): the date range and the tab's direction or side go
  // with each read. They were one read each, cut here over the 50 rows loaded — so a range reaching past page 1 showed
  // only what page 1 held, and Their payments drew empty under a page of My payments. The ledger read also carries the
  // pair's balance (the WHOLE pair's, whatever the cut), so it runs on every tab.
  const entriesQuery = useLiabilityLogs({
    teamId,
    counterpartyId,
    page: entryPage,
    pageSize: ENTRY_PAGE_SIZE,
    from,
    to,
    direction,
  });
  const paymentsQuery = useLiabilityPayments({
    teamId,
    counterpartyId,
    awaitingMyConfirmation: false,
    page: paymentPage,
    pageSize: PAYMENT_PAGE_SIZE,
    from,
    to,
    side,
  });

  // THE OPEN PAYMENT REQUEST, either way (a-creditor-may-request-payment) — read off the pair's position row.
  const positionQuery = useLiabilityPosition(teamId, counterpartyId);
  const requestPayment = useRequestPayment();

  // The counterparty is another team — resolve its name and kind (#142).
  const teamQuery = useQuery({
    queryKey: ["team-by-ids", [counterpartyId.toString()]],
    enabled: counterpartyId > 0n,
    queryFn: async () =>
      teamsByIds(
        await teamClient.teamByIds({
          filter: { ids: [counterpartyId] },
          dataRequest: teamByIdsRowData(),
        }),
      ),
  });
  const counterparty = teamQuery.data?.[counterpartyId.toString()];

  // ON A PHONE THE TABS SCROLL IN ONE ROW, and the picked one is kept in view — as the order page's section
  // chips are (SectionNav `compact`).
  useEffect(() => {
    if (!phone) return;
    tabList.current
      ?.querySelector<HTMLElement>("[data-selected]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [phone, tab]);

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("liabilityDetail.title")}</Heading>
        <Text color="fg.muted">{t("liabilityDetail.selectTeamView")}</Text>
      </Stack>
    );
  }

  // THE OPEN TAB'S ROWS, or undefined while its own page loads. A tab switch keeps the previous read on screen
  // (`placeholderData`, same pair only) — that is another cut's rows, so the tab shows its skeleton instead of them.
  // The balance above is the whole pair's in every cut, so it may stay.
  const entries = entriesQuery.data?.direction === direction ? entriesQuery.data.entries : undefined;
  const balance = entriesQuery.data?.balance ?? 0;
  const entriesTotal = entriesQuery.data?.totalItems ?? 0;

  const payments = paymentsQuery.data?.side === side ? paymentsQuery.data.payments : undefined;
  const paymentsTotal = paymentsQuery.data?.totalItems ?? 0;

  const name = counterparty?.name ?? t("liabilityDetail.teamFallback", { id: counterpartyId.toString() });

  // ⚠ EACH TAB DRAWS THE SERVER'S PAGE AS IT IS — the open tab's cut, in the range. Nothing narrows `entries` or
  // `payments` in the browser any more (backlog #34); each row's *Balance after* is the true running balance of the
  // whole ledger, stored when it was posted. My payments are the ones this team paid; Their payments the ones it was
  // paid — the only ones it, the creditor, accepts or rejects.

  const loading = entriesQuery.isPending || paymentsQuery.isPending;
  const error = entriesQuery.isError
    ? rpcError(entriesQuery.error)
    : paymentsQuery.isError
      ? rpcError(paymentsQuery.error)
      : "";

  // ⚠ NARROWED ONCE, HERE. `current` is guarded above, but TypeScript drops that narrowing inside a
  // closure, and the proof links need a concrete reader team — a `?? 0n` fallback would send a
  // GetDownloadUrl for team 0 rather than fail loudly.
  const readerTeamId = current.teamId;

  // Pay, request, confirm and reject are all writes — none while the admin team monitors the team.
  const writable = canWrite(current);
  // REQUEST PAYMENT — the creditor's owner and admin, while the counterparty owes (a-creditor-may-request-payment).
  const mayRequest = writable && signOfRupiah(balance) > 0 && canRequestPayment(current.role);
  // MAKE PAYMENT — ONLY THE TEAM THAT OWES (the-debtor-claims-the-creditor-decides). The creditor, and a pair square
  // or owing this team, is offered none; the server refuses them as FailedPrecondition. Read off the loaded balance, so
  // it appears once the ledger has said this team owes — never offered on a guess.
  const mayPay = writable && !entriesQuery.isPending && signOfRupiah(balance) < 0;

  async function sendRequest() {
    try {
      await requestPayment.mutateAsync({ teamId: readerTeamId, debtorTeamId: counterpartyId });
      toaster.create({ type: "success", title: t("liabilityDetail.requestDone", { name }) });
    } catch (err) {
      toaster.create({ type: "error", title: t("liabilityDetail.requestFailed"), description: rpcError(err) });
    }
  }

  const paymentTable = (rows: LiabilityPayment[] | undefined, emptyKey: string, withConfirm: boolean) =>
    rows === undefined ? (
      <ListSkeleton testId="liability-detail-tab-loading" />
    ) : (
    <PaymentTable
      rows={rows}
      emptyText={t(emptyKey)}
      withConfirm={withConfirm}
      writable={writable}
      readerTeamId={readerTeamId}
      onConfirm={setConfirmTarget}
      onReject={setRejectTarget}
      phone={phone}
    />
    );

  const ledgerTable = (emptyKey: string) =>
    entries === undefined ? (
      <ListSkeleton testId="liability-detail-tab-loading" />
    ) : (
      <LiabilityLedgerTable rows={entries} emptyText={t(emptyKey)} phone={phone} />
    );

  // Each tab's pager over its own filtered page; a new pair, range or cut starts it over.
  const entryPager = (testId: string) => (
    <GrowingPager
      page={entryPage}
      onPageChange={setEntryPage}
      hasNext={entriesQuery.isPlaceholderData ? undefined : entryPage * ENTRY_PAGE_SIZE < entriesTotal}
      resetKey={[counterpartyId, from, to, direction].join("|")}
      pageSize={ENTRY_PAGE_SIZE}
      testId={testId}
    />
  );
  const paymentPager = (testId: string) => (
    <GrowingPager
      page={paymentPage}
      onPageChange={setPaymentPage}
      hasNext={paymentsQuery.isPlaceholderData ? undefined : paymentPage * PAYMENT_PAGE_SIZE < paymentsTotal}
      resetKey={[counterpartyId, from, to, side].join("|")}
      pageSize={PAYMENT_PAGE_SIZE}
      testId={testId}
    />
  );

  // A phone's tab keeps its width and the row scrolls; the desktop's tabs sit in one row as they always did.
  const trigger = phone ? { flexShrink: "0" } : {};

  const back = (
    <IconButton
      size="xs"
      variant="ghost"
      aria-label={t("liabilityDetail.back")}
      data-testid="liability-detail-back"
      onClick={() => navigate("/liability")}
    >
      <Icon as={ArrowLeft} boxSize="4" />
    </IconButton>
  );

  // A phone's header action is its icon (a-phone-header-action-is-an-icon).
  const compactActions = (
    <CompactActions
      menuLabel={t("common.actions")}
      actions={[
        mayRequest && { id: "request", label: t("liabilityDetail.requestPayment"), icon: BellRing, testId: "liability-detail-request-payment", onClick: () => setRequestOpen(true) },
        mayPay && { id: "pay", label: t("liabilityDetail.makePayment"), icon: Plus, primary: true, testId: "liability-detail-make-payment", onClick: () => setRecordOpen(true) },
      ]}
    />
  );

  return (
    // The page arrives — a fade and a short rise (`motion-is-small-quick-and-shared`).
    <Stack gap="section" animationStyle="enter" data-testid="liability-detail-page" data-layout={phone ? "phone" : undefined}>
      {phone ? (
        // THE PHONE HEADER IS ONE ROW (the-phone-header-is-one-row) — back, the name and its kind, the actions' icons.
        <Flex align="center" gap="2" wrap="nowrap" data-testid="liability-detail-header">
          {back}
          <Stack gap="0" flex="1" minW="0">
            <Heading size="md" truncate>
              {name}
            </Heading>
            {counterparty && (
              <Text color="fg.subtle" fontSize="xs" truncate>
                {t(teamKindKey(counterparty.type))}
              </Text>
            )}
          </Stack>
          {writable && compactActions}
        </Flex>
      ) : (
        <Flex align="flex-start" gap="card" wrap="wrap" data-testid="liability-detail-header">
          {back}
          <Stack gap="0">
            <Heading size="md">{name}</Heading>
            {counterparty && (
              <Text color="fg.subtle" fontSize="sm">
                {t(teamKindKey(counterparty.type))}
              </Text>
            )}
          </Stack>
          <Spacer />
          {writable && (
            <Flex gap="field">
              {mayRequest && (
                <Button variant="outline" data-testid="liability-detail-request-payment" onClick={() => setRequestOpen(true)}>
                  <Icon as={BellRing} boxSize="4" />
                  {t("liabilityDetail.requestPayment")}
                </Button>
              )}
              {mayPay && (
                <Button colorPalette="brand" data-testid="liability-detail-make-payment" onClick={() => setRecordOpen(true)}>
                  <Icon as={Plus} boxSize="4" />
                  {t("liabilityDetail.makePayment")}
                </Button>
              )}
            </Flex>
          )}
        </Flex>
      )}

      <PaymentRequestNotice request={positionQuery.data?.paymentRequest} teamId={current.teamId} counterpartyName={name} />

      {/* The position, as the order list's cards: the net figure leading, its two gross sides beside it. */}
      <Stack gap="card">
        <PairSummary balance={balance} phone={phone} />
        {/* THE LIMIT THEY SET ON YOU — only when this team is the debtor on the pair, so the creditor's
            view is untouched (the-debtor-sees-the-limits-set-on-it). */}
        <LimitSetOnYou teamId={current.teamId} creditorId={counterpartyId} creditorName={name} />
      </Stack>
      {/* The position row carries no oldest-unsettled timestamp — LiabilityLogList returns only the
          balance, so "oldest unsettled N days" is omitted here (it lives on the list's position row). */}

      {/* Date range — OUTSIDE the tabs: one filter over whichever tab is open. On a phone it opens from the sheet
          (a-phone-filters-from-a-sheet), the history's title beside the Filter button. */}
      <Flex align="center" gap="card" wrap="wrap">
        <Text fontSize="sm" fontWeight="medium" color="fg.muted">
          {t("liabilityDetail.history")}
        </Text>
        <Spacer />
        {phone ? (
          <Box>
            <FilterBar
              active={!isAllDates(dateRange)}
              count={isAllDates(dateRange) ? 0 : 1}
              onClear={() => setDateRange(ALL_DATES)}
              testId="liability-detail-filters"
            >
              <FilterField w="auto">
                <DateRangePicker value={dateRange} onChange={setDateRange} testId="liability-detail-range" />
              </FilterField>
            </FilterBar>
          </Box>
        ) : (
          <DateRangePicker value={dateRange} onChange={setDateRange} testId="liability-detail-range" />
        )}
      </Flex>

      {error && (
        <Text color="error.fg" data-testid="liability-detail-error">
          {error}
        </Text>
      )}

      {/* The ledger's shape while it loads; then one underline slides to the picked tab, and the tab fades in where
          the last one was (motion-is-small-quick-and-shared). */}
      {loading ? (
        <ListSkeleton testId="liability-detail-loading" />
      ) : (
        // Only the open tab is mounted (a-page-picks-its-view-over-its-filters' `lazyMount` / `unmountOnExit`): All and
        // the two cuts draw the same entries, and each panel reads only when it is opened.
        <Tabs.Root value={tab} onValueChange={(e) => setTab(e.value)} variant="line" lazyMount unmountOnExit>
          <Tabs.List
            ref={tabList}
            // Seven tabs do not fit 390px, so on a phone they SCROLL in one row rather than overlap.
            {...(phone ? { overflowX: "auto", flexWrap: "nowrap", css: { scrollbarWidth: "none" } } : {})}
            data-scroll={phone ? "x" : undefined}
          >
            <Tabs.Trigger value="all" {...trigger} data-testid="liability-detail-tab-all">
              {t("liabilityDetail.tabAll")}
            </Tabs.Trigger>
            <Tabs.Trigger value="receivable" {...trigger} data-testid="liability-detail-tab-receivable">
              {t("liabilityDetail.tabReceivable")}
            </Tabs.Trigger>
            <Tabs.Trigger value="payable" {...trigger} data-testid="liability-detail-tab-payable">
              {t("liabilityDetail.tabPayable")}
            </Tabs.Trigger>
            <Tabs.Trigger value="mine" {...trigger} data-testid="liability-detail-tab-mine">
              {t("liabilityDetail.tabMine")}
            </Tabs.Trigger>
            <Tabs.Trigger value="team" {...trigger} data-testid="liability-detail-tab-team">
              {t("liabilityDetail.tabTeam")}
            </Tabs.Trigger>
            {/* THE CREDIT LIMIT LOG — `team_balance_design.md` §Detail Pair Team Balance 2.
                ⚠ It is a DIFFERENT log from the ledger tabs beside it. Those are money that MOVED;
                this is a RULE that changed. Both belong on this page because a person asking "why
                is this team blocked" needs the limit's history and the balance's history together —
                but they must never be merged into one list, because they have different grains and
                only one of them is a ledger. */}
            <Tabs.Trigger value="limits" {...trigger} data-testid="liability-detail-tab-limits">
              {t("liabilityDetail.tabLimits")}
            </Tabs.Trigger>
            {/* WHERE THE LIMIT IS SET — terms-live-on-the-pair-detail.
                ⚠ It was a screen of its own at `/liability/terms`, listing every counterparty in one
                table. Terms belong beside the pair they govern, so the list is gone and each pair
                carries its own. The tab beside this one is the same limit's HISTORY: one writes the
                rule, the other shows how it changed. */}
            <Tabs.Trigger value="terms" {...trigger} data-testid="liability-detail-tab-terms">
              {t("liabilityDetail.tabTerms")}
            </Tabs.Trigger>
            <Tabs.Indicator />
          </Tabs.List>

          <Tabs.Content value="all" animationStyle="swap">
            <Stack gap="card" data-testid="liability-detail-all">
              {ledgerTable("liabilityDetail.emptyAll")}
              {entryPager("liability-detail-all-pager")}
            </Stack>
          </Tabs.Content>

          <Tabs.Content value="receivable" animationStyle="swap">
            <Stack gap="card" data-testid="liability-detail-receivable">
              {ledgerTable("liabilityDetail.emptyReceivable")}
              {entryPager("liability-detail-receivable-pager")}
            </Stack>
          </Tabs.Content>

          <Tabs.Content value="payable" animationStyle="swap">
            <Stack gap="card" data-testid="liability-detail-payable">
              {ledgerTable("liabilityDetail.emptyPayable")}
              {entryPager("liability-detail-payable-pager")}
            </Stack>
          </Tabs.Content>

          <Tabs.Content value="mine" animationStyle="swap">
            <Stack gap="card" data-testid="liability-detail-mine">
              {paymentTable(payments, "liabilityDetail.emptyMine", false)}
              {paymentPager("liability-detail-mine-pager")}
            </Stack>
          </Tabs.Content>

          <Tabs.Content value="team" animationStyle="swap">
            <Stack gap="card" data-testid="liability-detail-team">
              {paymentTable(payments, "liabilityDetail.emptyTeam", true)}
              {paymentPager("liability-detail-team-pager")}
            </Stack>
          </Tabs.Content>

          <Tabs.Content value="terms" animationStyle="swap">
            <TermsPanel
              teamId={current.teamId}
              counterpartyId={counterpartyId}
              counterpartyName={name}
              role={current.role}
              // The page holds a SIGNED balance from this team's side; a meter wants a magnitude, and
              // a counterparty in credit owes nothing rather than a negative amount.
              debt={balance > 0 ? balance : 0}
            />
          </Tabs.Content>

          <Tabs.Content value="limits" animationStyle="swap">
            {/* The panel is a DOMAIN component (features/liability), not this page's: the Credit
                Terms screen renders the same log across every counterparty, and the moment a second
                page imported it, it stopped being one page's component. */}
            <ChangeLogPanel
              teamId={current.teamId}
              counterpartyId={counterpartyId}
              nameOf={() => name}
              page={limitPage}
              onPageChange={setLimitPage}
              from={from}
              to={to}
              phone={phone}
            />
          </Tabs.Content>
        </Tabs.Root>
      )}

      {/* ACCEPT PAYMENT — it posts to the ledger and is final, and it names the account the money
          landed in (a-team-payment-posts-on-accept), so it is a dialog with a field, not a yes/no. */}
      <AcceptPaymentDialog
        target={confirmTarget}
        onClose={() => setConfirmTarget(null)}
        teamId={current.teamId}
      />

      <RejectPaymentDialog
        target={rejectTarget}
        onClose={() => setRejectTarget(null)}
        teamId={current.teamId}
      />

      {/* It posts nothing and blocks nothing, but it is SENT to another team — so it is confirmed, with what it says. */}
      <ConfirmDialog
        open={requestOpen}
        onOpenChange={setRequestOpen}
        title={t("liabilityDetail.requestTitle")}
        message={t("liabilityDetail.requestMessage", { name, amount: formatRupiah(balance > 0 ? balance : 0) })}
        confirmLabel={t("liabilityDetail.requestConfirm")}
        onConfirm={sendRequest}
      />

      <MakePaymentDialog
        open={recordOpen}
        onOpenChange={setRecordOpen}
        payerTeamId={current.teamId}
        creditorTeamId={counterpartyId}
        counterpartyName={name}
      />
    </Stack>
  );
}
