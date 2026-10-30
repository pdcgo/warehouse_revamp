import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { HStack, Portal, Stack, Text, Tooltip } from "@chakra-ui/react";

import type { OwnerStockRow } from "../../../features/products/adapt";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { withMarkup } from "../../../lib/markup";
import { formatRupiahRange } from "../../../lib/money";
import { DISCOVER_PENDING } from "../pending";
import { sampleCostRange } from "../sampleMock";

// THE PRICE ON A DISCOVER CARD (owner: *"secara default yang muncul di sini adalah harga cross, tapi khusus untuk team yang
// login atau contextnya dipilih, boleh menampilkan harga asli dan harga cross"*, `discover-shows-the-cross-price`) — and
// HOW it reads (owner: *"keterangan harga kasih warna merah, harga apa tidak perlu diberi label tooltips saja, harga modal
// kalau tampil di bawah harga cross dan lebih kecil warnanya hitam saja"*, `a-discover-price-is-red-and-unlabelled`):
//
//   another team's product         the team standing here's own
//   Rp 79.000 – Rp 81.000 ⚠        Rp 51.412 – Rp 53.100      ← the cross price: red, bold
//                                  Rp 45.700 – Rp 47.200      ← the cost: under it, smaller, the body ink
//
// No labels — a hover says which price is which, and the spoken label says it too. What a borrower pays is the cross price,
// so that is what every card says; what the owner paid is the owner's to see, only on the team's own products.
//
// ⚠ Another team's cost cannot be read across teams yet, so its cross price is a SAMPLE (pending.ts `crossPrice`); the
// own products' figures are real, from OwnerStockByIds. A product none of whose units was ever costed reads a dash.
export function DiscoverPrice({
  productId,
  markupBps,
  own,
  stock,
}: {
  productId: bigint;
  markupBps: number;
  /** The team standing here owns it — then the cost shows too, and the figures are real. */
  own: boolean;
  /** The owner's figures — only ever for an own product. */
  stock?: OwnerStockRow;
}) {
  const { t } = useTranslation();

  if (own) {
    const known = stock?.costKnown === true;

    return (
      <Stack gap="0" data-testid={`discover-price-${productId}`} data-own="true">
        <Price
          hint={t("discover.price.crossHint")}
          label={t("discover.price.cross")}
          value={
            known
              ? formatRupiahRange(withMarkup(stock.costMin, markupBps), withMarkup(stock.costMax, markupBps))
              : "—"
          }
          cross
          testId={`discover-price-cross-${productId}`}
        />
        <Price
          hint={t("discover.price.costHint")}
          label={t("discover.price.cost")}
          value={known ? formatRupiahRange(stock.costMin, stock.costMax) : "—"}
          testId={`discover-price-cost-${productId}`}
        />
      </Stack>
    );
  }

  const sample = sampleCostRange(productId);

  return (
    <Stack gap="0" data-testid={`discover-price-${productId}`}>
      <Price
        hint={t("discover.price.crossHint")}
        label={t("discover.price.cross")}
        value={formatRupiahRange(withMarkup(sample.min, markupBps), withMarkup(sample.max, markupBps))}
        cross
        mark={<NotImplemented list={DISCOVER_PENDING} id="crossPrice" />}
        testId={`discover-price-cross-${productId}`}
      />
    </Stack>
  );
}

// One price, unlabelled: the figure, and what it is in a tooltip and in its spoken label. The CROSS price is the card's
// red, bold figure; the cost under it is smaller, in the body ink.
function Price({
  hint,
  label,
  value,
  cross = false,
  mark,
  testId,
}: {
  /** What the price is — the tooltip. */
  hint: string;
  /** Its name, for the spoken label ("Cross Rp 79.000"). */
  label: string;
  value: string;
  cross?: boolean;
  mark?: ReactNode;
  testId: string;
}) {
  return (
    <HStack gap="1" minW="0" align="center">
      <Tooltip.Root openDelay={100} closeDelay={80}>
        <Tooltip.Trigger asChild>
          <Text
            fontSize={cross ? "sm" : "xs"}
            fontWeight={cross ? "bold" : undefined}
            color={cross ? "price.fg" : "fg"}
            aria-label={`${label} ${value}`}
            data-testid={testId}
          >
            {value}
          </Text>
        </Tooltip.Trigger>
        <Portal>
          <Tooltip.Positioner>
            <Tooltip.Content>{hint}</Tooltip.Content>
          </Tooltip.Positioner>
        </Portal>
      </Tooltip.Root>
      {mark}
    </HStack>
  );
}
