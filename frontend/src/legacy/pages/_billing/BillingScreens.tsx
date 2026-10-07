import { useMemo, useState } from "react";
import { Heading, HStack, Separator, Stack, Text } from "@chakra-ui/react";
import { Download, Plus } from "lucide-react";
import { DateCell } from "../../components/cells/DateCell";
import { StatisticCell } from "../../components/cells/StatisticCell";
import { TeamCell } from "../../components/cells/TeamCell";
import { Card } from "../../components/display/Card";
import { DataTable, type TableColumn } from "../../components/display/DataTable";
import { LimitProgress } from "../../components/display/LimitProgress";
import { Summary } from "../../components/display/Summary";
import { Button } from "../../components/inputs/Button";
import { SearchInput } from "../../components/inputs/SearchInput";
import { Field } from "../../components/inputs/Field";
import { TextInput } from "../../components/inputs/TextInput";
import { DateText } from "../../components/text/DateText";
import { PriceText } from "../../components/text/PriceText";
import { Pagination } from "../../../components/chrome/Pagination";
import { formatRupiahCompact } from "../../../lib/money";
import { TeamType } from "../../../gen/warehouse/team/v1/team_pb";
import type {
  InvoiceDirection,
  LedgerEntryRow,
  PaymentRow,
  TeamBalanceRow,
} from "../../financeFixtures";

// ── THE FOUR BILLING SCREENS, EACH DEFINED ONCE ─────────────────────────────────────────────────
//
// Billing has the same payable/receivable split as invoicing, and the same four views on each side:
//
//   log       — every movement, newest first. The raw record; read when a figure is disputed.
//   payment   — money in or out, as its own list. Read when reconciling a bank statement.
//   team      — the balance per counterparty. Read to decide who to chase.
//   timeline  — one counterparty's movements in order. Read to answer "how did we get to this
//               number", which none of the other three can answer.
//
// The direction changes the wording and the sign convention, not the screen — so each is written
// here once and instantiated twice.

const teamProps = (row: TeamBalanceRow) => ({
  id: row.id,
  name: row.name,
  type: row.kind === "warehouse" ? TeamType.WAREHOUSE : TeamType.SELLING,
});

// ── LOG ─────────────────────────────────────────────────────────────────────────────────────────

export const logDescription =
  "Every billing movement, newest first — the raw record, read when a figure is disputed. Debit and credit stay as SEPARATE columns rather than one signed number, because that is how the entry was written.";

export interface BillingLogScreenProps {
  direction: InvoiceDirection;
  entries: LedgerEntryRow[];
  loading?: boolean;
}

export function BillingLogScreen({ direction, entries, loading }: BillingLogScreenProps) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) => e.memo.toLowerCase().includes(q) || e.account.toLowerCase().includes(q),
    );
  }, [entries, search]);

  const columns: Array<TableColumn<LedgerEntryRow>> = [
    { name: "When", render: (e) => <DateCell value={e.at} grain="datetime" /> },
    {
      name: "Account",
      render: (e) => (
        <Stack gap="0" lineHeight="short">
          <Text fontSize="sm">{e.account}</Text>
          <Text fontSize="xs" color="fg.muted">
            {e.accountCode}
          </Text>
        </Stack>
      ),
    },
    { name: "Memo", key: "memo" },
    // ⚠ TWO COLUMNS, not one signed number. A ledger entry IS a debit or a credit — collapsing them
    // loses which side it was written on, and that is the thing being checked when a figure is
    // disputed.
    {
      name: "Debit",
      align: "end",
      render: (e) => (e.debit > 0n ? <StatisticCell value={e.debit} kind="price" compact /> : null),
    },
    {
      name: "Credit",
      align: "end",
      render: (e) => (e.credit > 0n ? <StatisticCell value={e.credit} kind="price" compact /> : null),
    },
  ];

  return (
    <Stack gap="section" data-testid="billing-log-screen" data-direction={direction}>
      <HStack justify="space-between" wrap="wrap" gap="card">
        <Heading size="md">{direction === "payable" ? "Payable" : "Receivable"} log</Heading>
        <Button tone="plain" variant="outline" icon={Download}>
          Export
        </Button>
      </HStack>

      <SearchInput
        value={search}
        onChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder="Memo or account"
        maxW="72"
      />

      <DataTable
        columns={columns}
        items={rows.slice((page - 1) * 20, page * 20)}
        loading={loading}
        emptyTitle="No movements"
        emptyContent="Billing movements appear here as they are posted."
        aria-label="Billing log"
      />

      <Pagination count={rows.length} page={page} pageSize={20} onPageChange={setPage} showRange />
    </Stack>
  );
}

// ── PAYMENT ─────────────────────────────────────────────────────────────────────────────────────

