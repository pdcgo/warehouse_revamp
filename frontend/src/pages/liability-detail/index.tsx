import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Plus, X } from "lucide-react";

import { Badge } from "../../components/ui/Badge";
import { Button, IconButton } from "../../components/ui/Button";
import { Dialog, Portal } from "../../components/ui/Dialog";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Spinner } from "../../components/ui/Spinner";
import { StatTile } from "../../components/ui/StatTile";
import { Table } from "../../components/ui/Table";
import { Tabs } from "../../components/ui/Tabs";
import { rpcError, teamClient } from "../../api/clients";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import {
  SettlementPaymentStatus,
  SettlementSourceType,
} from "../../gen/warehouse/settlement/v1/settlement_pb";
import type { SettlementPayment } from "../../gen/warehouse/settlement/v1/settlement_pb";
import { formatRupiah } from "../../lib/money";
import { useTeam } from "../../features/team/TeamContext";
import { directionCopy } from "../../features/settlement/direction";
import {
  useConfirmPayment,
  useRecordPayment,
  useSettlementEntries,
  useSettlementPayments,
} from "../../features/settlement/queries";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { CurrencyInput } from "../../components/CurrencyInput";
import { Pagination } from "../../components/Pagination";

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
function causeKey(type: SettlementSourceType): string {
  switch (type) {
    case SettlementSourceType.COD_FEE:
      return "liabilityDetail.causeCodFee";
    case SettlementSourceType.HANDLING_FEE:
      return "liabilityDetail.causeHandlingFee";
    case SettlementSourceType.PRODUCT_FEE:
      return "liabilityDetail.causeProductFee";
    case SettlementSourceType.PAYMENT:
      return "liabilityDetail.causePayment";
    default:
      // A source this build does not know renders as "unknown" rather than breaking the page.
      return "liabilityDetail.causeUnknown";
  }
}

function statusKey(status: SettlementPaymentStatus): string {
  switch (status) {
    case SettlementPaymentStatus.RECORDED:
      return "liabilityDetail.statusRecorded";
    case SettlementPaymentStatus.CONFIRMED:
      return "liabilityDetail.statusConfirmed";
    case SettlementPaymentStatus.REVERSED:
      return "liabilityDetail.statusReversed";
    default:
      return "liabilityDetail.statusUnknown";
  }
}

function statusPalette(status: SettlementPaymentStatus): "orange" | "green" | "gray" {
  switch (status) {
    case SettlementPaymentStatus.RECORDED:
      return "orange";
    case SettlementPaymentStatus.CONFIRMED:
      return "green";
    default:
      return "gray";
  }
}

