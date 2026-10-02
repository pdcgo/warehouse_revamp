import type { ReactNode } from "react";
import { Badge, Box, Flex, SimpleGrid, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import {
  formatMarginPct,
  orderMargin,
  orderMarginPct,
  orderSpend,
} from "../../../features/orders/margin";
import { formatRupiah } from "../../../lib/money";
import { CopyText } from "../../../components/chrome/CopyText";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { ORDER_DETAIL_PENDING } from "../pending";

// FOUR NUMBERS TO LAND ON — "is this order OK" before any scrolling.
//
// The page below is the working: the lines, the perincian, the journey. These tiles are its answer,
// set big and first so the eye has somewhere to land. The perincian stays as the derivation; this does
// not replace it, it summarises it.
//
// ⚠ THE SAME ARITHMETIC AS THE PERINCIAN AND THE LIST — `features/orders/margin.ts`, so a tile and the
// panel under it (and the list row that led here) cannot disagree about the same order.
//
// ⚠ EVERY FIGURE IS COPYABLE, AS A PLAIN NUMBER (owner: *"yang di atas belum copyable seperti total MP
// dsb"*). It shows as rupiah and copies as digits — "245000", not "Rp 245.000" — because the paste goes
// into a spreadsheet or a marketplace's own form, where the formatted string arrives as text.
//
// ⚠ ONLY THE MARGIN TILE IS COLOURED, and in its ROLE: success above zero, error below. A loss-making
// order is the one somebody must not read past; the other three are facts, and painting them would make
// the one that matters just another coloured box.
export function SummaryTiles({
  marketplaceTotal,
  productCost,
  fees,
  itemCount,
}: {
  marketplaceTotal: bigint;
  /** Σ line cost; 0 when any line's cost is unknown — the tiles then refuse, like the panel. */
  productCost: bigint;
  fees: bigint;
  itemCount: number;
}) {
  const { t } = useTranslation();

  const spend = orderSpend(productCost, fees, productCost > 0n);
  const margin = orderMargin(marketplaceTotal, spend);
  const pct = formatMarginPct(orderMarginPct(marketplaceTotal, spend));
  const tone = margin === null ? undefined : margin < 0n ? "error" : "success";

  return (
    <SimpleGrid minChildWidth="10rem" gap="card" data-testid="summary-tiles">
      <Tile label={t("orderDetail.money.marketplaceTotal")} testId="tile-mp">
        {marketplaceTotal > 0n ? <Amount value={marketplaceTotal} /> : "—"}
      </Tile>

      {/* ⚠ BOTH THIS AND THE MARGIN CARRY THE FEE MARK — each is built on the invented warehouse fee.
          A big confident number at the top of the page is the last place a sample may go unmarked. */}
      <Tile
        label={t("orderDetail.money.systemTotal")}
        mark={<NotImplemented list={ORDER_DETAIL_PENDING} id="totalFee" />}
        testId="tile-system"
      >
        {spend === null ? "—" : <Amount value={spend} />}
      </Tile>

      <Tile
        label={t("orderDetail.money.margin")}
        tone={tone}
        mark={<NotImplemented list={ORDER_DETAIL_PENDING} id="totalFee" />}
        testId="tile-margin"
      >
        <Flex gap="2" align="center" wrap="wrap">
          {margin === null ? "—" : <Amount value={margin} />}
          {pct !== null && tone && (
            <Badge colorPalette={tone} variant="solid" size="sm">
              {pct}
            </Badge>
          )}
        </Flex>
      </Tile>

      <Tile label={t("orderDetail.tiles.items")} testId="tile-items">
        <CopyText
          value={String(itemCount)}
          display={t("orderDetail.tiles.pieces", { count: itemCount })}
          fontSize="lg"
        />
      </Tile>
    </SimpleGrid>
  );
}

function Tile({
  label,
  tone,
  mark,
  children,
  testId,
}: {
  label: string;
  /** The ⚠ of a figure that is partly invented. */
  mark?: ReactNode;
  /** A role palette — only the margin tile passes one. */
  tone?: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor={tone ? `${tone}.muted` : "border"}
      bg={tone ? `${tone}.subtle` : "bg"}
      rounded="l2"
      p="card"
      data-testid={testId}
    >
      <Flex gap="1" align="center">
        <Text fontSize="xs" color={tone ? `${tone}.fg` : "fg.muted"} fontWeight="bold">
          {label}
        </Text>
        {mark}
      </Flex>
      <Box fontSize="lg" fontWeight="bold" mt="1" whiteSpace="nowrap">
        {children}
      </Box>
    </Box>
  );
}

/** A rupiah figure that shows formatted and copies as digits. */
function Amount({ value }: { value: bigint }) {
  return <CopyText value={value.toString()} display={formatRupiah(value)} fontSize="lg" />;
}
