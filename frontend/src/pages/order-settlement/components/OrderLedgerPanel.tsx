import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Box,
  Button,
  Card,
  Flex,
  Heading,
  Icon,
  Spacer,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { ChevronRight, Clock, Plus, Undo2 } from "lucide-react";

import { SettlementSourceBadge } from "../../../components/badges/SettlementSourceBadge";
import { SummaryCard, SummaryStrip } from "../../../features/orders/SummaryCard";
import { ConfirmDialog } from "../../../components/feedback/ConfirmDialog";
import { AddEntryDialog, type EntryDraft } from "./AddEntryDialog";
import { MarginBreakdown } from "./MarginBreakdown";
import { useIsMobile } from "../../../layouts/shell";
import { formatRupiah, formatSignedRupiah } from "../../../lib/money";
import {
  direction,
  isLate,
  isReversed,
  loss,
  netReceived,
  type OrderSettlement,
  type PostingRole,
  type SettlementEntry,
} from "../model";

// ONE ORDER'S SETTLEMENT LEDGER — `context.md` §Settlement Behaviors, rendered.
//
// ⚠ A DESIGN PROTOTYPE. It takes its whole ledger as a PROP: no query hook, no client, no route.
// See model.ts for why the contract does not exist yet.
//
// THE PANEL IS AN ARGUMENT ABOUT ONE NUMBER. Everything above the table exists to stop the balance
// being misread, because two of this design's decisions make the obvious reading wrong:
//
//   - `a-residual-balance-is-normal` — it will not reach zero, so it is not "outstanding"
//   - `hidden-cost-is-left-in-the-balance` — the gap is money the platform took and never itemised
//
// So the summary says **Penyesuaian**, signed — never a bare "balance", which would be read as a debt
// somebody is going to chase, and nobody is.
export interface OrderLedgerPanelProps {
  settlement: OrderSettlement;
  /** Whether this viewer may add or reverse rows — `the-write-set-is-cs-and-up`, resolved upstream. */
  canPost?: boolean;
  /**
   * WHICH of the write set. It decides one thing only: whether the sale figure is offered on the
   * form (`initial-total-is-postable-by-cs-and-owners`). Defaults to the role that may NOT author
   * it, so a caller that forgets to pass one gets the narrower form rather than the wider one.
   */
  role?: PostingRole;
  onAddEntry?: (draft: EntryDraft) => void;
  onReverse?: (entry: SettlementEntry) => void;
  /** Today, as `yyyy-mm-dd`. Passed in so a story is deterministic. */
  today?: string;
  /**
   * No card of its own — for a host that already frames it. The order detail's Settlement section is
   * a card with its own title, and a second card with a second title inside it read as two panels
   * (owner: *"settlement di sini ada 2 card, tidak enak dilihat"*). Bare, the title goes and Add Entry
   * moves to the foot, beside the append-only notice it belongs with.
   */
  bare?: boolean;
  /**
   * WHAT THE ORDER COST US, everything included — the host's own "total sistem" (owner,
   * `the-ledger-margins-need-the-hosts-total-beli`). Settlement never stores a cost, so the page that
   * holds the order hands it in; the panel takes it as complete and splits it into nothing.
   *
   * With it the strip gains two cards, Estimasi margin and Margin riil; without it (or 0, a cost not
   * recorded) neither appears — a margin with no cost behind it would be the whole payout passed off as
   * earned.
   */
  totalBeli?: bigint;
}

