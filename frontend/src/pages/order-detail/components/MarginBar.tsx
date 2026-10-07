import { Box, Flex, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

// WHERE THE MARKETPLACE'S MONEY WENT — one bar as wide as harga MP, split into what the goods cost,
// what the warehouse charged, and what was left.
//
// ⚠ IT IS THE PERCENTAGE, DRAWN — not decoration. The margin % is defined as `margin ÷ harga MP`, which
// is exactly the width of the last segment of a bar whose whole width is harga MP. Reading the bar IS
// reading the number.
//
// ⚠ A LOSS DRAWS AS AN OVERFLOW. When the order cost more than the platform paid there is no margin
// segment; the cost itself runs past the end of harga MP, and the part past the end is error-red — the
// order is underwater by that much.
//
// ⚠ NO BAR WITHOUT BOTH FACTS. An unknown cost or an unrecorded marketplace total means there is nothing
// honest to draw; the panel above already says "—", and a bar of guesses would contradict it.
//
// ⚠ ROLE COLOURS ONLY: the goods and the fee in two neutral greys (they are both "spent"), the margin in
// `success`, the overflow in `error`.

export function MarginBar({
  marketplaceTotal,
  productCost,
  fees,
}: {
  marketplaceTotal: bigint;
  productCost: bigint;
  fees: bigint;
}) {
  const { t } = useTranslation();

  if (marketplaceTotal <= 0n || productCost <= 0n) {
    return null;
  }

  const mp = Number(marketplaceTotal);
  const goods = Number(productCost);
  const fee = Number(fees);
  const spend = goods + fee;

  // Everything is measured against the larger of the two, so an underwater order still fits the track.
  const scale = Math.max(mp, spend);
  const pct = (n: number) => `${(n / scale) * 100}%`;
  // ⚠ TENTHS, TRUNCATED — the same rounding `orderMarginPct` uses. Rounded to nearest, the bar's
  // legend said 38,6% under a tile saying 38,5% about the same order.
  const share = (n: number) =>
    `${(Math.trunc((n * 1000) / mp) / 10).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;

  const underwater = spend > mp;
  const margin = mp - spend;

  return (
    <Stack gap="1.5" data-testid="margin-bar" data-underwater={underwater ? "true" : undefined}>
      <Flex h="3" w="full" rounded="full" overflow="hidden" bg="bg.emphasized">
        {underwater ? (
          // The track is the COST; harga MP covers only part of it, and the rest is the loss.
          <>
            <Box w={pct(mp)} bg="gray.solid" title={t("orderDetail.money.marketplaceTotal")} />
            <Box w={pct(spend - mp)} bg="error.solid" title={t("orderDetail.bar.loss")} />
          </>
        ) : (
          <>
            <Box w={pct(goods)} bg="gray.solid" title={t("orderDetail.money.productTotal")} />
            <Box w={pct(fee)} bg="gray.emphasized" title={t("orderDetail.money.fees")} />
            <Box w={pct(margin)} bg="success.solid" title={t("orderDetail.money.margin")} />
          </>
        )}
      </Flex>

      <Flex gap="4" wrap="wrap" fontSize="xs" color="fg.muted">
        <Legend swatch="gray.solid" label={t("orderDetail.money.productTotal")} value={share(goods)} />
        <Legend swatch="gray.emphasized" label={t("orderDetail.money.fees")} value={share(fee)} />
        {underwater ? (
          <Legend swatch="error.solid" label={t("orderDetail.bar.loss")} value={share(-margin)} />
        ) : (
          <Legend swatch="success.solid" label={t("orderDetail.money.margin")} value={share(margin)} />
        )}
      </Flex>
    </Stack>
  );
}

function Legend({ swatch, label, value }: { swatch: string; label: string; value: string }) {
  return (
    <Flex gap="1.5" align="center">
      <Box boxSize="2.5" rounded="sm" bg={swatch} />
      <Text>
        {label} {value}
      </Text>
    </Flex>
  );
}
