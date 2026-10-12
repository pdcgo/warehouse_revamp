import { Badge, Box, Flex, Separator, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { NotImplemented } from "../../../features/pending/NotImplemented";
import {
  formatMarginPct,
  orderMargin,
  orderMarginPct,
  orderSpend,
} from "../../../features/orders/margin";
import { formatRupiah } from "../../../lib/money";
import { ORDER_DETAIL_PENDING } from "../pending";
import { MarginBar } from "./MarginBar";

// THE PERINCIAN UNDER THE LINES — the owner's derivation, written out one step at a time.
//
//     total produk (harga beli)  +  biaya lain (gudang)  =  TOTAL SISTEM
//     total MP  −  total sistem  =  MARGIN (estimasi)  ·  %
//
// ⚠ THIS IS THE LIST'S `Beli · Margin` CELL, SHOWN AS ITS WORKING. That is the relationship a detail
// page should have with its list: the same two numbers, with the steps that produced them. Both read
// `features/orders/margin.ts`, so the row and this panel cannot disagree.
//
// ⚠ "TOTAL PRODUK" IS THE COST SIDE, and that is an inference worth stating because the owner's words
// allow two readings. The deciding line is *"lalu ada persentase seperti tabel list"*: the list's
// percentage is `margin ÷ harga MP` where margin is `harga MP − (cogs + biaya)`. For this panel to
// show the SAME percentage, its `total sistem` has to be that same `cogs + biaya`. So the lines above
// are priced at what we PAID, and the column says `Harga beli` rather than just `Harga`.
//
// ⚠ AND THE OWNER WROTE THE SUBTRACTION THE OTHER WAY UP — *"total sistem dikurangi lagi dengan total
// mp menjadi margin"*. Taken literally that is cost − revenue, which is the margin negated. Rendered
// as written, a healthy order would read as a loss on every row, so it is rendered as the list does
// it and the wording is a question rather than a silent correction.
//
// ⚠ IT IS AN ESTIMATE AND SAYS SO (owner: *"margin yang masih estimasi"*). Two reasons, and they are
// different: the warehouse fee is invented, and what the marketplace actually deducts beyond the price
// only lands weeks later on the settlement ledger.
export function MoneyBreakdown({
  productCost,
  fees,
  marketplaceTotal,
}: {
  /** Σ line `unit_cost × quantity` — what the goods cost us. 0 = never recorded. */
  productCost: bigint;
  /** The warehouse's fee for fulfilling this order. SAMPLE. */
  fees: bigint;
  /** `marketplace_total` — what the buyer paid the platform. 0 = not recorded. */
  marketplaceTotal: bigint;
}) {
  const { t } = useTranslation();

  const known = productCost > 0n;
  const spend = orderSpend(productCost, fees, known);
  const margin = orderMargin(marketplaceTotal, spend);
  const pct = formatMarginPct(orderMarginPct(marketplaceTotal, spend));

  return (
    // ⚠ A FULL-WIDTH PANEL, NOT A NARROW COLUMN (owner: *"terlalu sempit"*, then *"perbesar
    // cardnya"* — the CARD grows, the text stays its size). It was a 28rem strip of 4px-spaced lines
    // tucked under the table's right edge — the arithmetic the whole order comes down to, set
    // smaller and tighter than the table above it. Now it has room, a ground of its own, and air
    // between the steps, so each line reads as a step rather than as a paragraph.
    <Box
      w="full"
      // `bg.muted`, not `bg.subtle`: the card under it is already `bg.subtle`-white in light mode,
      // so the panel vanished into it.
      bg="bg.muted"
      rounded="l2"
      p={{ base: "card", md: "section" }}
      data-testid="order-money-breakdown"
    >
    <Stack gap="3">
      <Line label={t("orderDetail.money.productTotal")} value={known ? productCost : null} />

      <Line
        label={t("orderDetail.money.fees")}
        value={fees}
        mark={<NotImplemented list={ORDER_DETAIL_PENDING} id="totalFee" />}
      />

      <Separator />

      <Line label={t("orderDetail.money.systemTotal")} value={spend} strong testId="money-system" />

      {/* ⚠ 0 IS NOT RECORDED, not "sold for nothing" (`order.proto`) — an order taken over the phone
          has no marketplace figure at all. */}
      <Line
        label={t("orderDetail.money.marketplaceTotal")}
        value={marketplaceTotal > 0n ? marketplaceTotal : null}
        testId="money-mp"
      />

      <Separator />

      {/* THE LINE THE PANEL EXISTS FOR, set largest. The percentage is a badge in its ROLE colour —
          success above zero, error below — because a loss-making order is the one somebody must not
          read past. */}
      <Flex justify="space-between" gap="4" align="center" wrap="wrap" data-testid="money-margin">
        <Text fontWeight="bold" fontSize="md">
          {t("orderDetail.money.margin")}
        </Text>
        <Flex gap="2" align="center">
          <Text fontWeight="bold" fontSize="md" whiteSpace="nowrap">
            {margin === null ? "—" : formatRupiah(margin)}
          </Text>
          {pct !== null && margin !== null && (
            <Badge colorPalette={margin < 0n ? "error" : "success"} variant="subtle" size="sm">
              {pct}
            </Badge>
          )}
        </Flex>
      </Flex>

      <MarginBar marketplaceTotal={marketplaceTotal} productCost={productCost} fees={fees} />

      <Text fontSize="xs" color="fg.muted" lineHeight="tall">
        {t("orderDetail.money.marginHelp")}
      </Text>
    </Stack>
    </Box>
  );
}

/** One row of the derivation. `null` is an em-dash — unknown, never a zero. */
function Line({
  label,
  value,
  strong,
  mark,
  testId,
}: {
  label: string;
  value: bigint | null;
  strong?: boolean;
  mark?: React.ReactNode;
  testId?: string;
}) {
  return (
    <Flex justify="space-between" gap="4" align="baseline" data-testid={testId}>
      <Flex gap="1" align="center" minW="0">
        <Text
          fontWeight={strong ? "bold" : undefined}
          fontSize={strong ? "md" : undefined}
          color={strong ? undefined : "fg.muted"}
        >
          {label}
        </Text>
        {mark}
      </Flex>
      <Text fontWeight={strong ? "bold" : undefined} fontSize={strong ? "md" : undefined} whiteSpace="nowrap">
        {value === null ? "—" : formatRupiah(value)}
      </Text>
    </Flex>
  );
}