// A "YYYY-MM-DD" date field into a unix-second bound in the READER'S timezone (start or end of day).
function dateToUnix(value: string, endOfDay: boolean): number | null {
  if (!value) return null;
  const ms = new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}`).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

function fmtDate(unix: bigint): string {
  if (unix === 0n) return "—";
  return new Date(Number(unix) * 1000).toLocaleDateString();
}

// LiabilityDetailPage is the running history of ONE relationship (#222/§5.1 B) — a PAGE, not a dialog
// (CLAUDE.md), reached by clicking a row on the liability list. Four tabs over one relationship: the
// ledger split by direction (receivable / payable) and the payment records split by who recorded them
// (mine — you paid them — and theirs, which only you confirm). This supersedes the old
// /settlement/:counterpartyId screen.
export function LiabilityDetailPage() {
  const { t } = useTranslation();
  const { current } = useTeam();
  const navigate = useNavigate();
  const params = useParams();

  const counterpartyId = BigInt(params.counterpartyId ?? "0");

  const [entryPage, setEntryPage] = useState(1);
  const [paymentPage, setPaymentPage] = useState(1);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [recordOpen, setRecordOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<SettlementPayment | null>(null);

  const teamId = current?.teamId;

  const entriesQuery = useSettlementEntries({
    teamId,
    counterpartyId,
    page: entryPage,
    pageSize: ENTRY_PAGE_SIZE,
  });
  // Both directions and both payer-sides come from ONE read each; the tabs are a client-side cut, and
  // the date range filters whichever tab is open — client-side over the loaded page (the RPCs have no
  // date filter).
  const paymentsQuery = useSettlementPayments({
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
    queryFn: () => teamClient.teamByIds({ ids: [counterpartyId] }),
  });
  const counterparty = teamQuery.data?.data[counterpartyId.toString()];

  const confirmPayment = useConfirmPayment();

  if (!current) {
    return (
      <div className="flex flex-col gap-section">
        <h1 className="text-[22px] font-bold">{t("liabilityDetail.title")}</h1>
        <p className="text-fg-muted">{t("liabilityDetail.selectTeamView")}</p>
      </div>
    );
  }

  const entries = entriesQuery.data?.entries ?? [];
  const balance = entriesQuery.data?.balance ?? 0n;
  const entriesTotal = entriesQuery.data?.totalItems ?? 0;

  const payments = paymentsQuery.data?.payments ?? [];
  const paymentsTotal = paymentsQuery.data?.totalItems ?? 0;

  const fromUnix = dateToUnix(fromDate, false);
  const toUnix = dateToUnix(toDate, true);

  function inRange(unix: bigint): boolean {
    const n = Number(unix);
    if (fromUnix !== null && n < fromUnix) return false;
    if (toUnix !== null && n > toUnix) return false;
    return true;
  }

  const inDate = fromDate !== "" || toDate !== "";

  // The gross tiles are the two sides of the single signed balance: a pair carries one net figure, so
  // "they owe you" and "you owe them" are the positive and negative reading of it — mirroring the
  // liability list's two columns.
  const receivable = balance > 0n ? balance : 0n;
  const payable = balance < 0n ? -balance : 0n;

  // Green when money is coming to you, orange when it is going out, grey when square — colour SUPPORTS
  // the sentence, never replaces it.
  const balanceColor = balance > 0n ? "text-pos" : balance < 0n ? "text-warn" : "text-fg-muted";

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
      return <p className="py-card text-fg-muted">{t(emptyKey)}</p>;
    }

    return (
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("liabilityDetail.colDate")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("liabilityDetail.colCause")}</Table.ColumnHeader>
            <Table.ColumnHeader className="text-right">{t("liabilityDetail.colAmount")}</Table.ColumnHeader>
            <Table.ColumnHeader className="text-right">{t("liabilityDetail.colBalance")}</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map((e) => (
            <Table.Row
              key={e.id.toString()}
              className={e.reversal ? "bg-surface-2" : undefined}
              data-testid={`liability-detail-entry-${e.id}`}
            >
              <Table.Cell className="whitespace-nowrap">{fmtDate(e.createdAtUnix)}</Table.Cell>
              <Table.Cell>
                <div className="flex items-center gap-2">
                  <span>{t(causeKey(e.sourceType), { id: e.sourceId.toString() })}</span>
                  {/* A reversal is labelled, not left to be inferred from a sign. */}
                  {e.reversal && (
                    <Badge colorPalette="orange" data-testid={`liability-detail-reversal-${e.id}`}>
                      {t("liabilityDetail.reversal")}
                    </Badge>
                  )}
                </div>
              </Table.Cell>
              {/* The one place a sign is legitimate: an entry is a MOVEMENT, and +/− means "this made
                  the balance go up / down". */}
              <Table.Cell className="whitespace-nowrap text-right">
                {e.amount > 0n ? "+" : "−"}
                {formatRupiah(e.amount < 0n ? -e.amount : e.amount)}
              </Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right text-fg-muted">
                {formatRupiah(e.balanceAfter)}
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    );
  }

  function renderPaymentTable(rows: SettlementPayment[], emptyKey: string, withConfirm: boolean) {
    if (rows.length === 0) {
      return <p className="py-card text-fg-muted">{t(emptyKey)}</p>;
    }

    return (
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("liabilityDetail.colDate")}</Table.ColumnHeader>
            <Table.ColumnHeader className="text-right">{t("liabilityDetail.colAmount")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("liabilityDetail.colNote")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("liabilityDetail.colStatus")}</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map((p) => (
            <Table.Row key={p.id.toString()} data-testid={`liability-detail-payment-${p.id}`}>
              <Table.Cell className="whitespace-nowrap">{fmtDate(p.createdAtUnix)}</Table.Cell>
              <Table.Cell className="whitespace-nowrap text-right">{formatRupiah(p.amount)}</Table.Cell>
              <Table.Cell className="text-fg-muted">{p.note || "—"}</Table.Cell>
              <Table.Cell>
                <div className="flex items-center gap-2">
                  <Badge colorPalette={statusPalette(p.status)}>{t(statusKey(p.status))}</Badge>
                  {withConfirm && p.status === SettlementPaymentStatus.RECORDED && (
                    <Button
                      size="xs"
                      colorPalette="green"
                      data-testid={`liability-detail-confirm-${p.id}`}
                      onClick={() => setConfirmTarget(p)}
                    >
                      {t("liabilityDetail.confirm")}
                    </Button>
                  )}
                </div>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    );
  }

  return (
    <div className="flex flex-col gap-section" data-testid="liability-detail-page">
      <div className="flex flex-wrap items-start gap-card">
        <IconButton
          size="xs"
          variant="ghost"
          aria-label={t("liabilityDetail.back")}
          data-testid="liability-detail-back"
          onClick={() => navigate("/liability")}
        >
          <ArrowLeft className="size-4" />
        </IconButton>
        <div className="flex flex-col">
          <h1 className="text-[22px] font-bold">{name}</h1>
          {counterparty && (
            <span className="text-sm text-fg-subtle">{t(teamKindKey(counterparty.type))}</span>
          )}
        </div>
        <div className="flex-1" />
        <Button
          colorPalette="brand"
          data-testid="liability-detail-make-payment"
          onClick={() => setRecordOpen(true)}
        >
          <Plus className="size-4" />
          {t("liabilityDetail.makePayment")}
        </Button>
      </div>

      {/* The position, in words, and the two gross sides of it. */}
      <div className="grid grid-cols-1 gap-card md:grid-cols-3">
        <StatTile
          label={t("liabilityDetail.positionLabel")}
          value={<span data-testid="liability-detail-balance">{t(copy.key, { amount: copy.amount })}</span>}
          valueClassName={balanceColor}
        />
        <StatTile
          label={t("liabilityDetail.receivableLabel")}
          value={formatRupiah(receivable)}
          valueClassName="text-pos"
          sub={t("liabilityDetail.receivableHint")}
        />
        <StatTile
          label={t("liabilityDetail.payableLabel")}
          value={formatRupiah(payable)}
          valueClassName="text-warn"
          sub={t("liabilityDetail.payableHint")}
        />
      </div>
      {/* The position row carries no oldest-unsettled timestamp — SettlementEntryList returns only the
          balance, so "oldest unsettled N days" is omitted here (it lives on the list's position row). */}

      {/* Date range — OUTSIDE the tabs: one filter over whichever tab is open. */}
      <div className="flex flex-wrap items-center gap-card">
        <span className="text-sm font-medium text-fg-muted">{t("liabilityDetail.history")}</span>
        <div className="flex-1" />
        <div className="w-40">
          <Input
            type="date"
            aria-label={t("liabilityDetail.dateFrom")}
            value={fromDate}
            data-testid="liability-detail-from"
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>
        <span className="text-fg-subtle">→</span>
        <div className="w-40">
          <Input
            type="date"
            aria-label={t("liabilityDetail.dateTo")}
            value={toDate}
            data-testid="liability-detail-to"
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={!inDate}
          data-testid="liability-detail-clear-dates"
          onClick={() => {
            setFromDate("");
            setToDate("");
          }}
        >
          {t("liabilityDetail.clearDates")}
        </Button>
      </div>

      {error && (
        <p className="text-red-600 dark:text-red-400" data-testid="liability-detail-error">
          {error}
        </p>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <Tabs.Root defaultValue="receivable">
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
          </Tabs.List>

          <Tabs.Content value="receivable">
            <div className="flex flex-col gap-card" data-testid="liability-detail-receivable">
              {renderEntryTable(receivableRows, "liabilityDetail.emptyReceivable")}
              <Pagination
                page={entryPage}
                pageSize={ENTRY_PAGE_SIZE}
                count={entriesTotal}
                onPageChange={setEntryPage}
              />
            </div>
          </Tabs.Content>

          <Tabs.Content value="payable">
            <div className="flex flex-col gap-card" data-testid="liability-detail-payable">
              {renderEntryTable(payableRows, "liabilityDetail.emptyPayable")}
              <Pagination
                page={entryPage}
                pageSize={ENTRY_PAGE_SIZE}
                count={entriesTotal}
                onPageChange={setEntryPage}
              />
            </div>
          </Tabs.Content>

          <Tabs.Content value="mine">
            <div className="flex flex-col gap-card" data-testid="liability-detail-mine">
              {renderPaymentTable(minePayments, "liabilityDetail.emptyMine", false)}
              <Pagination
                page={paymentPage}
                pageSize={PAYMENT_PAGE_SIZE}
                count={paymentsTotal}
                onPageChange={setPaymentPage}
              />
            </div>
          </Tabs.Content>

          <Tabs.Content value="team">
            <div className="flex flex-col gap-card" data-testid="liability-detail-team">
              {renderPaymentTable(teamPayments, "liabilityDetail.emptyTeam", true)}
              <Pagination
                page={paymentPage}
                pageSize={PAYMENT_PAGE_SIZE}
                count={paymentsTotal}
                onPageChange={setPaymentPage}
              />
            </div>
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

      <MakePaymentDialog
        open={recordOpen}
        onOpenChange={setRecordOpen}
        payerTeamId={current.teamId}
        creditorTeamId={counterpartyId}
        counterpartyName={name}
      />
    </div>
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
  const busy = record.isPending;

  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  // The contract requires amount > 0, so this mirrors the server rather than inventing a second idea
  // of "ready to send".
  const ready = amount !== "" && Number(amount) > 0;

  function change(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setAmount("");
      setNote("");
      setError("");
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setError("");

    record.mutate(
      { teamId: payerTeamId, creditorTeamId, amount: BigInt(amount), note },
      {
        onSuccess: () => change(false),
        onError: (err) => setError(rpcError(err)),
      },
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => change(e.open)}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <form onSubmit={submit}>
              <Dialog.Header>
                <Dialog.Title>{t("liabilityDetail.recordTitle")}</Dialog.Title>
              </Dialog.Header>

              <Dialog.Body>
                <div className="flex flex-col gap-field">
                  <p className="text-sm text-fg-muted">
                    {t("liabilityDetail.recordDescription", { name: counterpartyName })}
                  </p>

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
                      <span className="font-normal text-fg-subtle">
                        {t("liabilityDetail.recordNoteOptional")}
                      </span>
                    </Field.Label>
                    <Field.Textarea
                      value={note}
                      disabled={busy}
                      data-testid="record-note"
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <Field.HelperText>{t("liabilityDetail.recordNoteHelp")}</Field.HelperText>
                  </Field.Root>

                  {error && (
                    <p className="text-sm text-red-600 dark:text-red-400" data-testid="record-error">
                      {error}
                    </p>
                  )}
                </div>
              </Dialog.Body>

              <Dialog.Footer>
                <Dialog.CloseTrigger asChild>
                  <Button type="button" variant="outline" colorPalette="gray" disabled={busy}>
                    {t("common.cancel")}
                  </Button>
                </Dialog.CloseTrigger>
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
              <IconButton type="button" size="sm" aria-label={t("common.cancel")} className="absolute right-3 top-3">
                <X className="size-4" />
              </IconButton>
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
