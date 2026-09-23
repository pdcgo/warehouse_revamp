import { Badge, Card, Flex, Separator, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { formatRupiah } from "../../../lib/money";
import { NotImplemented } from "./NotImplemented";

/** The floor the owner set: an order under this much margin gets a red warning on the form. */
export const MINIMUM_MARGIN_PCT = 35;

// IS THIS ORDER WORTH TAKING — the margin between what the customer paid and what the order costs us.
//
// The three rows ARE the arithmetic — sell price, order total, what is left — so the percentage
// under them is reproducible without the sum being spelled out a second time (owner: the formula
// line is gone). The rule it applies is still open, which is what mark 4 at the top says.
//
// The base here is the SELL PRICE — margin, not markup. Against the cost base the same 35% is a much
// weaker test (35% margin ≈ 54% markup), so the two are not interchangeable and the panel names which
// one it used.
//
// ⚠ IT WARNS, IT DOES NOT BLOCK. Shipping is missing from the cost (nothing prices a shipment yet),
// so every estimate on this screen reads HIGH — a hard gate on a number we know is optimistic would
// refuse good orders and pass bad ones.

interface ProfitEstimatePanelProps {
  /** What the customer paid on the marketplace. `0n` = nobody wrote it down. */
  sellPrice: bigint;
  /** The products plus the warehouse fee — shipping is not in it yet (mark 5). */
  orderTotal: bigint;
  /** Collapse the explanation, leaving the figures. */
  compact?: boolean;
}

export function ProfitEstimatePanel({ sellPrice, orderTotal, compact }: ProfitEstimatePanelProps) {
  const { t } = useTranslation();

  const known = sellPrice > 0n;
  const profit = sellPrice - orderTotal;
  // Integer maths up to the ratio — rupiah are bigint, and only the percentage becomes a float.
  const pct = known ? Number((profit * 10000n) / sellPrice) / 100 : 0;
  const below = known && pct < MINIMUM_MARGIN_PCT;

  return (
    <Card.Root>
      <Card.Header pb={compact ? "0" : undefined}>
        <Flex align="center" gap="2" wrap="wrap">
          <Card.Title>{t("orderForm.profit.title")}</Card.Title>
          <NotImplemented id="profit" />
        </Flex>
        {!compact && (
          <Card.Description>{t("orderForm.profit.help", { pct: MINIMUM_MARGIN_PCT })}</Card.Description>
        )}
      </Card.Header>

      <Card.Body pt={compact ? "3" : undefined} pb={compact ? "3" : undefined}>
        <Stack gap={compact ? "1" : "2"}>
          <Row label={t("orderForm.profit.sellPrice")} value={known ? formatRupiah(sellPrice) : "—"} />
          <Row label={t("orderForm.profit.orderTotal")} value={formatRupiah(orderTotal)} muted />

          <Separator />

          <Row label={t("orderForm.profit.profit")} value={known ? formatRupiah(profit) : "—"} bold />

          {!known && !compact && (
            <Text fontSize="xs" color="fg.muted" data-testid="profit-no-sell-price">
              {t("orderForm.profit.noSellPrice")}
            </Text>
          )}

          {known && (
            <Flex align="center" justify="space-between" gap="2" wrap="wrap">
              <Text fontSize="sm">{t("orderForm.profit.margin")}</Text>
              <Flex align="center" gap="2">
                <Text
                  fontSize="sm"
                  fontWeight="bold"
                  color={below ? "error.fg" : "success.fg"}
                  data-testid="profit-margin"
                >
                  {pct.toFixed(1)}%
                </Text>
                {below && (
                  <Badge colorPalette="error" size="sm" data-testid="profit-below">
                    {t("orderForm.profit.below", { pct: MINIMUM_MARGIN_PCT })}
                  </Badge>
                )}
              </Flex>
            </Flex>
          )}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}

function Row({
  label,
  value,
  bold,
  muted,
}: {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <Flex align="baseline" justify="space-between" gap="card">
      <Text fontSize="sm" color={muted ? "fg.muted" : undefined}>
        {label}
      </Text>
      <Text fontSize="sm" fontWeight={bold ? "bold" : undefined}>
        {value}
      </Text>
    </Flex>
  );
}
