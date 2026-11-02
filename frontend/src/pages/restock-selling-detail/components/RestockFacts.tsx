import { useTranslation } from "react-i18next";
import { Flex, HStack, Icon, Link, SimpleGrid, Separator, Stack, Text } from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";

import type { RestockRequest } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { committedValue, courierCharge, goodsTotal } from "../../../features/restock/summary";
import { useFinancialAccount } from "../../../features/financialAccount/queries";
import { useShipmentChannelsByIds } from "../../../features/shipment/queries";
import { paymentTypeLabel } from "../../../components/pickers/PaymentTypeSelect";
import { ShipmentChannelBadge } from "../../../components/badges/ShipmentChannelBadge";
import { Fact } from "../../../components/chrome/DetailSection";
import { formatUnixDateTime } from "../../../lib/datetime";
import { formatRupiahNumber } from "../../../lib/money";

// THE RECORD, SECTION BY SECTION — what was one Info tab of three cards is the content of the page's sections now
// (the-restock-detail-is-the-product-pages-shape). Each answers one question:
//
//   Kiriman     — where it is going and how: the warehouse, the courier, the photo of the label, when it was raised and
//                 when it arrived (the-receipt-is-the-tracking-number, a-restock-is-one-parcel).
//   Pembayaran  — what this team paid when it raised it: which account (a-restock-names-its-paying-account), and the TOTAL —
//                 goods plus shipping, nothing else (the-couriers-charge-stays-out-of-total).
//   Ongkir COD  — once accepted, what the WAREHOUSE paid the courier at the door, owed back by this team
//                 (the-warehouse-cost-is-the-couriers-charge-at-the-door). Its own section, never a line under the total.
//   Catatan     — one note per writer: features/restock/RestockNotes (the-notes-are-one-per-writer).
//
// The order id and the tracking number are not facts here: they are the page's TITLE (the-restock-detail-is-the-product-
// pages-shape), where they are read first and copied.

export function DeliveryFacts({ request, warehouseName }: { request: RestockRequest; warehouseName: string }) {
  const { t } = useTranslation();
  const channels = useShipmentChannelsByIds([request.shipmentId]);

  return (
    <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
      <Fact label={t("restock.detail.destination")}>
        <Text as="span" data-testid="restock-detail-warehouse">
          {warehouseName}
        </Text>
      </Fact>
      <Fact label={t("restock.detail.courier")}>
        <HStack gap="1.5" data-testid="restock-detail-courier">
          <ShipmentChannelBadge channelId={request.shipmentId} channel={channels.data?.get(request.shipmentId.toString())} />
        </HStack>
      </Fact>
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

export function PaymentFacts({ request, teamId }: { request: RestockRequest; teamId: bigint }) {
  const { t } = useTranslation();
  const account = useFinancialAccount(teamId, request.financeAccountId);

  // A restock raised before paying accounts names a payment TYPE instead — read-only history.
  const paidFrom =
    request.financeAccountId > 0n
      ? (account.data?.name ?? t("restock.detail.accountRef", { id: request.financeAccountId.toString() }))
      : paymentTypeLabel(t, request.paymentType);

  // SMALL, A RECEIPT (owner: *"pembayaran terlalu kurang desainnya buat lebih kecil saja taruh kanan"*,
  // payment-is-a-receipt-on-the-right): which account, then the lines with their figures held right, the total last.
  return (
    <Stack gap="2" fontSize="sm">
      <Fact label={t("restock.detail.paidFrom")}>
        <Text as="span" data-testid="restock-detail-paid-from">
          {paidFrom || "—"}
        </Text>
      </Fact>

      <Separator />

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

export function CourierChargeFacts({ request, warehouseName }: { request: RestockRequest; warehouseName: string }) {
  const { t } = useTranslation();
  const charge = courierCharge(request);

  if (charge <= 0n) {
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
      <Text fontSize="xs" color="fg.muted">
        {t("restock.detail.courierChargeOwedBySelling", { warehouse: warehouseName })}
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
