import { Card, Flex, Separator, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { formatRupiah } from "../../../lib/money";

// WHAT THE ORDER COMES TO, AND WHAT WE OWE FOR IT — two totals, one card, and they are not the same
// number.
//
//   ORDER TOTAL  every product on the order + the warehouse's fee. What the order costs us. No shipping term, by
//                design: the buyer pays the platform for the courier and none of it passes through us
//                (an-order-records-no-shipping-cost).
//   INVOICE      only what belongs to SOMEBODY ELSE: each owning team's goods at HPP + each product's markup,
//                plus the warehouse's fee. What this team will be in debt for.
//
// The gap between them is our own goods, which we do not bill ourselves for. Keeping the two in one
// card is deliberate: they are read together ("the order is worth 420k, of which 180k is owed") and
// splitting them across two cards is how a screen ends up showing one and hiding the other.
//
// ⚠ THE MARKUP IS IN THE INVOICE, not just the cost — and it is the PRODUCT's (the-cross-markup-belongs-to-the-product):
// each line is `unit_cost × qty × (1 + that product's markup)`, and an owner's row is the sum of its lines, the shape
// the ledger is to post (the-ledger-charges-the-frozen-line-total). A preview that showed the bare cost would
// disagree with the debt recorded, which is the one thing a preview may not do.
//
// The BUTTONS are not here (owner): Create sits with the note, at the foot of the rail — see
// NoteAndSubmitCard. This card's job ends at the figures.

export interface InvoiceRow {
  teamId: bigint;
  name: string;
  /** The goods at HPP, before the owner's markup. Zero on a fee row. */
  base: bigint;
  /**
   * The markup in basis points, when every line of this owner carries the SAME one — each product has its own
   * (the-cross-markup-belongs-to-the-product). `undefined` = the lines carry different rates, so no one figure is
   * true of the row. Zero on a fee row.
   */
  markupBp: bigint | undefined;
  /** What this creditor is owed: Σ each line × (1 + its product's markup), or the warehouse's fee. */
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
          {/* NO MARK. Every figure on this card is real: the goods at the warehouse's HPP, each product's own
              markup, and the fee the warehouse prices — the same one order create freezes. */}
        </Flex>
        {!compact && <Card.Description>{t("orderForm.totals.help")}</Card.Description>}
      </Card.Header>

      <Card.Body pt={compact ? "3" : undefined} pb={compact ? "3" : undefined}>
        <Stack gap={compact ? "3" : "card"}>
          {/* ── THE ORDER ─────────────────────────────────────────────────────────────────────── */}
          <Stack gap={compact ? "1" : "2"}>
            <Line
              label={t("orderForm.totals.products")}
              value={formatRupiah(productsTotal)}
              testId="order-create-products-total"
            />

            {/* ⚠ NO SHIPPING ROW, by design (an-order-records-no-shipping-cost): the buyer pays the platform
                for the courier, so there is no shipping money on our order to show. */}

            <Line
              label={t("orderForm.totals.warehouseFee")}
              value={formatRupiah(warehouseFee)}
              testId="order-create-warehouse-fee"
            />

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
                      : row.markupBp !== undefined
                        ? t("orderForm.totals.markupNote", {
                            base: formatRupiah(row.base),
                            markup: (Number(row.markupBp) / 100).toFixed(2),
                          })
                        : // MIXED RATES — no single percentage is true of the row, so the markup is said in
                          // rupiah, which is.
                          t("orderForm.totals.markupMixedNote", {
                            base: formatRupiah(row.base),
                            markup: formatRupiah(row.owed - row.base),
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

function Line({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <Flex align="baseline" justify="space-between" gap="card">
      <Text fontSize="sm">{label}</Text>
      <Text fontSize="sm" data-testid={testId}>
        {value}
      </Text>
    </Flex>
  );
}
