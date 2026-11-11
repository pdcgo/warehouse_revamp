import { useState } from "react";
import { personName } from "../../lib/users";
import { useTranslation } from "react-i18next";
import { Field, Heading, Stack, Tabs, Text, Textarea } from "@chakra-ui/react";
import { History, Inbox } from "lucide-react";

import { rpcError } from "../../api/clients";
import {
  type FoundRequest,
  FoundRequestApproveBlock,
  FoundRequestStatus,
} from "../../gen/warehouse/inventory/v1/found_request_pb";
import type { PublicUser } from "../../gen/warehouse/user/v1/user_pb";
import { canWrite, useTeam } from "../../features/team/TeamContext";
import { useTeamsByIds } from "../../features/teams/queries";
import { useProductsByIds } from "../../features/products/queries";
import {
  useApproveFoundRequest,
  useFoundRequests,
  useRejectFoundRequest,
} from "../../features/inventory/foundRequests";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { toaster } from "../../components/feedback/Toaster";
import { CharCount } from "../../components/inputs/CharCount";
import { formatRupiahNumber } from "../../lib/money";
import { canDecideFound, canReportFound } from "../../lib/roles";
import { oneOfCodec, useUrlState } from "../../lib/urlState";
import { FoundRequestDetail } from "./components/FoundRequestDetail";
import { FoundRequestTable } from "./components/FoundRequestTable";

const TABS = [
  { value: "waiting", status: FoundRequestStatus.WAITING, labelKey: "foundRequest.tabs.waiting" },
  { value: "approved", status: FoundRequestStatus.APPROVED, labelKey: "foundRequest.tabs.approved" },
  { value: "rejected", status: FoundRequestStatus.REJECTED, labelKey: "foundRequest.tabs.rejected" },
  { value: "all", status: FoundRequestStatus.UNSPECIFIED, labelKey: "foundRequest.tabs.all" },
] as const;
type Tab = (typeof TABS)[number]["value"];
const TAB_CODEC = oneOfCodec<Tab>(TABS.map((x) => x.value));

// The reject reason — FoundRequestRejectRequest.reason's max_len.
const REASON_MAX = 500;

