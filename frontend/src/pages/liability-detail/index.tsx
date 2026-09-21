import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Input,
  CloseButton,
  Dialog,
  Field,
  Flex,
  Heading,
  Icon,
  IconButton,
  Portal,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Stat,
  Table,
  Tabs,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { ArrowLeft, Paperclip, Plus, X } from "lucide-react";

import { rpcError, teamClient } from "../../api/clients";
import { ChangeLogPanel } from "../../features/liability/ChangeLogPanel";
import { TermsPanel } from "./components/TermsPanel";
import { PaymentProof } from "./components/PaymentProof";
import { RejectPaymentDialog } from "./components/RejectPaymentDialog";
import { useProofUpload, type UploadedProof } from "../../features/documents/useProofUpload";
import { teamByIdsRowData, teamsByIds } from "../../features/teams/adapt";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import {
  LiabilityPaymentStatus,
  LiabilitySourceType,
} from "../../gen/warehouse/liability/v1/liability_pb";
import type { LiabilityPayment } from "../../gen/warehouse/liability/v1/liability_pb";
import { formatRupiah } from "../../lib/money";
import {
  ALL_DATES,
  DateRangePicker,
  resolveRange,
  type DateRange,
} from "../../components/datetime/DateRangePicker";
import { useTeam } from "../../features/team/TeamContext";
import { directionCopy, directionPalette } from "../../features/liability/direction";
import {
  useConfirmPayment,
  useRecordPayment,
  useLiabilityLogs,
  useLiabilityPayments,
} from "../../features/liability/queries";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { CurrencyInput } from "../../components/inputs/CurrencyInput";
import { Pagination } from "../../components/chrome/Pagination";

const ENTRY_PAGE_SIZE = 50;
const PAYMENT_PAGE_SIZE = 50;

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

// WHAT CAUSED an entry, in words, from the typed `(source_type, source_id)` pair — never free text. A
// line reads "Product fee · order #412", so "why do I owe this?" is answerable, filterable and
// countable.
function causeKey(type: LiabilitySourceType): string {
  switch (type) {
    case LiabilitySourceType.ORDER_FEE:
      return "liabilityDetail.causeOrderFee";
    case LiabilitySourceType.INCIDENTAL_FEE:
      return "liabilityDetail.causeIncidentalFee";
    case LiabilitySourceType.PRODUCT_FEE:
      return "liabilityDetail.causeProductFee";
    case LiabilitySourceType.PAYMENT:
      return "liabilityDetail.causePayment";
    // ⚠ CAUSES 4 AND 5 USED TO SHARE ONE LABEL, because they shared one source type. They no longer
    // do: broken and lost are different questions to answer, and a find is a giving-back movement
    // rather than a third kind of loss. The REVERSAL badge still marks the find — the type carries
    // the cause and the flag carries the direction.
    case LiabilitySourceType.BROKEN_GOOD:
      return "liabilityDetail.causeBrokenGood";
    case LiabilitySourceType.LOST_GOOD:
      return "liabilityDetail.causeLostGood";
    case LiabilitySourceType.FOUND:
      return "liabilityDetail.causeFound";
    default:
      // A source this build does not know renders as "unknown" rather than breaking the page.
      return "liabilityDetail.causeUnknown";
  }
}

function statusKey(status: LiabilityPaymentStatus): string {
  switch (status) {
    case LiabilityPaymentStatus.RECORDED:
      return "liabilityDetail.statusRecorded";
    case LiabilityPaymentStatus.CONFIRMED:
      return "liabilityDetail.statusConfirmed";
    case LiabilityPaymentStatus.REVERSED:
      return "liabilityDetail.statusReversed";
    case LiabilityPaymentStatus.REJECTED:
      return "liabilityDetail.statusRejected";
    default:
      return "liabilityDetail.statusUnknown";
  }
}

function statusPalette(status: LiabilityPaymentStatus): string {
  switch (status) {
    case LiabilityPaymentStatus.RECORDED:
      return "orange";
    case LiabilityPaymentStatus.CONFIRMED:
      return "green";
    // ⚠ RED, and REVERSED stays grey. A refusal is an outcome the payer has to act on — re-send the
    // slip, or the money — while a reversal is a correction already made. Giving them one colour
    // would flatten "you must do something" into "something happened".
    case LiabilityPaymentStatus.REJECTED:
      return "red";
    default:
      return "gray";
  }
}