export const paymentDescription =
  "Money in or out as its own list, for reconciling against a bank statement. Unconfirmed claims are listed too, and separated — a statement match is what turns a claim into a payment.";

export interface BillingPaymentScreenProps {
  direction: InvoiceDirection;
  payments: PaymentRow[];
  loading?: boolean;
}

export function BillingPaymentScreen({ direction, payments, loading }: BillingPaymentScreenProps) {
  const confirmed = payments.filter((p) => p.confirmed);
  const pending = payments.filter((p) => !p.confirmed);

  const columns: Array<TableColumn<PaymentRow>> = [
    { name: "When", render: (p) => <DateCell value={p.at} grain="date" /> },
    { name: "Invoice", key: "invoiceCode" },
    { name: "Method", key: "method" },
    { name: "Reference", key: "reference" },
    {
      name: "Amount",
      align: "end",
      render: (p) => <StatisticCell value={p.amount} kind="price" compact />,
    },
  ];

  return (
    <Stack gap="section" data-testid="billing-payment-screen" data-direction={direction}>
      <Heading size="md">{direction === "payable" ? "Payments made" : "Payments received"}</Heading>

      <Summary
        items={[
          {
            label: "Confirmed",
            value: formatRupiahCompact(confirmed.reduce((s, p) => s + p.amount, 0n)),
            tone: "success",
          },
          {
            label: "Awaiting confirmation",
            value: formatRupiahCompact(pending.reduce((s, p) => s + p.amount, 0n)),
            tone: "warning",
          },
        ]}
        loading={loading}
        columns={2}
      />

      <Stack gap="2">
        <Text fontWeight="medium">Confirmed</Text>
        <DataTable
          columns={columns}
          items={confirmed}
          size="sm"
          loading={loading}
          emptyTitle="No confirmed payments"
          aria-label="Confirmed payments"
        />
      </Stack>

      {/* Separated, not mixed. A statement match is what turns a claim into a payment, and listing
          the two together would let an unmatched claim be reconciled by mistake. */}
      <Stack gap="2" data-testid="billing-payment-pending">
        <Text fontWeight="medium">Awaiting confirmation</Text>
        <DataTable
          columns={columns}
          items={pending}
          size="sm"
          loading={loading}
          emptyTitle="Nothing waiting"
          aria-label="Unconfirmed payments"
        />
      </Stack>
    </Stack>
  );
}

// ── TEAM ────────────────────────────────────────────────────────────────────────────────────────

export const teamDescription =
  "The balance per counterparty — read to decide who to chase. Sorted by amount, because the largest debt is the one worth a phone call.";

export interface BillingTeamScreenProps {
  direction: InvoiceDirection;
  teams: TeamBalanceRow[];
  loading?: boolean;
}

export function BillingTeamScreen({ direction, teams, loading }: BillingTeamScreenProps) {
  const amountOf = (t: TeamBalanceRow) => (direction === "payable" ? t.owing : t.owed);

  // Largest first: the biggest outstanding balance is the one worth acting on, and alphabetical
  // order buries it among teams that owe nothing.
  const rows = [...teams].sort((a, b) => Number(amountOf(b) - amountOf(a)));

  const columns: Array<TableColumn<TeamBalanceRow>> = [
    { name: "Team", sticky: "left", render: (row) => <TeamCell team={teamProps(row)} /> },
    {
      name: direction === "payable" ? "We owe" : "Owed to us",
      align: "end",
      render: (row) => <StatisticCell value={amountOf(row)} kind="price" compact />,
    },
    ...(direction === "payable"
      ? [
          {
            name: "Limit",
            width: "30%",
            render: (row: TeamBalanceRow) => (
              <LimitProgress unpaid={row.owing} threshold={row.limit} />
            ),
          } as TableColumn<TeamBalanceRow>,
        ]
      : []),
  ];

  return (
    <Stack gap="section" data-testid="billing-team-screen" data-direction={direction}>
      <Heading size="md">{direction === "payable" ? "Who we owe" : "Who owes us"}</Heading>

      <Summary
        items={[
          {
            label: "Total",
            value: formatRupiahCompact(rows.reduce((s, t) => s + amountOf(t), 0n)),
            tone: direction === "payable" ? "warning" : "success",
          },
          { label: "Counterparties", value: rows.filter((t) => amountOf(t) > 0n).length },
        ]}
        loading={loading}
        columns={2}
      />

      <DataTable
        columns={columns}
        items={rows}
        loading={loading}
        emptyTitle="Nothing outstanding"
        aria-label="Balances by team"
      />
    </Stack>
  );
}

// ── TIMELINE ────────────────────────────────────────────────────────────────────────────────────

