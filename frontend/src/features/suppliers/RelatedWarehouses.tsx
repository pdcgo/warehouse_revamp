import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, HStack, Stack, Text } from "@chakra-ui/react";

import { useIsMobile } from "../../layouts/shell";
import { formatUnixDate } from "../../lib/datetime";
import { FilterChips } from "../../components/chrome/FilterChips";
import { SummaryCard, SummaryStrip } from "../orders/SummaryCard";
import { type SupplierWarehouse, warehouseSummary } from "./sampleWarehouses";
import { units } from "./sampleSupplierFigures";

export const description =
  "A supplier page's related warehouses — every warehouse its restocks were received at — as a row of chips that is also the page's filter (Semua first, one chosen at a time, the chosen one scoping every tab), and under them two cards of what this supplier's goods did in the chosen warehouse, or in all of them: units sold, with the orders and the last one under it, and units ready, with the restocks and the last one under it. More than eight chips fold behind \"+N More\"; a phone scrolls the row sideways. A supplier never restocked says so in words.";

/** How many chips before the rest fold behind "+N more". */
export const VISIBLE_WAREHOUSES = 8;

// GUDANG TERKAIT (owner: *"di detail ini harusnya ada daftar gudang terkait yang sudah digunakan untuk restok, jadi ada
// listnya, dan aku ingin itu juga bisa jadi filter"*, `a-supplier-page-is-scoped-by-its-warehouses`). Under the
// supplier's header, over the tabs — the page's scope, not one tab's: a tab cannot narrow the tabs beside it.
//
// A CHIP IS ITS NAME, AND THE SUMMARY FOLLOWS IT (owner: *"chip gudang cuma gudang, lalu di bawahnya kasih detail gudang
// ini atau semua, dijual berapa stock ready berapa, jumlah restok, terakhir restock dan pesan, sebelum tab"*,
// `a-warehouse-chip-is-its-name-and-the-summary-follows-it`):
//
// TWO CARDS, EACH WITH ITS COUNT AND ITS LAST DATE UNDER IT (owner: *"terjual bawahnya dari ... transaksi . terakhir
// order ... ready bawahnya restok last restock"*, `the-summary-is-sold-and-ready-with-their-counts`):
//
//   Gudang terkait ⚠4 ⚠5
//   (Semua) (Gudang Cabang) (Gudang Bandung)
//   ┌ Terjual                                  ┐ ┌ Siap                            ┐
//   │ 1.507 unit                               │ │ 11 unit                         │
//   │ dari 132 transaksi · terakhir 7 Okt 2026 │ │ 11 restok · terakhir 5 Okt 2026 │
//
// On a phone, two cards share a row and one line would be cut — the count and the date go on a line each.
//
// Semua sums the warehouses — the units, orders and restocks added, the latest of each date. The cards are the app's
// SummaryStrip, the Statistik tab's (the-figures-headline-is-the-card-strip). The page holds the pick and hands in its
// own marks.
export function RelatedWarehouses({
  warehouses,
  value,
  onChange,
  marks,
}: {
  warehouses: SupplierWarehouse[];
  /** The chosen warehouse — 0n is every one. */
  value: bigint;
  onChange: (id: bigint) => void;
  /** The page's ⚠ marks for the warehouses and the pick — numbered in the page's own pending list. */
  marks: ReactNode;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [unfolded, setUnfolded] = useState(false);

  // A phone scrolls the row, so nothing needs folding there.
  const folds = !isMobile && !unfolded && warehouses.length > VISIBLE_WAREHOUSES;
  const shown = folds ? warehouses.slice(0, VISIBLE_WAREHOUSES) : warehouses;
  const summary = warehouseSummary(warehouses, value);

  // A card's count and its last date — one line on a desktop, a line each on a phone, where two cards share a row and
  // one line would be cut before the date.
  const countAndLast = (count: string, last: string) =>
    isMobile ? { line: count, note: last } : { line: `${count} · ${last}` };

  return (
    <Stack gap="3" data-testid="supplier-warehouses">
      <Stack gap="2">
        <HStack gap="1">
          <Text fontSize="sm" fontWeight="bold" color="fg.label">
            {t("suppliers.relatedWarehouses.label")}
          </Text>
          {marks}
        </HStack>

        {warehouses.length === 0 ? (
          // Never restocked — said in words, as a store-less supplier is.
          <Text fontSize="sm" color="fg.muted" data-testid="supplier-warehouses-none">
            {t("suppliers.relatedWarehouses.none")}
          </Text>
        ) : (
          <FilterChips
            // Strings, since a chip's value is a string or a number and a warehouse id is a bigint.
            value={value.toString()}
            onChange={(id) => onChange(BigInt(id))}
            all="0"
            allLabel={t("suppliers.relatedWarehouses.all")}
            options={shown.map((w) => ({ value: w.id.toString(), label: w.name }))}
            ariaLabel={t("suppliers.relatedWarehouses.label")}
            scroll={isMobile}
            trailing={
              folds && (
                <Button
                  size="xs"
                  variant="ghost"
                  colorPalette="gray"
                  borderRadius="full"
                  data-testid="supplier-warehouses-more"
                  onClick={() => setUnfolded(true)}
                >
                  {t("suppliers.relatedWarehouses.more", { count: warehouses.length - VISIBLE_WAREHOUSES })}
                </Button>
              )
            }
            testId="supplier-warehouses-chips"
          />
        )}
      </Stack>

      {/* A chip picked swaps the cards' figures in place, and they fade in — keyed on the pick, so a refresh does not
          (`motion-is-small-quick-and-shared`). */}
      {summary && (
        <Box key={value.toString()} animationStyle="swap">
          <SummaryStrip testId="supplier-warehouse-summary">
            <SummaryCard
              label={t("suppliers.relatedWarehouses.summary.sold")}
              value={t("suppliers.relatedWarehouses.summary.units", { n: units(summary.sold) })}
              {...countAndLast(
                t("suppliers.relatedWarehouses.summary.orders", { n: units(summary.orders) }),
                t("suppliers.relatedWarehouses.summary.last", { date: formatUnixDate(summary.lastOrderAt) }),
              )}
              testId="supplier-warehouse-summary-sold"
            />
            <SummaryCard
              label={t("suppliers.relatedWarehouses.summary.ready")}
              value={t("suppliers.relatedWarehouses.summary.units", { n: units(summary.ready) })}
              {...countAndLast(
                t("suppliers.relatedWarehouses.summary.restocks", { n: units(summary.restocks) }),
                t("suppliers.relatedWarehouses.summary.last", { date: formatUnixDate(summary.lastRestockAt) }),
              )}
              testId="supplier-warehouse-summary-ready"
            />
          </SummaryStrip>
        </Box>
      )}
    </Stack>
  );
}
