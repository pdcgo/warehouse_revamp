import { useTranslation } from "react-i18next";
import { Card, Flex, Separator, Stack, Text } from "@chakra-ui/react";

import { formatRupiah } from "../../../lib/money";
import { type LineDraft, lineMoney, perPiece, toQty, totals } from "../draft";

// THE MONEY, as the selling team agrees to it: each line at its typed total, the goods, the shipping it paid, and their
// sum. Never the courier's charge at the door — that is the warehouse's, entered at accept and owed back as its own
// debt (the-couriers-charge-stays-out-of-total), and the card says so rather than leaving somebody to wonder why the
// accepted restock later shows a number this one did not.
export function SummaryCard({ lines, shippingCost }: { lines: LineDraft[]; shippingCost: string }) {
  const { t } = useTranslation();
  const { goods, shipping, total } = totals(lines, shippingCost);

  return (
    <Card.Root data-testid="restock-summary">
      <Card.Body>
        <Stack gap="card">
          <Flex align="center" justify="space-between" gap="card">
            <Text fontSize="sm" fontWeight="bold" color="fg.muted">
              {t("restock.form.summary.products")}
            </Text>
            <Text fontSize="sm" fontWeight="bold" data-testid="restock-summary-count">
              {lines.length}
            </Text>
          </Flex>

          <Separator />

          {lines.length === 0 ? (
            <Text fontSize="sm" color="fg.muted">
              {t("restock.form.summary.none")}
            </Text>
          ) : (
            <Stack gap="card">
              {lines.map((line) => (
                <Flex key={line.productId.toString()} gap="card" justify="space-between" align="start">
                  <Stack gap="0" flex="1" minW="0">
                    <Text fontSize="sm" lineClamp={1}>
                      {line.name || line.sku}
                    </Text>
                    <Text fontSize="xs" color="fg.muted">
                      {toQty(line.count)} × {t("restock.form.perPiece", { price: formatRupiah(perPiece(line)) })}
                    </Text>
                  </Stack>
                  <Text fontSize="sm" flexShrink={0}>
                    {formatRupiah(lineMoney(line))}
                  </Text>
                </Flex>
              ))}
            </Stack>
          )}

          <Separator />

          <Flex align="center" justify="space-between" gap="card">
            <Text fontSize="sm" color="fg.muted">
              {t("restock.form.summary.goods")}
            </Text>
            <Text fontSize="sm" fontWeight="bold" data-testid="restock-summary-products">
              {formatRupiah(goods)}
            </Text>
          </Flex>

          <Flex align="center" justify="space-between" gap="card">
            <Text fontSize="sm" color="fg.muted">
              {t("restock.form.summary.shipping")}
            </Text>
            <Text fontSize="sm" fontWeight="bold" data-testid="restock-summary-shipping">
              {formatRupiah(shipping)}
            </Text>
          </Flex>

          <Separator />

          <Flex align="center" justify="space-between" gap="card">
            <Text fontWeight="bold">{t("restock.form.summary.total")}</Text>
            <Text fontSize="lg" fontWeight="bold" data-testid="restock-summary-total">
              {formatRupiah(total)}
            </Text>
          </Flex>

          <Text fontSize="xs" color="fg.muted" data-testid="restock-summary-courier-note">
            {t("restock.form.summary.courierNote")}
          </Text>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
