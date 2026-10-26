import { useTranslation } from "react-i18next";
import { Badge, Box, HStack, Stack, Text } from "@chakra-ui/react";

import type { OwnerStockRow } from "../../../features/products/adapt";
import { LOW_STOCK_PCS } from "../../../features/products/stockAge";
import { formatRupiah } from "../../../lib/money";

// THE ONE THING THAT STANDS OUT (owner: *"karena tidak ada yang menonjol selain gambar, aku ingin sesuatu yang
// menonjol"*, then *"yups"* to the proposal, `the-stock-headline-stands-out`) — the answer to why somebody opened a
// product's page: how much is READY to sell, and is the stock healthy. One large figure beside the picture, a status
// chip that is read from across the shelf, and what is on its way and what the ready units cost under it. Across every
// warehouse, as the rest of Info.

export type StockStatus = "out" | "low" | "ok";

/**
 * HOW MUCH IS LEFT, and nothing else (owner: *"stok bisa aman, habis dan hampir habis"*, then *"oke di bawah 5"*,
 * `the-stock-chip-says-how-much-is-left`): nothing ready → Habis; under LOW_STOCK_PCS → Hampir habis; otherwise Aman.
 * The stock's AGE stays on the Umur stok row's warning tone, and a minimum lock in force on the lock's own badge — the
 * chip answers one question. Undefined while the stock read is in flight — no chip rather than a guess.
 */
export function stockStatus(stock: OwnerStockRow | undefined): StockStatus | undefined {
  if (!stock) return undefined;
  if (stock.readyQty <= 0n) return "out";
  if (stock.readyQty < BigInt(LOW_STOCK_PCS)) return "low";
  return "ok";
}

// Each status in its ROLE's tone — a status is never a hue (theme.ts).
const TONE: Record<StockStatus, string> = { out: "error", low: "warning", ok: "success" };

export function StockHighlight({ stock, testId = "pd-highlight" }: { stock?: OwnerStockRow; testId?: string }) {
  const { t } = useTranslation();
  const status = stockStatus(stock);

  return (
    <Stack gap="1" data-testid={testId}>
      <HStack gap="3" align="center" wrap="wrap">
        <Text textStyle="3xl" fontWeight="bold" lineHeight="1.1" data-testid={`${testId}-ready`}>
          {stock ? t("products.detail.highlight.ready", { n: stock.readyQty.toString() }) : "—"}
        </Text>
        {status && (
          <Badge
            size="lg"
            variant="subtle"
            colorPalette={TONE[status]}
            gap="1.5"
            data-testid={testId === "pd-highlight" ? "pd-stock-status" : `${testId}-status`}
            data-status={status}
            title={t(`products.detail.highlight.why.${status}`, { n: LOW_STOCK_PCS })}
          >
            <Box boxSize="2" borderRadius="full" bg={`${TONE[status]}.solid`} />
            {t(`products.detail.highlight.status.${status}`)}
          </Badge>
        )}
      </HStack>
      <Text fontSize="sm" color="fg.muted" data-testid={`${testId}-line`}>
        {stock
          ? `${t("products.detail.highlight.ongoing", { n: stock.ongoingQty.toString() })} · ${t("products.detail.highlight.value", { value: formatRupiah(stock.readyValue) })}`
          : t("products.stat.pending")}
      </Text>
    </Stack>
  );
}
