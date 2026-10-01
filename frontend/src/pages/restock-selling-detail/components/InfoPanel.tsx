import { useTranslation } from "react-i18next";
import { Card, SimpleGrid, Stack, Text } from "@chakra-ui/react";

import type { RestockRequest } from "../../../gen/warehouse/inventory/v1/restock_request_pb";
import { DetailField } from "../../../features/restock/DetailField";
import { paymentTypeLabel } from "../../../components/pickers/PaymentTypeSelect";
import { ShippingBadge } from "../../../components/badges/ShippingBadge";
import { formatRupiah } from "../../../lib/money";

export interface InfoPanelProps {
  request: RestockRequest;
  /** The destination warehouse's name; empty falls back to naming the id. */
  warehouseName: string;
  /** The supplier's name; empty when no supplier is recorded, which is legitimate. */
  supplierName: string;
}

// INFO — WHAT WAS AGREED, AND WITH WHOM.
//
// The tab that answers "what did I buy, from whom, going where, on what terms". Everything here is
// a term of the PURCHASE, which is why the dates and the people are not: when it was raised and who
// accepted it are things that HAPPENED to the request, and they read as a sequence rather than as a
// grid — the Timeline tab.
//
// Nothing on this tab depends on the delivery, so it reads identically whether the request is
// pending, fulfilled or cancelled. That is deliberate: it is the agreement, and cancelling a
// delivery does not change what was ordered.
//
// EVERY CARD IS maxW="full", and the note breaks long words (owner). The Info tab looks like the
// safe one — short labelled values, no table — and it is not: a note is free text up to 1000
// characters, and a tracking number or an order reference pasted from a marketplace is a single
// unbroken token. Neither wraps on its own, so each widens the card, the card widens the panel, and
// the whole page gains a horizontal scrollbar from a field nobody thought of as wide.
export function InfoPanel({
  request,
  warehouseName,
  supplierName,
}: InfoPanelProps) {
  const { t } = useTranslation();

  return (
    <Stack gap="section" data-testid="restock-detail-info">
      {/* WHERE IT IS GOING. No "Requested by" — every restock this page can open was raised by the
          team reading it, so a team field could only repeat the team switcher. The PERSON who raised
          it is a different fact and is on the Timeline. */}
      <Card.Root maxW="full" overflow="hidden">
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("restock.detail.request")}
            </Text>
            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
              <DetailField
                label={t("restock.table.destination")}
                value={warehouseName}
                testId="restock-detail-warehouse"
              />
              <DetailField
                label={t("restock.table.shipment")}
                value={<ShippingBadge code={request.shippingCode} />}
              />
            </SimpleGrid>
          </Stack>
        </Card.Body>
      </Card.Root>

      {/* THE ORDER (#127) — the buying side's own card, and the one the warehouse's copy of this page
          does not have at all. Each field is legitimately absent (0n / ""), and an absent one renders
          the same muted "—" as anywhere else. */}
      <Card.Root maxW="full" overflow="hidden">
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("restock.form.orderDetails")}
            </Text>
            <SimpleGrid columns={{ base: 1, sm: 2 }} gap="card">
              <DetailField
                label={t("restock.form.supplier")}
                value={supplierName}
                testId="restock-detail-supplier"
              />
              <DetailField
                label={t("restock.form.receipt")}
                value={request.receipt}
              />
              {/* #127: a free-text reference to an order living somewhere else (a marketplace, a
                  chat), not an id into this system — so it is shown verbatim, not as "Order #n". */}
              <DetailField
                label={t("restock.form.orderRef")}
                value={request.orderRef}
                testId="restock-detail-order-ref"
              />
              <DetailField
                label={t("restock.form.shippingCost")}
                value={formatRupiah(request.shippingCost)}
                testId="restock-detail-shipping-cost"
              />
              <DetailField
                label={t("restock.form.paymentType")}
                value={paymentTypeLabel(t, request.paymentType)}
                testId="restock-detail-payment-type"
              />
            </SimpleGrid>
          </Stack>
        </Card.Body>
      </Card.Root>

      {/* The restock note (#127). Free text up to 1000 chars, so it gets its own full-width card
          rather than a cell in the grid above. */}
      <Card.Root maxW="full" overflow="hidden">
        <Card.Body>
          <Stack gap="card">
            <Text fontSize="sm" fontWeight="medium" color="fg.muted">
              {t("restock.form.note")}
            </Text>
            <Text
              fontSize="sm"
              whiteSpace="pre-wrap"
              wordBreak="break-word"
              data-testid="restock-detail-note"
            >
              {request.note || "—"}
            </Text>
          </Stack>
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}