export function OrderLedgerPanel({
  settlement,
  canPost = false,
  role = "team_admin",
  onAddEntry,
  onReverse,
  today = new Date().toISOString().slice(0, 10),
  bare = false,
  totalBeli,
}: OrderLedgerPanelProps) {
  const { t } = useTranslation();
  const [reversing, setReversing] = useState<SettlementEntry | null>(null);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  // ⚠ 0 means NOT RECORDED, not "worth nothing" (order.proto:224). Every figure on this panel is
  // relative to the estimate, so with no estimate there is nothing to be relative to — the panel
  // says so instead of printing a loss of minus-everything, which would read as pure profit.
  const unknownEstimate = settlement.initialTotal === 0n;
  // An entry's original, by id — a reversal names what it undoes.
  const byId = new Map(settlement.entries.map((e) => [e.id, e]));
  // A PHONE READS EACH ENTRY AS A BLOCK (`a-phone-reads-each-line-as-a-block`) — a JS breakpoint, never
  // CSS hiding: six columns at 390px scrolled the change, the balance and the action off the screen.
  const isMobile = useIsMobile();

  const lost = loss(settlement);

  const addButton = canPost ? (
    <Button
      size="xs"
      variant="outline"
      onClick={() => setAdding(true)}
      data-testid="add-entry"
    >
      <Icon as={Plus} boxSize="4" />
      {t("orderSettlement.addEntry")}
    </Button>
  ) : null;

  const body = (
    <Stack gap="section">
      {unknownEstimate ? (
        <Box
          borderWidth="1px"
          borderRadius="md"
          p="card"
          borderColor="warning.border"
          data-testid="no-estimate-notice"
        >
          <Text fontWeight="medium">
            {t("orderSettlement.noEstimateTitle")}
          </Text>
          <Text fontSize="sm" color="fg.muted">
            {t("orderSettlement.noEstimateBody")}
          </Text>
        </Box>
      ) : (
        <SettlementSummary
          estimate={settlement.initialTotal}
          received={netReceived(settlement)}
          lost={lost}
          totalBeli={totalBeli}
          movedBy={movingEntries(settlement)}
          leadWide={isMobile}
          onBreakdown={() => setBreakdownOpen(true)}
        />
      )}

      {isMobile ? (
        <Stack gap="0" data-testid="ledger-blocks">
          {settlement.entries.map((entry) => (
            <LedgerBlock
              key={entry.id}
              entry={entry}
              reversed={isReversed(settlement, entry)}
              canPost={canPost}
              reverses={entry.reversesId ? byId.get(entry.reversesId) : undefined}
              onReverse={() => setReversing(entry)}
            />
          ))}
        </Stack>
      ) : (
      /* Sumber · Detail (owner, `the-ledger-type-column-reads-sumber`): the first says what the money
         is, the second where the row came from — the badge — and the note after it. */
      <Box overflowX="auto">
        {/* `interactive` — a row lights up under the pointer (owner), so a long line is read across
            without losing it. Nothing here is clicked; the hover is for the eye. */}
        <Table.Root size="sm" interactive data-testid="ledger-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>
                {t("orderSettlement.col.when")}
              </Table.ColumnHeader>
              <Table.ColumnHeader>
                {t("orderSettlement.col.type")}
              </Table.ColumnHeader>
              <Table.ColumnHeader>
                {t("orderSettlement.col.detail")}
              </Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">
                {t("orderSettlement.col.change")}
              </Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">
                {t("orderSettlement.col.balance")}
              </Table.ColumnHeader>
              <Table.ColumnHeader />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {settlement.entries.map((entry) => (
              <LedgerRow
                key={entry.id}
                entry={entry}
                reversed={isReversed(settlement, entry)}
                canPost={canPost}
                reverses={entry.reversesId ? byId.get(entry.reversesId) : undefined}
                onReverse={() => setReversing(entry)}
              />
            ))}
          </Table.Body>
        </Table.Root>
      </Box>
      )}

      {/* The rule is enforced in the API; a form that does not SAY so invites "just delete it". */}
      <Flex gap="3" align="center" wrap="wrap">
        <Text
          fontSize="xs"
          color="fg.muted"
          flex="1"
          minW="12rem"
          data-testid="append-only-notice"
        >
          {t("orderSettlement.appendOnlyNotice")}
        </Text>
        {bare && addButton}
      </Flex>
    </Stack>
  );

  const dialogs = (
    <>
      <AddEntryDialog
        open={adding}
        onOpenChange={setAdding}
        onSubmit={(draft) => onAddEntry?.(draft)}
        today={today}
        settlement={settlement}
        role={role}
      />

      {totalBeli !== undefined && totalBeli > 0n && (
        <MarginBreakdown
          open={breakdownOpen}
          onOpenChange={setBreakdownOpen}
          settlement={settlement}
          totalBeli={totalBeli}
        />
      )}

      {/* Reversing posts a real, permanent row — so it confirms, like every destructive action. */}
      <ConfirmDialog
        open={reversing !== null}
        onOpenChange={(next) => {
          if (!next) setReversing(null);
        }}
        title={t("orderSettlement.reverseTitle")}
        // WHICH row it undoes, not only by how much (owner: *"kasih sedikit tambahan biar jelas apa yang
        // di balikkan"*).
        message={t("orderSettlement.reverseBody", {
          amount: reversing ? formatSignedRupiah(-reversing.change) : "",
          type: reversing ? t(`orderSettlement.type.${reversing.settlementType}`) : "",
          date: reversing?.occurredOn ?? "",
        })}
        confirmLabel={t("orderSettlement.reverseConfirm")}
        onConfirm={async () => {
          if (reversing) onReverse?.(reversing);
          setReversing(null);
        }}
      />
    </>
  );

  if (bare) {
    return (
      <Box data-testid="order-ledger-panel">
        {body}
        {dialogs}
      </Box>
    );
  }

  return (
    <Card.Root data-testid="order-ledger-panel">
      <Card.Header>
        <Flex align="center" gap="3">
          <Heading size="sm">{t("orderSettlement.panelTitle")}</Heading>
          <Spacer />
          {addButton}
        </Flex>
      </Card.Header>

      <Card.Body>{body}</Card.Body>

      {dialogs}
    </Card.Root>
  );
}

