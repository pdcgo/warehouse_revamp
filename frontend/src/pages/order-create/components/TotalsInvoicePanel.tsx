import { Card, Flex, Separator, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { formatRupiah } from "../../../lib/money";
import { NotImplemented } from "./NotImplemented";

// WHAT THE ORDER COMES TO, AND WHAT WE OWE FOR IT — two totals, one card, and they are not the same
// number.
//
//   ORDER TOTAL  every product on the order + shipping + the warehouse's fee. What the order is worth.
//   INVOICE      only what belongs to SOMEBODY ELSE: each owning team's goods at HPP + their markup,
//                plus the warehouse's fee. What this team will be in debt for.
//
// The gap between them is our own goods, which we do not bill ourselves for. Keeping the two in one
// card is deliberate: they are read together ("the order is worth 420k, of which 180k is owed") and
// splitting them across two cards is how a screen ends up showing one and hiding the other.
//
// ⚠ THE MARKUP IS IN THE INVOICE, not just the cost. liability posts
// `Σ(unit_cost × qty) × (1 + markup)` per owning team — a preview that showed the bare cost would
// disagree with the debt actually recorded, which is the one thing a preview may not do.
//
// The BUTTONS are not here (owner): Create sits with the note, at the foot of the rail — see
// NoteAndSubmitCard. This card's job ends at the figures.

export interface InvoiceRow {
  teamId: bigint;
  name: string;
  /** The goods at HPP, before the owner's markup. Zero on a fee row. */
  base: bigint;
  /** The owner's markup in basis points. Zero on a fee row. */
  markupBp: bigint;
  /** What this creditor is owed: base × (1 + markup), or the flat fee. */
  owed: bigint;
  kind: "product" | "fee";
}

interface TotalsInvoicePanelProps {
  productsTotal: bigint;
  warehouseFee: bigint;
  orderTotal: bigint;
  invoice: InvoiceRow[];
  invoiceTotal: bigint;
  /** Collapse the explanations, leaving the figures. */
  compact?: boolean;
}

export function TotalsInvoicePanel({
  productsTotal,
  warehouseFee,
  orderTotal,
  invoice,
  invoiceTotal,
  compact,
}: TotalsInvoicePanelProps) {
  const { t } = useTranslation();

  return (
    <Card.Root>
      <Card.Header pb={compact ? "0" : undefined}>
        <Flex align="center" gap="2" wrap="wrap">
          <Card.Title>{t("orderForm.totals.title")}</Card.Title>
          {/* THREE MARKS, THREE NUMBERS — the missing shipping term, the fee that is a sample, and
              the invoice that needs liability's markup. They sit on the title because two of them
              have no row of their own to sit on. */}
          <NotImplemented id="shippingCost" />
          <NotImplemented id="warehouseFee" />
          <NotImplemented id="invoice" />
        </Flex>
        {!compact && <Card.Description>{t("orderForm.totals.help")}</Card.Description>}
      </Card.Header>

      <Card.Body pt={compact ? "3" : undefined} pb={compact ? "3" : undefined}>
        <Stack gap={compact ? "3" : "card"}>
          {/* ── THE ORDER ─────────────────────────────────────────────────────────────────────── */}
          <Stack gap={compact ? "1" : "2"}>
            <Line label={t("orderForm.totals.products")} value={formatRupiah(productsTotal)} />

            {/* ⚠ NO SHIPPING ROW (owner) — nothing prices a shipment, so the field is off the screen
                rather than sitting there as a box to guess into. Its mark rides on the card's title
                instead: the TOTAL is short a term, and an absent term is invisible in a number that
                otherwise looks complete. */}

            {/* No mark on this row: number 6 is already on the card's title, and the same number
                twice on one card reads as two different problems. */}
            <Line label={t("orderForm.totals.warehouseFee")} value={formatRupiah(warehouseFee)} />

            <Separator />

            <Flex align="baseline" justify="space-between" gap="card">
              <Text fontWeight="bold">{t("orderForm.totals.orderTotal")}</Text>
              <Text fontWeight="bold" data-testid="order-create-total">
                {formatRupiah(orderTotal)}
              </Text>
            </Flex>
          </Stack>

          {/* ── THE INVOICE ───────────────────────────────────────────────────────────────────── */}
          <Stack gap={compact ? "1" : "2"}>
            <Text fontWeight="bold" fontSize="sm">
              {t("orderForm.totals.invoiceTitle")}
            </Text>

            {invoice.length === 0 && (
              <Text fontSize="sm" color="fg.muted" data-testid="invoice-empty">
                {t("orderForm.totals.invoiceEmpty")}
              </Text>
            )}

            {invoice.map((row) => (
              <Stack
                key={`${row.kind}-${row.teamId}`}
                gap="0.5"
                data-testid={`invoice-row-${row.kind}-${row.teamId}`}
              >
                <Flex align="baseline" justify="space-between" gap="card">
                  <Text fontSize="sm" truncate>
                    {row.name}
                  </Text>
                  <Text fontSize="sm">{formatRupiah(row.owed)}</Text>
                </Flex>

                {/* HOW the figure was reached — the goods, then the markup on top. A team being
                    billed 1.5% over cost should be able to see the 1.5%.

                    ⚠ A ZERO BASE IS "NOT RECORDED", NEVER "FREE". An HPP the warehouse has not
                    recorded contributes nothing to a total rather than being guessed at — so the row
                    reads Rp 0, and this line is what stops that being read as goods given away. */}
                {/* ⚠ THE UNKNOWN-COST LINE SURVIVES COMPACT MODE. Collapsing hides EXPLANATION,
                    never a warning about the figure beside it: "Rp 0" with nothing under it reads as
                    goods given away. Only the ordinary markup note goes. */}
                {(!compact || (row.kind === "product" && row.base === 0n)) && (
                <Text
                  fontSize="xs"
                  color={row.kind === "product" && row.base === 0n ? "warning.fg" : "fg.subtle"}
                >
                  {row.kind === "fee"
                    ? t("orderForm.totals.feeNote")
                    : row.base === 0n
                      ? t("orderForm.totals.costUnknown")
                      : t("orderForm.totals.markupNote", {
                          base: formatRupiah(row.base),
                          markup: (Number(row.markupBp) / 100).toFixed(2),
                        })}
                </Text>
                )}
              </Stack>
            ))}

            {invoice.length > 0 && (
              <>
                <Separator />
                <Flex align="baseline" justify="space-between" gap="card">
                  <Text fontWeight="bold">{t("orderForm.totals.invoiceTotal")}</Text>
                  <Text fontWeight="bold" data-testid="order-create-invoice-total">
                    {formatRupiah(invoiceTotal)}
                  </Text>
                </Flex>
              </>
            )}
          </Stack>

        </Stack>
      </Card.Body>
    </Card.Root>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <Flex align="baseline" justify="space-between" gap="card">
      <Text fontSize="sm">{label}</Text>
      <Text fontSize="sm">{value}</Text>
    </Flex>
  );
}
