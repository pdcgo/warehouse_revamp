import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Heading,
  Icon,
  Menu,
  Portal,
  Spacer,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { Clock, Hand, MoreHorizontal, Plus, Undo2 } from "lucide-react";

import { ConfirmDialog } from "../../../components/feedback/ConfirmDialog";
import { AddEntryDialog, type EntryDraft } from "./AddEntryDialog";
import { formatRupiah } from "../../../lib/money";
import {
  direction,
  hiddenCost,
  isLate,
  isReversed,
  loss,
  namedAdjustments,
  netReceived,
  trueMargin,
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
// So the summary says **lost**, and breaks that loss into the part somebody named and the part
// nobody did. A single figure labelled "balance" would be read as a debt somebody is going to chase,
// and nobody is.
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
}

export function OrderLedgerPanel({
  settlement,
  canPost = false,
  role = "team_admin",
  onAddEntry,
  onReverse,
  today = new Date().toISOString().slice(0, 10),
}: OrderLedgerPanelProps) {
  const { t } = useTranslation();
  const [reversing, setReversing] = useState<SettlementEntry | null>(null);
  const [adding, setAdding] = useState(false);

  // ⚠ 0 means NOT RECORDED, not "worth nothing" (order.proto:224). Every figure on this panel is
  // relative to the estimate, so with no estimate there is nothing to be relative to — the panel
  // says so instead of printing a loss of minus-everything, which would read as pure profit.
  const unknownEstimate = settlement.initialTotal === 0n;

  const lost = loss(settlement);
  const hidden = hiddenCost(settlement);
  const named = namedAdjustments(settlement);

  return (
    <Card.Root data-testid="order-ledger-panel">
      <Card.Header>
        <Flex align="center" gap="3">
          <Heading size="sm">{t("orderSettlement.panelTitle")}</Heading>
          <Spacer />
          {canPost && (
            <Button size="xs" variant="outline" onClick={() => setAdding(true)} data-testid="add-entry">
              <Icon as={Plus} boxSize="4" />
              {t("orderSettlement.addEntry")}
            </Button>
          )}
        </Flex>
      </Card.Header>

      <Card.Body>
        <Stack gap="section">
          {unknownEstimate ? (
            <Box
              borderWidth="1px"
              borderRadius="md"
              p="card"
              borderColor="orange.400"
              data-testid="no-estimate-notice"
            >
              <Text fontWeight="medium">{t("orderSettlement.noEstimateTitle")}</Text>
              <Text fontSize="sm" color="fg.muted">
                {t("orderSettlement.noEstimateBody")}
              </Text>
            </Box>
          ) : (
            <SettlementSummary
              estimate={settlement.initialTotal}
              received={netReceived(settlement)}
              lost={lost}
              hidden={hidden}
              named={named}
              margin={trueMargin(settlement)}
            />
          )}

          <Box overflowX="auto">
            <Table.Root size="sm" data-testid="ledger-table">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("orderSettlement.col.when")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("orderSettlement.col.type")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("orderSettlement.col.detail")}</Table.ColumnHeader>
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
                    onReverse={() => setReversing(entry)}
                  />
                ))}
              </Table.Body>
            </Table.Root>
          </Box>

          {/* The rule is enforced in the API; a form that does not SAY so invites "just delete it". */}
          <Text fontSize="xs" color="fg.muted" data-testid="append-only-notice">
            {t("orderSettlement.appendOnlyNotice")}
          </Text>
        </Stack>
      </Card.Body>

      <AddEntryDialog
        open={adding}
        onOpenChange={setAdding}
        onSubmit={(draft) => onAddEntry?.(draft)}
        today={today}
        settlement={settlement}
        role={role}
      />

      {/* Reversing posts a real, permanent row — so it confirms, like every destructive action. */}
      <ConfirmDialog
        open={reversing !== null}
        onOpenChange={(next) => {
          if (!next) setReversing(null);
        }}
        title={t("orderSettlement.reverseTitle")}
        message={t("orderSettlement.reverseBody", {
          amount: reversing ? formatRupiah(reversing.change) : "",
        })}
        confirmLabel={t("orderSettlement.reverseConfirm")}
        onConfirm={async () => {
          if (reversing) onReverse?.(reversing);
          setReversing(null);
        }}
      />
    </Card.Root>
  );
}

// ── The summary ─────────────────────────────────────────────────────────────────────────────────

