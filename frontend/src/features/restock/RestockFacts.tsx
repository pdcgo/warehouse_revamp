import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Flex, HStack, Icon, Link, SimpleGrid, Separator, Stack, Text } from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";

import type { RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { committedValue, courierCharge, goodsTotal } from "./summary";
import { PhotoView } from "./PhotoView";
import { courierSlipSample } from "./photoSamples";
import { useFinancialAccount } from "../financialAccount/queries";
import { useShipmentChannelsByIds } from "../shipment/queries";
import { paymentTypeLabel } from "../../components/pickers/PaymentTypeSelect";
import { ShipmentChannelBadge } from "../../components/badges/ShipmentChannelBadge";
import { Fact } from "../../components/chrome/DetailSection";
import { formatUnixDateTime } from "../../lib/datetime";
import { formatRupiahNumber } from "../../lib/money";

// THE RECORD, SECTION BY SECTION — the content of a restock page's sections (the-restock-detail-is-the-product-pages-shape),
// for both sides of it: the selling team's page and the warehouse's
// (the-warehouse-restock-detail-follows-the-screen-rules). Each answers one question:
//
//   Kiriman     — where it is going (the selling side) or where it is coming from (the warehouse's), and how: the courier,
//                 the photo of the label, when it was raised and when it arrived (the-receipt-is-the-tracking-number).
//   Pembayaran  — goods plus shipping, the TOTAL, nothing else (the-couriers-charge-stays-out-of-total) — and, on the
//                 selling side only, which account paid (a-restock-names-its-paying-account): the warehouse cannot read the
//                 selling team's accounts, and they are its purchase terms.
//   Ongkir COD  — once accepted, what the WAREHOUSE paid the courier at the door, owed back by the selling team
//                 (the-warehouse-cost-is-the-couriers-charge-at-the-door). Its own section, never a line under the total.
//
// The order id and the tracking number are not facts here: they are the page's TITLE (RestockTitleRow).

/** The other party of a restock as a fact — the selling side's destination, the warehouse side's sender. */
export interface RestockParty {
  label: string;
  name: string;
  testId: string;
}

export function DeliveryFacts({
  request,
  party,
  narrow = false,
  withCourierCharge = false,
  courierCharge,
}: {
  request: RestockRequest;
  party: RestockParty;
  /** In a side column — one fact a row, whatever the screen. */
  narrow?: boolean;
  /**
   * THE WAREHOUSE'S OWN ONGKIR, after the courier (the-warehouse-sees-the-ongkir-it-paid) — the charge it paid at the
   * door, as the fact `courierCharge`, which its page gives; none given reads as not yet. The selling team's page keeps
   * it a section of its own, so it leaves this off.
   */
  withCourierCharge?: boolean;
  courierCharge?: ReactNode;
}) {
  const { t } = useTranslation();
  const channels = useShipmentChannelsByIds([request.shipmentId]);

  return (
    <SimpleGrid columns={narrow ? 1 : { base: 1, sm: 2 }} gap="card">
      <Fact label={party.label}>
        <Text as="span" data-testid={party.testId}>
          {party.name}
        </Text>
      </Fact>
      <Fact label={t("restock.detail.courier")}>
        <HStack gap="1.5" data-testid="restock-detail-courier">
          <ShipmentChannelBadge channelId={request.shipmentId} channel={channels.data?.get(request.shipmentId.toString())} />
        </HStack>
      </Fact>
      {withCourierCharge && <Fact label={t("restock.detail.section.courier")}>{courierCharge}</Fact>}
      <Fact label={t("restock.detail.receiptPhotoLabel")}>
        <ReceiptPhoto url={request.receiptFile} />
      </Fact>
      <Fact label={t("restock.detail.created")}>{formatUnixDateTime(request.createdAtUnix)}</Fact>
      <Fact label={t("restock.detail.arrivedAt")}>
        {request.arrivedAtUnix > 0n ? (
          <Text as="span" data-testid="restock-detail-arrived-at">
            {formatUnixDateTime(request.arrivedAtUnix)}
          </Text>
        ) : undefined}
      </Fact>
    </SimpleGrid>
  );
}

/** Which account paid — the selling side's line, read from its own accounts. */
function PaidFrom({ request, teamId }: { request: RestockRequest; teamId: bigint }) {
  const { t } = useTranslation();
  const account = useFinancialAccount(teamId, request.financeAccountId);

  // A restock raised before paying accounts names a payment TYPE instead — read-only history.
  const paidFrom =
    request.financeAccountId > 0n
      ? (account.data?.name ?? t("restock.detail.accountRef", { id: request.financeAccountId.toString() }))
      : paymentTypeLabel(t, request.paymentType);

  return (
    <>
      <Fact label={t("restock.detail.paidFrom")}>
        <Text as="span" data-testid="restock-detail-paid-from">
          {paidFrom || "—"}
        </Text>
      </Fact>

      <Separator />
    </>
  );
}

/**
 * SMALL, A RECEIPT (owner: *"pembayaran terlalu kurang desainnya buat lebih kecil saja taruh kanan"*,
 * payment-is-a-receipt-on-the-right): which account — `teamId` given, the selling side — then the lines with their
 * figures held right, the total last.
 */
export function PaymentFacts({ request, teamId }: { request: RestockRequest; teamId?: bigint }) {
  const { t } = useTranslation();

  return (
    <Stack gap="2" fontSize="sm">
      {teamId !== undefined && <PaidFrom request={request} teamId={teamId} />}

      {/* Goods + shipping = the total, and the total is what the paying account was charged. */}
      <MoneyLine label={t("restock.detail.subtotal")} value={goodsTotal(request.items)} testId="restock-detail-subtotal" />
      <MoneyLine label={t("restock.detail.shipping")} value={request.shipmentCost} testId="restock-detail-shipping" />
      <Separator />
      <Flex justify="space-between" gap="3" fontWeight="bold">
        <Text>{t("restock.detail.total")}</Text>
        <Text whiteSpace="nowrap" data-testid="restock-detail-total">
          {formatRupiahNumber(committedValue(request))}
        </Text>
      </Flex>
    </Stack>
  );
}

// The slip's photo sits under the charge's note (the-detail-pages-show-the-slip-and-the-broken-rack) — ⚠ a sample
// (photoSamples.ts), marked by the page. `owed` is the page's own line: who owes it to whom, from where it is read.
export function CourierChargeFacts({
  request,
  owed,
  slipMark,
}: {
  request: RestockRequest;
  owed: string;
  slipMark?: ReactNode;
}) {
  const { t } = useTranslation();
  const charge = courierCharge(request);

  if (charge <= 0) {
    return (
      <Text fontSize="sm" color="fg.muted" data-testid="restock-detail-courier-charge-none">
        {t("restock.detail.courierChargeNone")}
      </Text>
    );
  }

  return (
    <Stack gap="1">
      <Text fontSize="md" fontWeight="bold" data-testid="restock-detail-courier-charge">
        {formatRupiahNumber(charge)}
      </Text>
      <Text fontSize="sm" wordBreak="break-word" data-testid="restock-detail-courier-charge-note">
        {request.warehouseAdditionalCostNote}
      </Text>
      <PhotoView
        url={courierSlipSample(request)}
        title={t("restock.detail.slipPhoto.title")}
        alt={t("restock.detail.slipPhoto.alt")}
        subject={`#${request.id.toString()}`}
        mark={slipMark}
        testId="restock-detail-courier-photo"
      />
      <Text fontSize="xs" color="fg.muted">
        {owed}
      </Text>
    </Stack>
  );
}

// A receipt line: the label on the left, the figure held right.
function MoneyLine({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <Flex justify="space-between" gap="3">
      <Text color="fg.muted">{label}</Text>
      <Text whiteSpace="nowrap" data-testid={testId}>
        {formatRupiahNumber(value)}
      </Text>
    </Flex>
  );
}

// The photo of the label — a link out, since it is somebody's phone picture rather than something to lay out here.
function ReceiptPhoto({ url }: { url: string }) {
  const { t } = useTranslation();

  return url ? (
    <Link href={url} target="_blank" rel="noreferrer" fontSize="sm" data-testid="restock-detail-receipt-photo">
      <Icon as={ExternalLink} boxSize="3" />
      {t("restock.detail.receiptPhoto")}
    </Link>
  ) : (
    <Text as="span" fontSize="sm" color="fg.muted">
      {t("restock.detail.noReceiptPhoto")}
    </Text>
  );
}
