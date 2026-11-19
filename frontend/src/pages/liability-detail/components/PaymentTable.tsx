import { useTranslation } from "react-i18next";
import { Badge, Box, Button, Flex, Icon, Stack, Table, Text } from "@chakra-ui/react";
import { Ban, Check, Wallet, X } from "lucide-react";

import { LiabilityPaymentStatus } from "../../../gen/warehouse/liability/v1/liability_pb";
import type { LiabilityPayment } from "../../../gen/warehouse/liability/v1/liability_pb";
import { formatRupiah } from "../../../lib/money";
import { formatUnixDateTimeShort } from "../../../lib/datetime";
import { EmptyHint } from "../../../components/feedback/EmptyHint";
import { ActorName } from "../../../components/entity/ActorName";
import { useActors } from "../../../features/users/queries";
import { personName } from "../../../lib/users";
import { PaymentProof } from "./PaymentProof";

function statusKey(status: LiabilityPaymentStatus): string {
  switch (status) {
    case LiabilityPaymentStatus.RECORDED:
      return "liabilityDetail.statusRecorded";
    case LiabilityPaymentStatus.CONFIRMED:
      return "liabilityDetail.statusConfirmed";
    case LiabilityPaymentStatus.REJECTED:
      return "liabilityDetail.statusRejected";
    // The payer took it back before anybody decided (a-pending-payment-is-cancelled-by-its-selling-team).
    case LiabilityPaymentStatus.CANCELLED:
      return "liabilityDetail.statusCancelled";
    default:
      return "liabilityDetail.statusUnknown";
  }
}

function statusPalette(status: LiabilityPaymentStatus): string {
  switch (status) {
    case LiabilityPaymentStatus.RECORDED:
      return "warning";
    case LiabilityPaymentStatus.CONFIRMED:
      return "success";
    // ⚠ RED. A refusal is an outcome the payer has to act on — re-send the slip, or the money.
    case LiabilityPaymentStatus.REJECTED:
      return "error";
    // The reject badge's tone: a claim that ended without moving money, which the payer may need to make again.
    case LiabilityPaymentStatus.CANCELLED:
      return "error";
    default:
      return "gray";
  }
}

export interface PaymentTableProps {
  rows: LiabilityPayment[];
  /** The tab's own way of saying it has nothing. */
  emptyText: string;
  /** The Team payments tab: the claims only this team, the creditor, accepts or rejects. */
  withConfirm: boolean;
  /** A monitor reads; it never accepts or rejects. */
  writable: boolean;
  /** The team reading — the proof links are minted for it. */
  readerTeamId: bigint;
  onConfirm: (payment: LiabilityPayment) => void;
  onReject: (payment: LiabilityPayment) => void;
  /**
   * My payments only: this team, the PAYER, may take a pending claim back (a-pending-payment-is-cancelled-by-its-selling-team)
   * — a selling team's Owner or Admin, never a monitor. The page decides who may; unset offers nothing.
   */
  onCancel?: (payment: LiabilityPayment) => void;
  /** Each payment as a block on a phone (the-team-balance-phone-layout-is-accepted) — the pair page's `useIsMobile()`. */
  phone?: boolean;
}