function fmtDate(unix: bigint): string {
  if (unix === 0n) return "—";
  return new Date(Number(unix) * 1000).toLocaleDateString();
}

// LiabilityDetailPage is the running history of ONE relationship (#222/§5.1 B) — a PAGE, not a dialog
// (CLAUDE.md), reached by clicking a row on the liability list. Four tabs over one relationship: the
// ledger split by direction (receivable / payable) and the payment records split by who recorded them
// (mine — you paid them — and theirs, which only you confirm). This supersedes the old
// /liability/:counterpartyId screen.
export function LiabilityDetailPage() {
  const { t } = useTranslation();
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
  const [dateRange, setDateRange] = useState<DateRange>(ALL_DATES);

  const [recordOpen, setRecordOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<LiabilityPayment | null>(null);
  // ⚠ A SEPARATE TARGET from confirm, not a mode flag on one. The two acts are different failures —
  // reject refuses a claim and posts nothing, confirm posts money — and one piece of state holding
  // both is how a mis-click becomes a settlement.
  const [rejectTarget, setRejectTarget] = useState<LiabilityPayment | null>(null);

  const teamId = current?.teamId;

  const entriesQuery = useLiabilityLogs({
    teamId,
    counterpartyId,
    page: entryPage,
    pageSize: ENTRY_PAGE_SIZE,
  });
  // Both directions and both payer-sides come from ONE read each; the tabs are a client-side cut, and
  // the date range filters whichever tab is open — client-side over the loaded page (the RPCs have no
  // date filter).
  const paymentsQuery = useLiabilityPayments({
    teamId,
    counterpartyId,
    awaitingMyConfirmation: false,
    page: paymentPage,
    pageSize: PAYMENT_PAGE_SIZE,
  });

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

  const confirmPayment = useConfirmPayment();

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("liabilityDetail.title")}</Heading>
        <Text color="fg.muted">{t("liabilityDetail.selectTeamView")}</Text>
      </Stack>
    );
  }

  const entries = entriesQuery.data?.entries ?? [];
  const balance = entriesQuery.data?.balance ?? 0n;
  const entriesTotal = entriesQuery.data?.totalItems ?? 0;

  const payments = paymentsQuery.data?.payments ?? [];
  const paymentsTotal = paymentsQuery.data?.totalItems ?? 0;

  // resolveRange yields unix SECONDS with 0 = open end; the client filter below wants number|null, so
  // an open bound (0) maps to null (no constraint).
  const { fromUnix: fromBound, toUnix: toBound } = resolveRange(dateRange);
  const fromUnix = fromBound === 0n ? null : Number(fromBound);
  const toUnix = toBound === 0n ? null : Number(toBound);

  function inRange(unix: bigint): boolean {
    const n = Number(unix);
    if (fromUnix !== null && n < fromUnix) return false;
    if (toUnix !== null && n > toUnix) return false;
    return true;
  }

  // The gross tiles are the two sides of the single signed balance: a pair carries one net figure, so
  // "they owe you" and "you owe them" are the positive and negative reading of it — mirroring the
  // liability list's two columns.
  const receivable = balance > 0n ? balance : 0n;
  const payable = balance < 0n ? -balance : 0n;

  const name = counterparty?.name ?? t("liabilityDetail.teamFallback", { id: counterpartyId.toString() });

  const receivableRows = entries.filter((e) => e.amount > 0n && inRange(e.createdAtUnix));
  const payableRows = entries.filter((e) => e.amount < 0n && inRange(e.createdAtUnix));
  // My payments = ones you recorded (you are the payer). Team payments = ones they recorded (they are
  // the payer) — those are the ones only you, the creditor, can confirm.
  const minePayments = payments.filter((p) => p.payerTeamId === current.teamId && inRange(p.createdAtUnix));
  const teamPayments = payments.filter((p) => p.payerTeamId === counterpartyId && inRange(p.createdAtUnix));

  const copy = directionCopy(balance);
  const loading = entriesQuery.isPending || paymentsQuery.isPending;
  const error = entriesQuery.isError
    ? rpcError(entriesQuery.error)
    : paymentsQuery.isError
      ? rpcError(paymentsQuery.error)
      : "";

  function renderEntryTable(rows: typeof entries, emptyKey: string) {
    if (rows.length === 0) {
      return (
        <Text color="fg.muted" py="card">
          {t(emptyKey)}
        </Text>
      );
    }

    return (
      <Table.Root size="sm">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("liabilityDetail.colDate")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("liabilityDetail.colCause")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("liabilityDetail.colAmount")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("liabilityDetail.colBalance")}</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map((e) => (
            <Table.Row
              key={e.id.toString()}
              bg={e.reversal ? "bg.muted" : undefined}
              data-testid={`liability-detail-entry-${e.id}`}
            >
              <Table.Cell whiteSpace="nowrap">{fmtDate(e.createdAtUnix)}</Table.Cell>
              <Table.Cell>
                <Flex align="center" gap="2">
                  <Text>{t(causeKey(e.sourceType), { id: e.sourceId.toString() })}</Text>
                  {/* A reversal is labelled, not left to be inferred from a sign. */}
                  {e.reversal && (
                    <Badge colorPalette="orange" data-testid={`liability-detail-reversal-${e.id}`}>
                      {t("liabilityDetail.reversal")}
                    </Badge>
                  )}
                </Flex>
              </Table.Cell>
              {/* The one place a sign is legitimate: an entry is a MOVEMENT, and +/− means "this made
                  the balance go up / down". */}
              <Table.Cell textAlign="end" whiteSpace="nowrap">
                {e.amount > 0n ? "+" : "−"}
                {formatRupiah(e.amount < 0n ? -e.amount : e.amount)}
              </Table.Cell>
              <Table.Cell textAlign="end" color="fg.muted" whiteSpace="nowrap">
                {formatRupiah(e.balanceAfter)}
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    );
  }

  // ⚠ NARROWED ONCE, HERE. `current` is guarded above, but TypeScript drops that narrowing inside a
  // closure, and the proof links need a concrete reader team — a `?? 0n` fallback would send a
  // GetDownloadUrl for team 0 rather than fail loudly.
  const readerTeamId = current.teamId;

  function renderPaymentTable(rows: LiabilityPayment[], emptyKey: string, withConfirm: boolean) {
    if (rows.length === 0) {
      return (
        <Text color="fg.muted" py="card">
          {t(emptyKey)}
        </Text>
      );
    }

    return (
      <Table.Root size="sm">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("liabilityDetail.colDate")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("liabilityDetail.colAmount")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("liabilityDetail.colNote")}</Table.ColumnHeader>
            {/* §Payment Flow's middle step — *"Team B check manually"* — needs something to look at. */}
            <Table.ColumnHeader>{t("liabilityDetail.colProof")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("liabilityDetail.colStatus")}</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map((p) => (
            <Table.Row key={p.id.toString()} data-testid={`liability-detail-payment-${p.id}`}>
              <Table.Cell whiteSpace="nowrap">{fmtDate(p.createdAtUnix)}</Table.Cell>
              <Table.Cell textAlign="end" whiteSpace="nowrap">
                {formatRupiah(p.amount)}
              </Table.Cell>
              <Table.Cell color="fg.muted">
                <Stack gap="0">
                  <Text>{p.note || "—"}</Text>
                  {/* ⚠ THE REASON IS SHOWN ON BOTH SIDES, and to the payer above all: a refusal they
                      cannot read is a debt they cannot fix. */}
                  {p.reason !== "" && (
                    <Text fontSize="xs" color="red.fg" data-testid={`liability-detail-reason-${p.id}`}>
                      {p.reason}
                    </Text>
                  )}
                </Stack>
              </Table.Cell>
              <Table.Cell>
                <PaymentProof teamId={readerTeamId} documentIds={p.documentIds} />
              </Table.Cell>
              <Table.Cell>
                <Flex align="center" gap="2">
                  <Badge colorPalette={statusPalette(p.status)}>{t(statusKey(p.status))}</Badge>
                  {/* TWO actions, so they stay inline — an overflow menu is for three or more. */}
                  {withConfirm && p.status === LiabilityPaymentStatus.RECORDED && (
                    <>
                      <Button
                        size="xs"
                        colorPalette="green"
                        data-testid={`liability-detail-confirm-${p.id}`}
                        onClick={() => setConfirmTarget(p)}
                      >
                        {t("liabilityDetail.confirm")}
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        colorPalette="red"
                        data-testid={`liability-detail-reject-${p.id}`}
                        onClick={() => setRejectTarget(p)}
                      >
                        {t("liabilityDetail.reject")}
                      </Button>
                    </>
                  )}
                </Flex>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    );
  }

  return (
    <Stack gap="section" data-testid="liability-detail-page">
      <Flex align="flex-start" gap="card" wrap="wrap">
        <IconButton
          size="xs"
          variant="ghost"
          aria-label={t("liabilityDetail.back")}
          data-testid="liability-detail-back"
          onClick={() => navigate("/liability")}
        >
          <Icon as={ArrowLeft} boxSize="4" />
        </IconButton>
        <Stack gap="0">
          <Heading size="md">{name}</Heading>
          {counterparty && (
            <Text color="fg.subtle" fontSize="sm">
              {t(teamKindKey(counterparty.type))}
            </Text>
          )}
        </Stack>
        <Spacer />
        <Button
          colorPalette="brand"
          data-testid="liability-detail-make-payment"
          onClick={() => setRecordOpen(true)}
        >
          <Icon as={Plus} boxSize="4" />
          {t("liabilityDetail.makePayment")}
        </Button>
      </Flex>

      {/* The position, in words, and the two gross sides of it. */}
      <SimpleGrid columns={{ base: 1, md: 3 }} gap="card">
        <Stat.Root>
          <Stat.Label>{t("liabilityDetail.positionLabel")}</Stat.Label>
          <Stat.ValueText color={`${directionPalette(balance)}.fg`} data-testid="liability-detail-balance">
            {t(copy.key, { amount: copy.amount })}
          </Stat.ValueText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label>{t("liabilityDetail.receivableLabel")}</Stat.Label>
          <Stat.ValueText color="green.fg">{formatRupiah(receivable)}</Stat.ValueText>
          <Stat.HelpText>{t("liabilityDetail.receivableHint")}</Stat.HelpText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label>{t("liabilityDetail.payableLabel")}</Stat.Label>
          <Stat.ValueText color="orange.fg">{formatRupiah(payable)}</Stat.ValueText>
          <Stat.HelpText>{t("liabilityDetail.payableHint")}</Stat.HelpText>
        </Stat.Root>
      </SimpleGrid>
      {/* The position row carries no oldest-unsettled timestamp — LiabilityLogList returns only the
          balance, so "oldest unsettled N days" is omitted here (it lives on the list's position row). */}

      {/* Date range — OUTSIDE the tabs: one filter over whichever tab is open. */}
      <Flex align="center" gap="card" wrap="wrap">
        <Text fontSize="sm" fontWeight="medium" color="fg.muted">
          {t("liabilityDetail.history")}
        </Text>
        <Spacer />
        <DateRangePicker value={dateRange} onChange={setDateRange} testId="liability-detail-range" />
      </Flex>

      {error && (
        <Text color="red.fg" data-testid="liability-detail-error">
          {error}
        </Text>
      )}

      {loading ? (
        <Spinner colorPalette="brand" />
      ) : (
        <Tabs.Root defaultValue="receivable" variant="line">
          <Tabs.List>
            <Tabs.Trigger value="receivable" data-testid="liability-detail-tab-receivable">
              {t("liabilityDetail.tabReceivable")}
            </Tabs.Trigger>
            <Tabs.Trigger value="payable" data-testid="liability-detail-tab-payable">
              {t("liabilityDetail.tabPayable")}
            </Tabs.Trigger>
            <Tabs.Trigger value="mine" data-testid="liability-detail-tab-mine">
              {t("liabilityDetail.tabMine")}
            </Tabs.Trigger>
            <Tabs.Trigger value="team" data-testid="liability-detail-tab-team">
              {t("liabilityDetail.tabTeam")}
            </Tabs.Trigger>
            {/* THE CREDIT LIMIT LOG — `team_balance_design.md` §Detail Pair Team Balance 2.
                ⚠ It is a DIFFERENT log from the four tabs beside it. Those are money that MOVED;
                this is a RULE that changed. Both belong on this page because a person asking "why
                is this team blocked" needs the limit's history and the balance's history together —
                but they must never be merged into one list, because they have different grains and
                only one of them is a ledger. */}
            <Tabs.Trigger value="limits" data-testid="liability-detail-tab-limits">
              {t("liabilityDetail.tabLimits")}
            </Tabs.Trigger>
            {/* WHERE THE LIMIT IS SET — terms-live-on-the-pair-detail.
                ⚠ It was a screen of its own at `/liability/terms`, listing every counterparty in one
                table. Terms belong beside the pair they govern, so the list is gone and each pair
                carries its own. The tab beside this one is the same limit's HISTORY: one writes the
                rule, the other shows how it changed. */}
            <Tabs.Trigger value="terms" data-testid="liability-detail-tab-terms">
              {t("liabilityDetail.tabTerms")}
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="receivable">
            <Stack gap="card" data-testid="liability-detail-receivable">
              {renderEntryTable(receivableRows, "liabilityDetail.emptyReceivable")}
              <Pagination
                page={entryPage}
                pageSize={ENTRY_PAGE_SIZE}
                count={entriesTotal}
                onPageChange={setEntryPage}
              />
            </Stack>
          </Tabs.Content>

          <Tabs.Content value="payable">
            <Stack gap="card" data-testid="liability-detail-payable">
              {renderEntryTable(payableRows, "liabilityDetail.emptyPayable")}
              <Pagination
                page={entryPage}
                pageSize={ENTRY_PAGE_SIZE}
                count={entriesTotal}
                onPageChange={setEntryPage}
              />
            </Stack>
          </Tabs.Content>

          <Tabs.Content value="mine">
            <Stack gap="card" data-testid="liability-detail-mine">
              {renderPaymentTable(minePayments, "liabilityDetail.emptyMine", false)}
              <Pagination
                page={paymentPage}
                pageSize={PAYMENT_PAGE_SIZE}
                count={paymentsTotal}
                onPageChange={setPaymentPage}
              />
            </Stack>
          </Tabs.Content>

          <Tabs.Content value="team">
            <Stack gap="card" data-testid="liability-detail-team">
              {renderPaymentTable(teamPayments, "liabilityDetail.emptyTeam", true)}
              <Pagination
                page={paymentPage}
                pageSize={PAYMENT_PAGE_SIZE}
                count={paymentsTotal}
                onPageChange={setPaymentPage}
              />
            </Stack>
          </Tabs.Content>

          <Tabs.Content value="terms">
            <TermsPanel
              teamId={current.teamId}
              counterpartyId={counterpartyId}
              counterpartyName={name}
              role={current.role}
              // The page holds a SIGNED balance from this team's side; a meter wants a magnitude, and
              // a counterparty in credit owes nothing rather than a negative amount.
              debt={balance > 0n ? balance : 0n}
            />
          </Tabs.Content>

          <Tabs.Content value="limits">
            {/* The panel is a DOMAIN component (features/liability), not this page's: the Credit
                Terms screen renders the same log across every counterparty, and the moment a second
                page imported it, it stopped being one page's component. */}
            <ChangeLogPanel
              teamId={current.teamId}
              counterpartyId={counterpartyId}
              nameOf={() => name}
              page={limitPage}
              onPageChange={setLimitPage}
            />
          </Tabs.Content>
        </Tabs.Root>
      )}

      {/* CONFIRM PAYMENT — it posts to the ledger and is not trivially reversible, so a ConfirmDialog
          (not destructive: confirming is the intended forward action). */}
      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmTarget(null);
        }}
        title={t("liabilityDetail.confirmTitle")}
        message={t("liabilityDetail.confirmMessage", {
          amount: confirmTarget ? formatRupiah(confirmTarget.amount) : "",
        })}
        confirmLabel={t("liabilityDetail.confirmLabel")}
        destructive={false}
        onConfirm={async () => {
          if (!confirmTarget) return;
          await confirmPayment.mutateAsync({ teamId: current.teamId, paymentId: confirmTarget.id });
          setConfirmTarget(null);
        }}
      />

      <RejectPaymentDialog
        target={rejectTarget}
        onClose={() => setRejectTarget(null)}
        teamId={current.teamId}
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

interface MakePaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payerTeamId: bigint;
  creditorTeamId: bigint;
  counterpartyName: string;
}

