import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Box, HStack, Stack, Text } from "@chakra-ui/react";

import type { OwnerStockRow } from "./adapt";
import { LOW_STOCK_PCS, STOCK_STATUS_TONE as TONE, type StockStatus, readyStatus } from "./stockAge";

// THE ONE THING THAT STANDS OUT (owner: *"karena tidak ada yang menonjol selain gambar, aku ingin sesuatu yang
// menonjol"*, then *"yups"* to the proposal, `the-stock-headline-stands-out`) — the answer to why somebody opened a
// product's page: how much is READY to sell, and is the stock healthy. One large figure beside the picture, a status
// chip that is read from across the shelf, and a line under it. Across every warehouse.
//
// The product's own page writes what is on its way and what the ready units cost under it; the discover detail, what is
// on its way alone — another team's cost is not the reader's to see (the-discover-detail-is-the-product-page).

/**
 * HOW MUCH IS LEFT, and nothing else — the shared rule (`readyStatus`, stockAge.ts). The stock's AGE stays on the Umur
 * stok row's warning tone, and a minimum lock in force on the lock's own badge — the chip answers one question.
 * Undefined while the stock read is in flight — no chip rather than a guess.
 */
export function stockStatus(stock: OwnerStockRow | undefined): StockStatus | undefined {
  return readyStatus(stock?.readyQty);
}

export function StockHighlight({
  ready,
  line,
  testId = "pd-highlight",
}: {
  /** The ready units across every warehouse — undefined while the read is in flight. */
  ready?: bigint;
  /** Under the figure — what is on its way, and on the owner's page what the ready units cost. */
  line: ReactNode;
  testId?: string;
}) {
  const { t } = useTranslation();
  const status = readyStatus(ready);

  return (
    <Stack gap="1" data-testid={testId}>
      <HStack gap="3" align="center" wrap="wrap">
        <Text textStyle="3xl" fontWeight="bold" lineHeight="1.1" data-testid={`${testId}-ready`}>
          {ready === undefined ? "—" : t("products.detail.highlight.ready", { n: ready.toString() })}
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
      <Box fontSize="sm" color="fg.muted" data-testid={`${testId}-line`}>
        {line}
      </Box>
    </Stack>
  );
}
