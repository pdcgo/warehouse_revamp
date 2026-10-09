import { useTranslation } from "react-i18next";
import { Card, HStack, Icon, Link, Separator, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";

import type { RestockRequest } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockRequestStatus } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { DetailField } from "../../../features/restock/DetailField";
import { committedValue, courierCharge, goodsTotal } from "../../../features/restock/summary";
import { useFinancialAccount } from "../../../features/financialAccount/queries";
import { useShipmentChannelsByIds } from "../../../features/shipment/queries";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { paymentTypeLabel } from "../../../components/pickers/PaymentTypeSelect";
import { ShipmentChannelBadge } from "../../../components/badges/ShipmentChannelBadge";
import { formatUnixDateTime } from "../../../lib/datetime";
import { formatRupiah } from "../../../lib/money";
import { RESTOCK_SELLING_DETAIL_PENDING as PENDING } from "../pending";

export interface InfoPanelProps {
  request: RestockRequest;
  /** The READING team — the one that raised it, and whose account paid. */
  teamId: bigint;
  /** The destination warehouse's name; empty falls back to naming the id. */
  warehouseName: string;
}

// INFO — THE PARCEL, THE MONEY, AND WHAT THE WAREHOUSE PAID AT THE DOOR.
//
// Three cards, because they are three different questions:
//
//   Delivery — where it is going and how: the warehouse, the courier, the tracking number (and a photo of the label)
//              that finds the box at the door (the-receipt-is-the-tracking-number, a-restock-is-one-parcel).
//   Payment  — what this team paid when it raised it: which account (a-restock-names-its-paying-account), against which
//              invoice (a-restock-has-one-invoice), and the TOTAL — goods plus shipping, nothing else
//              (the-couriers-charge-stays-out-of-total). It is the amount the account was charged.
//   The courier's charge — once accepted, what the WAREHOUSE paid the courier at the door, owed back by this team
//              (the-warehouse-cost-is-the-couriers-charge-at-the-door). Its own card, never a line under the total:
//              adding it in would make the total disagree with the account it came from.
//
// EVERY CARD IS maxW="full", and long tokens break: a tracking number or an invoice number pasted from a marketplace is
// one unbroken word, and without that it widens the card, the panel and the page.
export function InfoPanel({ request, teamId, warehouseName }: InfoPanelProps) {
  const { t } = useTranslation();

  const account = useFinancialAccount(teamId, request.financeAccountId);
  const channels = useShipmentChannelsByIds([request.shipmentId]);

  // A restock raised before paying accounts names a payment TYPE instead — read-only history.
  const paidFrom =
    request.financeAccountId > 0n
      ? (account.data?.name ?? t("restock.detail.accountRef", { id: request.financeAccountId.toString() }))
      : paymentTypeLabel(t, request.paymentType);

  const accepted = request.status === RestockRequestStatus.ACCEPTED;
  const charge = courierCharge(request);

  return (
    <Stack gap="section" data-testid="restock-detail-info">
      <Card.Root maxW="full" overflow="hidden">
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("restock.detail.delivery")}
            </Text>
            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
              <DetailField
                label={t("restock.detail.destination")}
                value={warehouseName}
                testId="restock-detail-warehouse"
              />
              <DetailField
                label={t("restock.detail.courier")}
                testId="restock-detail-courier"
                value={
                  <HStack gap="1.5">
                    <ShipmentChannelBadge
                      channelId={request.shipmentId}
                      channel={channels.data?.get(request.shipmentId.toString())}
                    />
                    <NotImplemented list={PENDING} id="courier" />
                  </HStack>
                }
              />
              <DetailField
                label={t("restock.detail.tracking")}
                testId="restock-detail-tracking"
                value={
                  <Stack gap="0.5">
                    <Text as="span">{request.receipt || "—"}</Text>
                    <ReceiptPhoto url={request.receiptFile} />
                  </Stack>
                }
              />
              <DetailField label={t("restock.detail.created")} value={formatUnixDateTime(request.createdAtUnix)} />
              <DetailField
                label={t("restock.detail.arrivedAt")}
                value={request.arrivedAtUnix > 0n ? formatUnixDateTime(request.arrivedAtUnix) : ""}
                testId="restock-detail-arrived-at"
              />
            </SimpleGrid>
          </Stack>
        </Card.Body>
      </Card.Root>

      <Card.Root maxW="full" overflow="hidden">
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("restock.detail.payment")}
            </Text>
            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
              <DetailField
                label={t("restock.detail.paidFrom")}
                testId="restock-detail-paid-from"
                value={
                  <HStack gap="1.5">
                    <Text as="span">{paidFrom || "—"}</Text>
                    <NotImplemented list={PENDING} id="payingAccount" />
                  </HStack>
                }
              />
              <DetailField
                label={t("restock.detail.invoice")}
                value={request.invoiceRefId}
                testId="restock-detail-invoice"
              />
            </SimpleGrid>

            <Separator />

            {/* Goods + shipping = the total, and the total is what the paying account was charged. */}
            <Stack gap="1" align="end">
              <MoneyLine label={t("restock.detail.subtotal")} value={goodsTotal(request.items)} testId="restock-detail-subtotal" />
              <MoneyLine label={t("restock.detail.shipping")} value={request.shipmentCost} testId="restock-detail-shipping" />
              <Text fontSize="md" fontWeight="semibold" data-testid="restock-detail-total">
                {t("restock.detail.total")}: {formatRupiah(committedValue(request))}
              </Text>
            </Stack>
          </Stack>
        </Card.Body>
      </Card.Root>

      {/* ONLY ONCE ACCEPTED — the charge is entered at accept, so before then there is nothing to owe. */}
      {accepted && (
        <Card.Root maxW="full" overflow="hidden" data-testid="restock-detail-courier-charge-card">
          <Card.Body>
            <Stack gap="card">
              <Text fontSize="sm" fontWeight="medium" color="fg.muted">
                {t("restock.detail.courierCharge")}
              </Text>
              {charge > 0n ? (
                <Stack gap="1">
                  <Text fontSize="md" fontWeight="semibold" data-testid="restock-detail-courier-charge">
                    {formatRupiah(charge)}
                  </Text>
                  <Text fontSize="sm" wordBreak="break-word" data-testid="restock-detail-courier-charge-note">
                    {request.warehouseAdditionalCostNote}
                  </Text>
                  <Text fontSize="xs" color="fg.muted">
                    {t("restock.detail.courierChargeOwedBySelling", { warehouse: warehouseName })}
                  </Text>
                </Stack>
              ) : (
                <Text fontSize="sm" color="fg.muted" data-testid="restock-detail-courier-charge-none">
                  {t("restock.detail.courierChargeNone")}
                </Text>
              )}
            </Stack>
          </Card.Body>
        </Card.Root>
      )}

      {/* The restock note — the selling team's, about the restock as a whole (three-notes-one-writer-each). */}
      <Card.Root maxW="full" overflow="hidden">
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("restock.detail.note")}
            </Text>
            <Text fontSize="sm" whiteSpace="pre-wrap" wordBreak="break-word" data-testid="restock-detail-note">
              {request.note || "—"}
            </Text>
          </Stack>
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}

function MoneyLine({ label, value, testId }: { label: string; value: bigint; testId: string }) {
  return (
    <Text fontSize="sm" color="fg.muted">
      {label}:{" "}
      <Text as="span" color="fg" data-testid={testId}>
        {formatRupiah(value)}
      </Text>
    </Text>
  );
}

// The photo of the label — a link out, since it is somebody's phone picture rather than something to lay out here.
function ReceiptPhoto({ url }: { url: string }) {
  const { t } = useTranslation();

  return (
    <HStack gap="1.5">
      {url ? (
        <Link href={url} target="_blank" rel="noreferrer" fontSize="xs" data-testid="restock-detail-receipt-photo">
          <Icon as={ExternalLink} boxSize="3" />
          {t("restock.detail.receiptPhoto")}
        </Link>
      ) : (
        <Text as="span" fontSize="xs" color="fg.muted">
          {t("restock.detail.noReceiptPhoto")}
        </Text>
      )}
      <NotImplemented list={PENDING} id="receiptPhoto" />
    </HStack>
  );
}