// ── The summary ─────────────────────────────────────────────────────────────────────────────────

// THE ORDER LIST'S CARDS (`a-list-summary-is-the-order-lists-card-strip`) — the same `SummaryStrip` and
// `SummaryCard` as the order list and the settlement list, so an order's money reads the same shape
// everywhere.
//
// TWO MARGINS, side by side, when the host knows the cost (`the-ledger-margins-need-the-hosts-total-beli`):
//
//   Estimasi margin = harga jual − total beli     what the order detail promises
//   Margin riil     = diterima  − total beli      what the platform's payout delivered
//
// They differ by exactly the adjustment beside them — the card to their left.
function SettlementSummary({
  estimate,
  received,
  lost,
  totalBeli,
  movedBy,
  leadWide = false,
  onBreakdown,
}: {
  estimate: bigint;
  received: bigint;
  lost: bigint;
  /** The host's complete cost; undefined or 0 = not known, and both margins stay off. */
  totalBeli?: bigint;
  /** How many entries moved the money after the sale — see `movingEntries`. */
  movedBy: number;
  /** The lead card across the whole strip — a phone, where it would otherwise sit alone in half a row. */
  leadWide?: boolean;
  /** Open how the true margin adds up — the "Rincian ›" at the end of its label. */
  onBreakdown?: () => void;
}) {
  const { t } = useTranslation();
  const adjustment = -lost;
  const costKnown = totalBeli !== undefined && totalBeli > 0n;
  // A share of the SALE, every one of them — the order list measures its margin against the marketplace
  // price too (`the-margin-is-mp-minus-total-beli`).
  const ofSale = (part: bigint) =>
    estimate > 0n
      ? t("orderSettlement.stat.ofSales", { pct: ((Number(part) * 100) / Number(estimate)).toFixed(2) })
      : undefined;

  return (
    <SummaryStrip testId="settlement-summary">
      <SummaryCard
        label={t("orderSettlement.estimate")}
        value={formatRupiah(estimate)}
        line={t("orderSettlement.stat.soldDetailLine")}
        testId="sold"
      />
      <SummaryCard
        label={t("orderSettlement.received")}
        value={formatRupiah(received)}
        line={ofSale(received)}
        // How many entries make it up, under its share (owner).
        note={t("orderSettlement.stat.entryCount", { count: movedBy })}
        testId="received"
      />
      {/* THE ADJUSTMENT, signed (owner: *"penyesuaian"*) — one label both ways, so a gain is "+Rp 4.000"
          rather than a second word. Green when the order came out AHEAD: a red-only design renders a
          gain as a smaller loss, which is wrong in the one direction nobody double-checks. */}
      <SummaryCard
        label={t("orderSettlement.lost")}
        value={
          <Text as="span" color={adjustment < 0n ? "fg.error" : adjustment > 0n ? "fg.success" : undefined}>
            {formatSignedRupiah(adjustment)}
          </Text>
        }
        // The count is a NOTE here too — the same quieter grey as under Received (owner), not the darker
        // line colour, so one fact reads in one colour on both cards.
        note={t("orderSettlement.stat.entryCount", { count: movedBy })}
        testId="loss"
      />
      {costKnown && (
        <SummaryCard
          label={t("orderSettlement.estimatedMargin")}
          value={formatRupiah(estimate - totalBeli)}
          line={ofSale(estimate - totalBeli)}
          note={t("orderSettlement.stat.estimatedMarginNote")}
          testId="estimated-margin"
        />
      )}
      {/* THE FIGURE THE LEDGER EXISTS FOR (owner: *"buat margin riil sedikit lebih menonjol"*) — the lead
          card, with a short note under its share saying how it is made (owner: no tooltip). */}
      {costKnown && (
        <SummaryCard
          label={t("orderSettlement.trueMargin")}
          // "RINCIAN ›" AT THE END OF THE LABEL ROW (owner chose it over an icon, a formula link and two
          // buttons) — the word says the card opens, where an icon was easy to miss. The card itself stays
          // a card: only the word is pressed.
          mark={
            onBreakdown && (
              <Button
                variant="plain"
                size="2xs"
                h="auto"
                p="0"
                ms="auto"
                color="lead.fg"
                fontWeight="bold"
                onClick={onBreakdown}
                data-testid="margin-breakdown-open"
              >
                {t("orderSettlement.breakdown.open")}
                <Icon as={ChevronRight} boxSize="3" />
              </Button>
            )
          }
          value={formatRupiah(received - totalBeli)}
          line={ofSale(received - totalBeli)}
          note={t("orderSettlement.stat.marginNote")}
          emphasis
          wide={leadWide}
          testId="margin"
        />
      )}
    </SummaryStrip>
  );
}

