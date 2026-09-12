import { Heading, HStack, Stack, Text } from "@chakra-ui/react";
import { Download, Receipt } from "lucide-react";
import { Breadcrumb } from "../../components/display/Breadcrumb";
import { Card } from "../../components/display/Card";
import { Alert } from "../../components/display/Alert";
import { DataTable, type TableColumn } from "../../components/display/DataTable";
import { Button } from "../../components/inputs/Button";
import { DateText } from "../../components/text/DateText";
import { PriceText } from "../../components/text/PriceText";
import { ProgressBar } from "../../components/feedback/ProgressBar";
import type { InvoiceDirection, InvoiceLine, InvoiceRow, PaymentRow } from "../../financeFixtures";
import { InvoiceStatusBadge } from "./InvoiceStatusBadge";

// ── ONE INVOICE ─────────────────────────────────────────────────────────────────────────────────
//
// Shared between the payable and receivable detail screens; the direction only changes the words.
//
// The decision the screen is built around: THE OUTSTANDING AMOUNT IS THE HEADLINE, not the total.
// An invoice's total stops being interesting the moment anything is paid against it — what somebody
// opening this screen wants is "how much is still owed, and when was it last chased". So the
// outstanding figure is largest, with a bar showing how much of the total it represents, and the
// payments that got it there are listed beneath.
//
// The lines are secondary here, which is the opposite of an ORDER detail. An invoice is a claim, not
// a shipment: the argument is about the money.
export const description =
  "One invoice, shared by both directions. The OUTSTANDING amount is the headline rather than the total — a total stops being interesting the moment anything is paid against it.";

export interface InvoiceDetailScreenProps {
  invoice: InvoiceRow;
  lines: InvoiceLine[];
  payments: PaymentRow[];
  direction: InvoiceDirection;
}

export function InvoiceDetailScreen({
  invoice,
  lines,
  payments,
  direction,
}: InvoiceDetailScreenProps) {
  const outstanding = invoice.total - invoice.paid;
  const percentPaid = invoice.total > 0n ? (Number(invoice.paid) / Number(invoice.total)) * 100 : 0;
  const listHref = direction === "payable" ? "/invoices/payable" : "/invoices/receivable";

  const lineColumns: Array<TableColumn<InvoiceLine>> = [
    { name: "Description", key: "description" },
    { name: "Qty", key: "qty", align: "end" },
    { name: "Unit", align: "end", render: (l) => <PriceText amount={l.unitPrice} /> },
    {
      name: "Amount",
      align: "end",
      render: (l) => <PriceText amount={l.unitPrice * BigInt(l.qty)} fontWeight="medium" />,
    },
  ];

  const paymentColumns: Array<TableColumn<PaymentRow>> = [
    { name: "When", render: (p) => <DateText value={p.at} variant="date" /> },
    { name: "Method", key: "method" },
    { name: "Reference", key: "reference" },
    {
      name: "Amount",
      align: "end",
      render: (p) => <PriceText amount={p.amount} fontWeight="medium" />,
    },
    {
      name: "",
      // An UNCONFIRMED payment is money somebody says arrived but that no statement has matched. It
      // is shown, and marked — hiding it would make the outstanding figure look wrong, and treating
      // it as settled would make it look right when it is not.
      render: (p) =>
        p.confirmed ? null : (
          <Text fontSize="xs" color="fg.muted" data-testid="payment-unconfirmed">
            awaiting confirmation
          </Text>
        ),
    },
  ];

  return (
    <Stack gap="section" data-testid="invoice-detail-screen" data-direction={direction}>
      <Breadcrumb
        items={[
          { href: listHref, name: direction === "payable" ? "Payable" : "Receivable" },
          { name: invoice.code },
        ]}
      />

      <HStack justify="space-between" wrap="wrap" gap="card">
        <HStack gap="3">
          <Heading size="md">{invoice.code}</Heading>
          <InvoiceStatusBadge status={invoice.status} />
        </HStack>
        <HStack gap="2">
          <Button tone="plain" variant="outline" icon={Download}>
            Download
          </Button>
          <Button icon={Receipt} data-testid="invoice-record-payment">
            Record payment
          </Button>
        </HStack>
      </HStack>

      {invoice.status === "overdue" && (
        <Alert tone="error" title="Past its due date">
          This invoice was due <DateText value={invoice.dueAt} variant="relative" />.
        </Alert>
      )}

      {/* The headline: what is still owed. */}
      <Card>
        <Stack gap="card">
          <HStack justify="space-between" wrap="wrap" gap="section">
            <Stack gap="0.5">
              <Text fontSize="xs" color="fg.muted">
                {direction === "payable" ? "Still to pay" : "Still owed"}
              </Text>
              <PriceText
                amount={outstanding}
                fontSize="2xl"
                fontWeight="black"
                data-testid="invoice-outstanding"
              />
            </Stack>
            <Stack gap="0.5">
              <Text fontSize="xs" color="fg.muted">
                Invoice total
              </Text>
              <PriceText amount={invoice.total} />
            </Stack>
            <Stack gap="0.5">
              <Text fontSize="xs" color="fg.muted">
                {invoice.counterparty}
              </Text>
              <DateText value={invoice.issuedAt} variant="date" />
            </Stack>
          </HStack>

          <ProgressBar
            percent={percentPaid}
            tone={percentPaid >= 100 ? "success" : invoice.status === "overdue" ? "error" : "active"}
          />
        </Stack>
      </Card>

      <Stack gap="2">
        <Text fontWeight="medium">Payments</Text>
        <DataTable
          columns={paymentColumns}
          items={payments}
          size="sm"
          emptyTitle="Nothing paid yet"
          emptyContent="Payments recorded against this invoice appear here."
          aria-label="Payments"
        />
      </Stack>

      <Stack gap="2">
        <Text fontWeight="medium">Lines</Text>
        <DataTable columns={lineColumns} items={lines} size="sm" aria-label="Invoice lines" />
      </Stack>
    </Stack>
  );
}