// MAKE A PAYMENT — a focused form dialog for a payment YOU are sending. It has NO ledger effect until
// the creditor confirms it arrived (two-phase, #188).
function MakePaymentDialog({
  open,
  onOpenChange,
  payerTeamId,
  creditorTeamId,
  counterpartyName,
}: MakePaymentDialogProps) {
  const { t } = useTranslation();
  const record = useRecordPayment();

  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [proofs, setProofs] = useState<UploadedProof[]>([]);

  const proof = useProofUpload({ teamId: payerTeamId, shareWithTeamId: creditorTeamId });
  const busy = record.isPending || proof.uploading;

  // ⚠ PROOF IS PART OF "READY", not a nicety. The contract requires amount > 0 AND at least one
  // document (a-payment-must-carry-proof) — this mirrors the server rather than inventing a second
  // idea of ready, so the button is disabled instead of the send being refused after the fact.
  const ready = amount !== "" && Number(amount) > 0 && proofs.length > 0;

  function change(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setAmount("");
      setNote("");
      setError("");
      // ⚠ THE UPLOADED FILES ARE NOT DELETED, only forgotten. They are already shared with the
      // creditor and a share cannot be withdrawn; a cancelled dialog leaves an orphan document, which
      // is the cheap side of that trade.
      setProofs([]);
      proof.setError("");
    }
  }

  async function pick(file: File | undefined) {
    if (!file) return;

    const uploaded = await proof.upload(file);
    if (uploaded) {
      setProofs((prev) => [...prev, uploaded]);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setError("");

    record.mutate(
      {
        teamId: payerTeamId,
        creditorTeamId,
        amount: BigInt(amount),
        note,
        documentIds: proofs.map((p) => p.id),
      },
      {
        onSuccess: () => change(false),
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => change(e.open)} placement="center">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{t("liabilityDetail.recordTitle")}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <Stack gap="field">
                  <Text color="fg.muted" fontSize="sm">
                    {t("liabilityDetail.recordDescription", { name: counterpartyName })}
                  </Text>

                  <Field.Root required>
                    <Field.Label>{t("liabilityDetail.recordAmount")}</Field.Label>
                    <CurrencyInput
                      value={amount}
                      onChange={setAmount}
                      disabled={busy}
                      placeholder="0"
                      data-testid="record-amount"
                    />
                  </Field.Root>

                  <Field.Root>
                    <Field.Label>
                      {t("liabilityDetail.recordNote")}{" "}
                      <Text as="span" color="fg.subtle" fontWeight="normal">
                        {t("liabilityDetail.recordNoteOptional")}
                      </Text>
                    </Field.Label>
                    <Textarea
                      value={note}
                      disabled={busy}
                      data-testid="record-note"
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <Field.HelperText>{t("liabilityDetail.recordNoteHelp")}</Field.HelperText>
                  </Field.Root>

                  {/* PROOF OF THE TRANSFER — required (a-payment-must-carry-proof).
                      `balance_context.md` §Payment Flow has the payer BRING it and the creditor CHECK
                      IT MANUALLY, so a payment with nothing attached asks them to accept on your
                      word. Uploading also SHARES the file with them: without that they would get
                      NotFound on the one thing they have to look at. */}
                  <Field.Root required>
                    <Field.Label>{t("liabilityDetail.recordProof")}</Field.Label>

                    <Input
                      type="file"
                      accept="image/*,application/pdf"
                      disabled={busy}
                      data-testid="record-proof-input"
                      onChange={(e: ChangeEvent<HTMLInputElement>) => {
                        void pick(e.target.files?.[0]);
                        // Cleared so picking the SAME file twice still fires a change event.
                        e.target.value = "";
                      }}
                    />

                    <Field.HelperText>{t("liabilityDetail.recordProofHelp")}</Field.HelperText>

                    {proofs.length > 0 && (
                      <Stack gap="0.5" pt="1" data-testid="record-proof-list">
                        {proofs.map((p) => (
                          <Flex key={p.id} align="center" gap="field">
                            <Icon as={Paperclip} boxSize="4" color="fg.muted" />
                            <Text fontSize="sm">{p.filename}</Text>
                            <IconButton
                              size="xs"
                              variant="ghost"
                              aria-label={t("liabilityDetail.recordProofRemove")}
                              disabled={busy}
                              data-testid={`record-proof-remove-${p.id}`}
                              onClick={() => setProofs((prev) => prev.filter((x) => x.id !== p.id))}
                            >
                              <Icon as={X} boxSize="4" />
                            </IconButton>
                          </Flex>
                        ))}
                      </Stack>
                    )}

                    {proof.error && (
                      <Field.ErrorText data-testid="record-proof-error">{proof.error}</Field.ErrorText>
                    )}
                  </Field.Root>

                  {error && (
                    <Dialog.Description color="red.fg" data-testid="record-error">
                      {error}
                    </Dialog.Description>
                  )}
                </Stack>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" disabled={busy}>
                    {t("common.cancel")}
                  </Button>
                </Dialog.ActionTrigger>
                <Button
                  type="submit"
                  colorPalette="brand"
                  loading={busy}
                  disabled={!ready}
                  data-testid="record-submit"
                >
                  {t("liabilityDetail.recordSubmit")}
                </Button>
              </Dialog.Footer>
            </form>

            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