// ONE SIDE'S PAYMENTS ON THE PAIR — My payments (this team paid) or Team payments (they paid; this team decides).
export function PaymentTable({
  rows,
  emptyText,
  withConfirm,
  writable,
  readerTeamId,
  onConfirm,
  onReject,
  onCancel,
  phone = false,
}: PaymentTableProps) {
  const { t } = useTranslation();
  // WHO RECORDED EACH PAYMENT (the-team-balance-recorded-by-is-accepted): the person who made the claim — `recorded_by`,
  // named in one batch — with the "by Root team" badge when Root or the System Administrator recorded it from outside
  // the payer (`recorded_is_override`). A column on a desktop, a muted line on a phone: the Expenses list's accepted
  // shape. 0 is a claim nobody was recorded for — a dash, and never a badge.
  const people = useActors(rows.map((p) => p.recordedBy)).data;
  const byOf = (p: LiabilityPayment) => {
    const name = p.recordedBy === 0n ? "—" : personName(people?.get(p.recordedBy.toString()), `#${p.recordedBy}`);

    return { name, isOverride: p.recordedIsOverride && p.recordedBy !== 0n };
  };

  // An empty tab says so with the list's hint, never a bare grey line (an-empty-list-shows-a-hint).
  if (rows.length === 0) {
    return <EmptyHint icon={Wallet} size="sm" title={emptyText} testId="liability-payments-empty" />;
  }

  // THE PAYER'S ONE ACT on its own pending claim — Cancel, inline. Only on a payment this team paid, only while it waits.
  const cancel = (p: LiabilityPayment) =>
    !withConfirm &&
    writable &&
    onCancel !== undefined &&
    p.payerTeamId === readerTeamId &&
    p.status === LiabilityPaymentStatus.RECORDED && (
      <Button
        size="xs"
        variant="outline"
        colorPalette="error"
        data-testid={`liability-detail-cancel-${p.id}`}
        onClick={() => onCancel(p)}
      >
        <Icon as={Ban} boxSize="4" />
        {t("liabilityDetail.cancel")}
      </Button>
    );

  // TWO actions, so they stay inline — an overflow menu is for three or more.
  const actions = (p: LiabilityPayment) =>
    withConfirm &&
    writable &&
    p.status === LiabilityPaymentStatus.RECORDED && (
      <>
        <Button
          size="xs"
          colorPalette="success"
          data-testid={`liability-detail-confirm-${p.id}`}
          onClick={() => onConfirm(p)}
        >
          <Icon as={Check} boxSize="4" />
          {t("liabilityDetail.confirm")}
        </Button>
        <Button
          size="xs"
          variant="outline"
          colorPalette="error"
          data-testid={`liability-detail-reject-${p.id}`}
          onClick={() => onReject(p)}
        >
          <Icon as={X} boxSize="4" />
          {t("liabilityDetail.reject")}
        </Button>
      </>
    );

  // ⚠ THE REASON IS SHOWN ON BOTH SIDES, and to the payer above all: a refusal they cannot read is a debt they cannot
  // fix.
  const reason = (p: LiabilityPayment) =>
    p.reason !== "" && (
      <Text fontSize="xs" color="error.fg" data-testid={`liability-detail-reason-${p.id}`}>
        {p.reason}
      </Text>
    );

  if (phone) {
    return (
      <Stack gap="0" data-testid="liability-payments-blocks">
        {rows.map((p) => (
          <Box
            key={p.id.toString()}
            py="2.5"
            px="1"
            borderBottomWidth="1px"
            borderColor="border.muted"
            data-testid={`liability-detail-payment-${p.id}`}
          >
            <Flex justify="space-between" align="center" gap="3">
              <Text fontSize="sm" fontWeight="bold" whiteSpace="nowrap">
                {formatRupiah(p.amount)}
              </Text>
              <Badge colorPalette={statusPalette(p.status)} data-testid={`liability-detail-payment-status-${p.id}`}>
                {t(statusKey(p.status))}
              </Badge>
            </Flex>
            <Text fontSize="xs" color="fg.muted" mt="0.5" lineClamp={1}>
              {formatUnixDateTimeShort(p.createdAtUnix)}
              {p.note ? ` · ${p.note}` : ""}
            </Text>
            <Text fontSize="xs" color="fg.muted" mt="0.5" data-testid={`liability-detail-payment-by-${p.id}`}>
              <ActorName
                name={t("liabilityDetail.recordedBy", { name: byOf(p).name })}
                isOverride={byOf(p).isOverride}
                size="xs"
              />
            </Text>
            {reason(p)}
            <Flex justify="space-between" align="center" gap="2" mt="1.5" wrap="wrap">
              <PaymentProof teamId={readerTeamId} documentIds={p.documentIds} />
              <Flex gap="2">
                {actions(p)}
                {cancel(p)}
              </Flex>
            </Flex>
          </Box>
        ))}
      </Stack>
    );
  }

  return (
    <Table.Root size="sm">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>{t("liabilityDetail.colDate")}</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end">{t("liabilityDetail.colAmount")}</Table.ColumnHeader>
          <Table.ColumnHeader>{t("liabilityDetail.colNote")}</Table.ColumnHeader>
          <Table.ColumnHeader>{t("liabilityDetail.colRecordedBy")}</Table.ColumnHeader>
          {/* §Payment Flow's middle step — *"Team B check manually"* — needs something to look at. */}
          <Table.ColumnHeader>{t("liabilityDetail.colProof")}</Table.ColumnHeader>
          <Table.ColumnHeader>{t("liabilityDetail.colStatus")}</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map((p) => (
          <Table.Row key={p.id.toString()} data-testid={`liability-detail-payment-${p.id}`}>
            <Table.Cell whiteSpace="nowrap">{formatUnixDateTimeShort(p.createdAtUnix)}</Table.Cell>
            <Table.Cell textAlign="end" whiteSpace="nowrap">
              {formatRupiah(p.amount)}
            </Table.Cell>
            <Table.Cell color="fg.muted">
              <Stack gap="0">
                <Text>{p.note || "—"}</Text>
                {reason(p)}
              </Stack>
            </Table.Cell>
            <Table.Cell data-testid={`liability-detail-payment-by-${p.id}`}>
              <ActorName name={byOf(p).name} isOverride={byOf(p).isOverride} />
            </Table.Cell>
            <Table.Cell>
              <PaymentProof teamId={readerTeamId} documentIds={p.documentIds} />
            </Table.Cell>
            <Table.Cell>
              <Flex align="center" gap="2">
                <Badge colorPalette={statusPalette(p.status)} data-testid={`liability-detail-payment-status-${p.id}`}>
                  {t(statusKey(p.status))}
                </Badge>
                {actions(p)}
                {cancel(p)}
              </Flex>
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}