export const timelineDescription =
  "One counterparty's movements in order, with a running balance — the only one of the four that answers 'how did we get to this number'. The running total is the whole point.";

export interface BillingTimelineScreenProps {
  direction: InvoiceDirection;
  counterparty: string;
  entries: LedgerEntryRow[];
  loading?: boolean;
}

export function BillingTimelineScreen({
  direction,
  counterparty,
  entries,
  loading,
}: BillingTimelineScreenProps) {
  // The running balance, accumulated in order. This is what makes the screen a timeline rather than
  // another log: each row says what the balance BECAME, so a disputed figure can be traced to the
  // movement that produced it.
  const withRunning = useMemo(() => {
    let running = 0n;
    return entries.map((e) => {
      running += e.debit - e.credit;
      return { ...e, running };
    });
  }, [entries]);

  return (
    <Stack gap="section" data-testid="billing-timeline-screen" data-direction={direction}>
      <Heading size="md">{counterparty}</Heading>
      <Text fontSize="sm" color="fg.muted">
        Every movement in order, and what the balance became after each.
      </Text>

      <Card>
        <Stack gap="card" data-testid="billing-timeline">
          {withRunning.map((e, i) => (
            <Stack key={e.id.toString()} gap="1">
              {i > 0 && <Separator />}
              <HStack justify="space-between" gap="section" wrap="wrap">
                <Stack gap="0" lineHeight="short">
                  <Text fontSize="sm" fontWeight="medium">
                    {e.memo}
                  </Text>
                  <Text fontSize="xs" color="fg.muted">
                    {e.account} · <DateText value={e.at} variant="date" />
                  </Text>
                </Stack>

                <HStack gap="section">
                  <Stack gap="0" textAlign="end">
                    <Text fontSize="xs" color="fg.muted">
                      Movement
                    </Text>
                    <PriceText amount={e.debit > 0n ? e.debit : e.credit} />
                  </Stack>
                  <Stack gap="0" textAlign="end">
                    <Text fontSize="xs" color="fg.muted">
                      Balance after
                    </Text>
                    <PriceText amount={e.running} fontWeight="bold" data-testid="running-balance" />
                  </Stack>
                </HStack>
              </HStack>
            </Stack>
          ))}

          {withRunning.length === 0 && !loading && (
            <Text color="fg.muted" fontSize="sm">
              No movements against this counterparty yet.
            </Text>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}

// ── CREATE LOG ──────────────────────────────────────────────────────────────────────────────────

export const createLogDescription =
  "Posting a billing movement by hand. The memo is REQUIRED — a hand-posted entry with no explanation is the one nobody can reconcile later, and it is the reason manual entries get distrusted.";

export interface CreateLogScreenProps {
  title: string;
  // An ADJUSTMENT corrects an earlier mistake, so it additionally demands what is being corrected.
  adjustment?: boolean;
  onSubmit?(values: { amount: string; memo: string; reference: string }): void;
  busy?: boolean;
}

export function CreateLogScreen({ title, adjustment, onSubmit, busy }: CreateLogScreenProps) {
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [reference, setReference] = useState("");

  // The memo is required, and for an ADJUSTMENT so is the reference — an adjustment exists to
  // correct something, and one that does not say what it corrects is indistinguishable from an
  // unexplained change to the books.
  const complete =
    amount.trim().length > 0 && memo.trim().length > 0 && (!adjustment || reference.trim().length > 0);

  return (
    <Stack gap="section" maxW="2xl" data-testid="create-log-screen" data-adjustment={adjustment ? "true" : undefined}>
      <Heading size="md">{title}</Heading>

      <Card>
        <Stack gap="card">
          <Field label="Amount" required hint="In rupiah, without separators.">
            <TextInput value={amount} onChange={setAmount} inputMode="numeric" data-testid="log-amount" />
          </Field>

          <Field
            label="Memo"
            required
            hint="Why this entry exists. Read by whoever reconciles the books."
          >
            <TextInput value={memo} onChange={setMemo} data-testid="log-memo" />
          </Field>

          <Field
            label={adjustment ? "Correcting" : "Reference"}
            required={adjustment}
            hint={
              adjustment
                ? "The entry or invoice this adjustment corrects."
                : "An optional external reference — a transfer id, a document number."
            }
          >
            <TextInput value={reference} onChange={setReference} data-testid="log-reference" />
          </Field>

          <HStack justify="flex-end">
            <Button
              icon={Plus}
              disabled={!complete}
              loading={busy}
              onClick={() => onSubmit?.({ amount, memo, reference })}
              data-testid="log-submit"
            >
              Post entry
            </Button>
          </HStack>
        </Stack>
      </Card>
    </Stack>
  );
}