// FoundRequestsPage — FOUND STOCK, THE APPROVAL LIST (an-adjust-found-waits-for-the-owner-or-admin). A unit found on a
// rack outside a stock count is reported — on the Adjust screen, or by staff on the rack page (staff-may-report-a-found)
// — and waits here, posting nothing, until the warehouse Owner or Admin approves it — never the person who reported it —
// or rejects it with a reason. Each request says what its approval posts: the oldest open losses it claims back, at
// their price, then what it mints. A stock count that counts the rack first settles it (a-count-settles-the-found-it-counted).
//
// STAFF read only their own reports — the server filters them — and may withdraw them
// (the-reporter-may-withdraw-their-found); they approve nothing. That view was accepted 2026-11-03 (the-staff-found-screens-are-accepted).
//
// In the menu as Inventories ▸ Stock Opname · Found Stock, with the waiting count for the deciders
// (found-stock-sits-after-stock-opname-with-its-count).
//
// ON THE SCREEN RULES (owner: *"inisiasi found"*, the-found-list-follows-the-screen-rules): the page rises in and a first
// load is a skeleton; each request shows its product with its picture and its owner as the small avatar and the name.
// Its one filter is the status — the contract's only one — so it stays the tab row, in the URL.
//
// A TABLE, AS EVERY LIST (owner: *"desainnya kok gemuk begini"*, then *"listnya buat seperti yang lain, atau tabel saja"*,
// the-found-list-is-a-table) — one request a row; the note and what it posts line by line are its Rincian, opened by a
// click on the row (FoundRequestDetail). Each request was a card that opened all of it at once, about twelve lines each.
export function FoundRequestsPage() {
  const { current } = useTeam();
  const { t } = useTranslation();

  // The tab narrows the list, so it lives in the URL (a-lists-filters-live-in-the-url).
  const [tab, setTab] = useUrlState<Tab>("status", "waiting", TAB_CODEC);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [approving, setApproving] = useState<FoundRequest | null>(null);
  const [rejecting, setRejecting] = useState<FoundRequest | null>(null);
  const [reason, setReason] = useState("");
  const [openedId, setOpenedId] = useState<bigint | null>(null);

  const teamId = current?.teamId;
  const decider = canDecideFound(current?.role);
  // Staff read — their own only, filtered by the server — and withdraw.
  const reader = canReportFound(current?.role);
  // A monitor reads the list and decides nothing (the-admin-team-monitors-read-only).
  const writable = canWrite(current);
  const status = TABS.find((x) => x.value === tab)!.status;

  const list = useFoundRequests({ teamId: reader ? teamId : undefined, status, page, pageSize });
  const requests = list.data?.requests ?? [];
  const teams = useTeamsByIds({ ids: requests.map((r) => r.teamId) });
  // The pictures — one read for the page's products, any team's (a warehouse holds several sellers' goods). Best-effort:
  // a product it cannot name keeps the report's snapshot and the package placeholder.
  const products = useProductsByIds({ teamId, productIds: requests.map((r) => r.productId) });
  const approve = useApproveFoundRequest();
  const reject = useRejectFoundRequest();

  if (!current || teamId === undefined) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("foundRequest.title")}</Heading>
        <Text color="fg.muted">{t("foundRequest.selectTeam")}</Text>
      </Stack>
    );
  }

  const actors = list.data?.actors ?? new Map<string, PublicUser>();
  const nameOf = (id: bigint) => (id > 0n ? personName(actors.get(id.toString()), `#${id}`) : "—");
  const error = list.isError ? rpcError(list.error) : "";
  const rejectingOwn = rejecting?.block === FoundRequestApproveBlock.OWN_REPORT;
  // The Rincian reads the request off the CURRENT page, so a refetch after a decision shows its new state — and one that
  // has left the tab shuts it.
  const opened = openedId === null ? null : (requests.find((r) => r.id === openedId) ?? null);

  // Setujui and Tolak are offered on the row and at the Rincian's foot; either way the Rincian shuts and the confirm asks.
  const startApprove = (r: FoundRequest) => {
    setOpenedId(null);
    setApproving(r);
  };
  const startReject = (r: FoundRequest) => {
    setOpenedId(null);
    setReason("");
    setRejecting(r);
  };

  async function confirmApprove() {
    if (!approving) return;
    try {
      const res = await approve.mutateAsync({ teamId: teamId!, foundRequestId: approving.id });
      toaster.create({
        type: "success",
        title: t("foundRequest.approvedToast", { id: approving.id.toString(), tx: res.transactionId.toString() }),
      });
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    }
  }

  async function confirmReject() {
    if (!rejecting) return;
    const withdrawing = rejecting.block === FoundRequestApproveBlock.OWN_REPORT;
    try {
      await reject.mutateAsync({ teamId: teamId!, foundRequestId: rejecting.id, reason: reason.trim() });
      toaster.create({
        type: "success",
        title: t(withdrawing ? "foundRequest.withdrawnToast" : "foundRequest.rejectedToast", { id: rejecting.id.toString() }),
      });
    } catch (err) {
      toaster.create({ type: "error", title: rpcError(err) });
    }
  }

  return (
    // The page arrives — a fade and a short rise (motion-is-small-quick-and-shared).
    <Stack gap="section" animationStyle="enter" data-testid="found-requests-page">
      <Stack gap="1">
        <Heading size="md" data-testid="found-requests-heading">
          {t("foundRequest.title")}
        </Heading>
        <Text fontSize="sm" color="fg.muted">
          {t(decider || !reader ? "foundRequest.subtitle" : "foundRequest.staffSubtitle")}
        </Text>
      </Stack>

      {!reader ? (
        <Text color="fg.muted" data-testid="found-requests-not-for-you">
          {t("foundRequest.notForYou")}
        </Text>
      ) : (
        <Tabs.Root
          value={tab}
          onValueChange={(e) => {
            setTab(e.value as Tab);
            setPage(1);
          }}
        >
          {/* NO SCROLLBAR ON THE TAB ROW (owner: *"tabnya ada scroll, hilangkan"*, the-found-tab-row-never-scrolls) —
              `overflowX` alone turns `overflowY` to auto as well, and the underline's 1px below the row drew a vertical
              scrollbar beside the tabs. The row still slides sideways where a phone is too narrow, with no bar drawn. */}
          <Tabs.List flexWrap="nowrap" overflowX="auto" overflowY="hidden" css={{ scrollbarWidth: "none" }} data-testid="found-requests-tabs">
            {TABS.map((item) => (
              <Tabs.Trigger key={item.value} value={item.value} data-testid={`found-requests-tab-${item.value}`}>
                {t(item.labelKey)}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          <Tabs.Content value={tab}>
            <RefreshOverlay busy={list.isFetching && !list.isPending}>
              <Stack gap="section">
                {error && (
                  <Text color="error.fg" data-testid="found-requests-error">
                    {error}
                  </Text>
                )}

                {list.isPending ? (
                  // The first load shows the list's shape (motion-is-small-quick-and-shared).
                  <ListSkeleton rows={3} testId="found-requests-loading" />
                ) : requests.length === 0 && !error ? (
                  tab === "waiting" ? (
                    <EmptyHint
                      icon={Inbox}
                      title={t("foundRequest.empty.waitingTitle")}
                      description={t("foundRequest.empty.waitingLine")}
                      testId="found-requests-empty"
                    />
                  ) : (
                    <EmptyHint
                      icon={History}
                      title={t("foundRequest.empty.historyTitle")}
                      description={t("foundRequest.empty.historyLine")}
                      testId="found-requests-empty"
                    />
                  )
                ) : (
                  // ONE REQUEST A ROW, its Rincian behind a click (the-found-list-is-a-table).
                  <FoundRequestTable
                    requests={requests}
                    products={products.data}
                    teams={teams.data}
                    nameOf={nameOf}
                    showDecided={tab !== "waiting"}
                    canApprove={writable && decider}
                    canReject={writable}
                    onOpen={(r) => setOpenedId(r.id)}
                    onApprove={startApprove}
                    onReject={startReject}
                  />
                )}

                <GrowingPager
                  page={page}
                  onPageChange={setPage}
                  hasNext={list.data?.hasNext}
                  resetKey={`${tab}:${pageSize}`}
                  pageSize={pageSize}
                  pageSizeOptions={[10, 20, 50]}
                  onPageSizeChange={(n) => {
                    setPageSize(n);
                    setPage(1);
                  }}
                  testId="found-requests-pager"
                />
              </Stack>
            </RefreshOverlay>
          </Tabs.Content>
        </Tabs.Root>
      )}

      <FoundRequestDetail
        request={opened}
        product={opened ? products.data?.get(opened.productId.toString()) : undefined}
        team={opened ? teams.data?.[opened.teamId.toString()] : undefined}
        nameOf={nameOf}
        onClose={() => setOpenedId(null)}
        canApprove={writable && decider}
        canReject={writable}
        onApprove={startApprove}
        onReject={startReject}
      />

      {/* Approving posts money back and stock in at once — it confirms, saying what posts. */}
      <ConfirmDialog
        open={approving !== null}
        onOpenChange={(open) => !open && setApproving(null)}
        destructive={false}
        title={t("foundRequest.approveTitle", { id: approving?.id.toString() ?? "" })}
        message={
          approving
            ? t("foundRequest.approveMessage", {
                count: Number(approving.stockCount),
                product: approving.productName,
                rack: approving.rackCode,
                claimed: formatRupiahNumber(approving.claimedAmount),
                minted: formatRupiahNumber(approving.mintedAmount),
              })
            : ""
        }
        confirmLabel={t("foundRequest.approve")}
        dismissLabel={t("foundRequest.dismiss")}
        onConfirm={confirmApprove}
      />

      {/* Rejecting is destructive — the found is dropped — so it confirms, and says why (the reporter reads it). The
          reporter's own is a WITHDRAWAL (the-reporter-may-withdraw-their-found): the same write, said as theirs. */}
      <ConfirmDialog
        open={rejecting !== null}
        onOpenChange={(open) => !open && setRejecting(null)}
        title={t(rejectingOwn ? "foundRequest.withdrawTitle" : "foundRequest.rejectTitle", {
          id: rejecting?.id.toString() ?? "",
        })}
        message={
          rejecting
            ? rejectingOwn
              ? t("foundRequest.withdrawMessage")
              : t("foundRequest.rejectMessage", { name: nameOf(rejecting.reportedById) })
            : ""
        }
        confirmLabel={t(rejectingOwn ? "foundRequest.withdraw" : "foundRequest.reject")}
        dismissLabel={t("foundRequest.dismiss")}
        confirmDisabled={reason.trim() === ""}
        onConfirm={confirmReject}
      >
        <Field.Root required>
          <Field.Label>{t("foundRequest.rejectReason")}</Field.Label>
          <Textarea
            value={reason}
            maxLength={REASON_MAX}
            rows={3}
            placeholder={t("foundRequest.rejectReasonPlaceholder")}
            onChange={(e) => setReason(e.target.value)}
            data-testid="found-request-reject-reason"
          />
          <CharCount value={reason} max={REASON_MAX} />
        </Field.Root>
      </ConfirmDialog>
    </Stack>
  );
}