/**
 * THE ENTRIES THAT MOVED THE MONEY — every row but the sale's own (`initial_total`, and its cancel).
 *
 * The sale is the line the others are measured against, not a movement: Received is the sale plus every
 * other row, and the adjustment is those rows alone. So "from 3 entries" on both cards counts the same
 * three — a payout, a fee, a correction — and a reversal and the row it undid are two entries, as they
 * are two rows on the ledger.
 */
function movingEntries(settlement: OrderSettlement): number {
  return settlement.entries.filter(
    (e) => e.settlementType !== "initial_total" && e.settlementType !== "initial_total_cancel",
  ).length;
}

// ── One entry, on a phone ───────────────────────────────────────────────────────────────────────

// The row's five facts as three lines, the arithmetic kept to the right edge where a thumb-held list is
// read down (`a-phone-reads-each-line-as-a-block`):
//
//   Penyesuaian marketplace                −Rp 4.500
//   2026-01-08 · [Manual · Budi]    saldo −Rp 30.500
//   voucher clawback                      ↶ Balikkan
function LedgerBlock({
  entry,
  reversed,
  canPost,
  reverses,
  onReverse,
}: {
  entry: SettlementEntry;
  reversed: boolean;
  canPost: boolean;
  reverses?: SettlementEntry;
  onReverse: () => void;
}) {
  const { t } = useTranslation();
  const dir = direction(entry);
  const late = isLate(entry);
  const canReverse = canPost && !reversed && !entry.reversesId;
  const detail = entry.reversesId
    ? reverses
      ? t("orderSettlement.reversalOf", { amount: formatSignedRupiah(reverses.change), date: reverses.occurredOn })
      : t("orderSettlement.reversalOfUnknown")
    : entry.note;

  return (
    <Stack
      gap="1"
      py="3"
      borderBottomWidth="1px"
      borderColor="border"
      opacity={reversed ? 0.5 : 1}
      data-testid={`entry-${entry.id}`}
    >
      <Flex justify="space-between" align="baseline" gap="3">
        <Text fontSize="sm">{t(`orderSettlement.type.${entry.settlementType}`)}</Text>
        <Text
          fontSize="sm"
          whiteSpace="nowrap"
          color={dir === "in" ? "fg.success" : dir === "out" ? "fg.error" : undefined}
        >
          {formatSignedRupiah(entry.change)}
        </Text>
      </Flex>

      <Flex justify="space-between" align="center" gap="3">
        <Flex align="center" gap="2" wrap="wrap" minW="0">
          <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
            {entry.occurredOn}
            {late && ` · ${t("orderSettlement.postedOn", { date: entry.postedOn })}`}
          </Text>
          <SettlementSourceBadge source={entry.sourceType} actor={entry.actorName} />
        </Flex>
        <Text fontSize="sm" fontWeight="bold" whiteSpace="nowrap" data-testid={`ledger-balance-${entry.id}`}>
          {t("orderSettlement.balanceShort")} {formatSignedRupiah(entry.balance)}
        </Text>
      </Flex>

      {(detail || canReverse) && (
        <Flex justify="space-between" align="center" gap="3">
          <Text fontSize="xs" color="fg.muted" minW="0">
            {detail}
          </Text>
          {canReverse && (
            <Button size="xs" variant="ghost" flexShrink="0" onClick={onReverse} data-testid={`ledger-reverse-${entry.id}`}>
              <Icon as={Undo2} boxSize="4" />
              {t("orderSettlement.reverse")}
            </Button>
          )}
        </Flex>
      )}
    </Stack>
  );
}