// WHY THE LOSS IS SPLIT IN TWO. `hidden-cost-is-left-in-the-balance` says the platform keeps money it
// never itemises — so a manager looking at "lost 10.000" has to be able to see how much of that
// anybody explained. The split is the difference between "we were charged" and "we do not know".
function SettlementSummary({
  estimate,
  received,
  lost,
  hidden,
  named,
  margin,
}: {
  estimate: bigint;
  received: bigint;
  lost: bigint;
  hidden: bigint;
  named: bigint;
  margin: bigint;
}) {
  const { t } = useTranslation();

  return (
    <Flex gap="card" wrap="wrap" data-testid="settlement-summary">
      <Figure label={t("orderSettlement.estimate")} value={formatRupiah(estimate)} />
      <Figure
        label={t("orderSettlement.received")}
        value={formatRupiah(received)}
        testId="received"
      />
      <Figure
        label={lost >= 0n ? t("orderSettlement.lost") : t("orderSettlement.gained")}
        value={formatRupiah(lost >= 0n ? lost : -lost)}
        // Green when the order came out AHEAD. A red-only design renders a gain as a smaller loss,
        // which is wrong in the one direction nobody double-checks.
        tone={lost > 0n ? "fg.error" : lost < 0n ? "fg.success" : undefined}
        testId="loss"
        hint={t("orderSettlement.lossHint", {
          hidden: formatRupiah(hidden),
          named: formatRupiah(named),
        })}
      />
      <Figure label={t("orderSettlement.trueMargin")} value={formatRupiah(margin)} testId="margin" />
    </Flex>
  );
}

function Figure({
  label,
  value,
  tone,
  hint,
  testId,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
  testId?: string;
}) {
  return (
    <Box minW="9rem" data-testid={testId}>
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Text fontSize="lg" fontWeight="semibold" color={tone}>
        {value}
      </Text>
      {hint && (
        <Text fontSize="xs" color="fg.muted">
          {hint}
        </Text>
      )}
    </Box>
  );
}

// ── One row ─────────────────────────────────────────────────────────────────────────────────────

function LedgerRow({
  entry,
  reversed,
  canPost,
  onReverse,
}: {
  entry: SettlementEntry;
  reversed: boolean;
  canPost: boolean;
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

      <Table.Cell whiteSpace="nowrap">
        <Flex align="center" gap="2">
          <Text fontSize="sm">{t(`orderSettlement.type.${entry.settlementType}`)}</Text>
          {/* Visibility IS the control — nothing detects a wrong amount, so who typed it must show. */}
          {entry.sourceType === "manual" && (
            <Badge size="sm" colorPalette="purple" data-testid="manual-badge">
              <Icon as={Hand} boxSize="3" />
              {entry.actorName}
            </Badge>
          )}
        </Flex>
      </Table.Cell>

      <Table.Cell>
        <Text fontSize="sm" color="fg.muted">
          {entry.reversesId ? t("orderSettlement.reversalOf") : entry.note}
        </Text>
      </Table.Cell>

      <Table.Cell textAlign="end" whiteSpace="nowrap">
        <Text
          fontSize="sm"
          fontWeight="medium"
          color={dir === "in" ? "fg.success" : dir === "out" ? "fg.error" : undefined}
        >
          {entry.change >= 0n ? "+" : "−"}
          {formatRupiah(entry.change >= 0n ? entry.change : -entry.change)}
        </Text>
      </Table.Cell>

      <Table.Cell textAlign="end" whiteSpace="nowrap">
        <Text fontSize="sm" color="fg.muted">
          {formatRupiah(entry.balance)}
        </Text>
      </Table.Cell>

      <Table.Cell textAlign="end">
        {/* No Edit and no Delete, ever — `a-correction-is-a-new-row`. Reverse posts a further row. */}
        {canPost && !reversed && !entry.reversesId && (
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button size="xs" variant="ghost" aria-label={t("orderSettlement.rowActions")}>
                <Icon as={MoreHorizontal} boxSize="4" />
              </Button>
            </Menu.Trigger>
            <Portal>
              <Menu.Positioner>
                <Menu.Content>
                  <Menu.Item value="reverse" onSelect={onReverse}>
                    <Icon as={Undo2} boxSize="4" />
                    {t("orderSettlement.reverse")}
                  </Menu.Item>
                </Menu.Content>
              </Menu.Positioner>
            </Portal>
          </Menu.Root>
        )}
      </Table.Cell>
    </Table.Row>
  );
}