// ── One row ─────────────────────────────────────────────────────────────────────────────────────

function LedgerRow({
  entry,
  reversed,
  canPost,
  reverses,
  onReverse,
}: {
  entry: SettlementEntry;
  reversed: boolean;
  canPost: boolean;
  /** The row this one undoes, when it is a reversal. */
  reverses?: SettlementEntry;
  onReverse: () => void;
}) {
  const { t } = useTranslation();
  const dir = direction(entry);
  const late = isLate(entry);

  return (
    <Table.Row opacity={reversed ? 0.5 : 1} data-testid={`entry-${entry.id}`}>
      <Table.Cell whiteSpace="nowrap">
        <Text fontSize="sm">{entry.occurredOn}</Text>
        {/* `two-dates-occurred-and-posted` — a late fee is visible as the GAP, not as a footnote. */}
        {late && (
          <Flex align="center" gap="1" data-testid="late-marker">
            <Icon as={Clock} boxSize="3" color="fg.muted" />
            <Text fontSize="xs" color="fg.muted">
              {t("orderSettlement.postedOn", { date: entry.postedOn })}
            </Text>
          </Flex>
        )}
      </Table.Cell>

      {/* "SUMBER" — what the money is (owner, 2026-10-05: *"Jenis jadi sumber"*): a payout, a fee, the sale. */}
      <Table.Cell whiteSpace="nowrap" data-testid={`ledger-type-${entry.id}`}>
        <Text fontSize="sm">{t(`orderSettlement.type.${entry.settlementType}`)}</Text>
      </Table.Cell>

      {/* DETAIL — the source badge first, then the note (owner: *"detail ada sumber atau source badge lalu
          diikuti detail sebelumnya"*). A manual badge names who typed it: nothing detects a wrong amount,
          so visibility IS the control. A reversal says WHICH row it undoes — its amount and its day. */}
      <Table.Cell data-testid={`ledger-detail-${entry.id}`}>
        <Flex align="center" gap="2" wrap="wrap">
          <SettlementSourceBadge source={entry.sourceType} actor={entry.actorName} />
          {entry.reversesId ? (
            <Text fontSize="sm" color="fg.muted" data-testid={`ledger-reversal-${entry.id}`}>
              {reverses
                ? t("orderSettlement.reversalOf", {
                    amount: formatSignedRupiah(reverses.change),
                    date: reverses.occurredOn,
                  })
                : t("orderSettlement.reversalOfUnknown")}
            </Text>
          ) : (
            entry.note && (
              <Text fontSize="sm" color="fg.muted">
                {entry.note}
              </Text>
            )
          )}
        </Flex>
      </Table.Cell>

      <Table.Cell textAlign="end" whiteSpace="nowrap">
        <Text
          fontSize="sm"
          color={
            dir === "in" ? "fg.success" : dir === "out" ? "fg.error" : undefined
          }
        >
          {entry.change >= 0n ? "+" : "−"}
          {formatRupiah(entry.change >= 0n ? entry.change : -entry.change)}
        </Text>
      </Table.Cell>

      {/* STRONGER THAN THE CHANGE BESIDE IT (owner) — bold, never muted: the running balance is the figure
          read down the page, the change is what moved it. Written in the change's own format, the sign
          before "Rp" (`a-negative-amount-puts-its-minus-before-rp`). */}
      <Table.Cell textAlign="end" whiteSpace="nowrap">
        <Text fontSize="sm" fontWeight="bold" data-testid={`ledger-balance-${entry.id}`}>
          {formatSignedRupiah(entry.balance)}
        </Text>
      </Table.Cell>

      <Table.Cell textAlign="end">
        {/* No Edit and no Delete, ever — `a-correction-is-a-new-row`. Reverse posts a further row.
            ONE action, so it is the button itself — a `⋯` menu holding a single item is a click for
            nothing (owner; CLAUDE.md keeps one or two actions inline). */}
        {canPost && !reversed && !entry.reversesId && (
          <Button
            size="xs"
            variant="ghost"
            onClick={onReverse}
            data-testid={`ledger-reverse-${entry.id}`}
          >
            <Icon as={Undo2} boxSize="4" />
            {t("orderSettlement.reverse")}
          </Button>
        )}
      </Table.Cell>
    </Table.Row>
  );
}
