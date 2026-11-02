import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, Flex, Icon } from "@chakra-ui/react";
import { ChevronRight } from "lucide-react";

import { RestockStatusBadge } from "../../../components/badges/RestockStatusBadge";
import { SummaryCard, SummaryStrip } from "../../../features/orders/SummaryCard";
import { RESTOCK_STATUS_TABS } from "../../../features/restock/statusTabs";
import { formatCountCompact, formatRupiahCompact, formatRupiahNumber } from "../../../lib/money";
import { type RestockPile, type RestockSummaryData, pileValue } from "../summarySample";

// THE RESTOCK LIST'S STATISTICS — two strips, one per kind of tab, as the order list's (owner: *"untuk statistik di semua
// status adalah total dan per status … untuk di tab status ada transaksi, jumlah barang, jumlah sku, nilai barang, ongkir
// cod, nilai transaksi"*, the-restock-statistics-count-transactions-under-the-tabs):
//
//   SEMUA STATUS   a card per pile: the total, then one per status — how many TRANSACTIONS leads (owner: *"jumlah
//                  transaksi yang penting"*), the units and the value compact under it
//   A STATUS       that status's figures as cards, whole: Transaksi · Jumlah barang · Jumlah SKU · Nilai barang ·
//                  Ongkir COD · Nilai transaksi (Rincian › per paying account)
//
// ⚠ IT SITS UNDER THE TABS AND CONTROLS NOTHING — no card navigates, filters or selects; the tab above is how a status
// is chosen, and this is what the choice looks like.
//
// ⚠ ONGKIR COD IS THE WAREHOUSE'S, OUTSIDE THE VALUE (owner: *"ongkir cod itu biaya kurir yang dibayar oleh gudang"*) —
// what the courier asked at the door (the-couriers-charge-stays-out-of-total). Nilai transaksi is goods plus shipping, so
// Nilai barang and Ongkir COD never add up to it, and its line says what does.
export function RestockSummary({
  data,
  tab,
  marks,
  onPayments,
}: {
  data: RestockSummaryData;
  /** The status tab — `all` draws the piles, a status draws its figures. */
  tab: string;
  /** Build-status marks, above the figures. */
  marks?: ReactNode;
  /** Opens the transaction value per paying account — a status tab's Nilai transaksi card. */
  onPayments: (pile: RestockPile) => void;
}) {
  const { t } = useTranslation();
  const selected = data.piles.find((pile) => pile.key === tab);

  return (
    <Box data-testid="restock-summary" data-pile={selected?.key ?? "all"} minW="0" maxW="full">
      {marks && (
        // Right-aligned, above the figures — out of the reading path of the numbers themselves.
        <Flex gap="2" align="center" justify="flex-end" mb="2" data-testid="restock-summary-marks">
          {marks}
        </Flex>
      )}

      {selected ? (
        <SummaryStrip testId="restock-summary-measures">
          <SummaryCard
            label={t("restock.selling.summary.transactions")}
            value={selected.transactions.toLocaleString("id-ID")}
            testId="restock-summary-measure-transactions"
          />
          <SummaryCard
            label={t("restock.selling.summary.units")}
            value={t("restock.selling.summary.pcs", { count: selected.units.toLocaleString("id-ID") })}
            testId="restock-summary-measure-units"
          />
          <SummaryCard
            label={t("restock.selling.summary.skus")}
            value={selected.skus.toLocaleString("id-ID")}
            note={t("restock.selling.summary.skusLine")}
            testId="restock-summary-measure-skus"
          />
          <SummaryCard
            label={t("restock.selling.summary.goods")}
            value={formatRupiahNumber(selected.goods)}
            testId="restock-summary-measure-goods"
          />
          <SummaryCard
            label={t("restock.selling.summary.courierCharge")}
            value={formatRupiahNumber(selected.courierCharge)}
            note={t("restock.selling.summary.courierChargeLine")}
            testId="restock-summary-measure-courier-charge"
          />
          <SummaryCard
            label={t("restock.selling.summary.value")}
            // RINCIAN › AT THE END OF THE LABEL (a-breakdown-opens-from-rincian) — the value per paying account, which
            // answers how much went by transfer and how much by e-wallet. Only the word is pressed.
            mark={
              selected.transactions > 0 ? (
                <Button
                  variant="plain"
                  size="2xs"
                  h="auto"
                  p="0"
                  ms="auto"
                  color="brand.fg"
                  fontWeight="bold"
                  onClick={() => onPayments(selected)}
                  data-testid="restock-summary-payments"
                >
                  {t("restock.selling.summary.details")}
                  <Icon as={ChevronRight} boxSize="3" />
                </Button>
              ) : undefined
            }
            value={formatRupiahNumber(pileValue(selected))}
            note={t("restock.selling.summary.valueLine")}
            testId="restock-summary-measure-value"
          />
        </SummaryStrip>
      ) : (
        <SummaryStrip testId="restock-summary-piles">
          <PileCard pile={data.total} label={t("restock.selling.summary.total")} testId="restock-summary-total" />
          {data.piles.map((pile) => {
            const status = RESTOCK_STATUS_TABS.find((item) => item.value === pile.key)?.status;

            return (
              <PileCard
                key={pile.key}
                pile={pile}
                badge={status !== undefined ? <RestockStatusBadge status={status} /> : undefined}
                testId={`restock-summary-pile-${pile.key}`}
              />
            );
          })}
        </SummaryStrip>
      )}
    </Box>
  );
}

// One pile at a glance: how many restocks — the count leads (owner: *"jumlah transaksi yang penting"*) — then its units
// and its value, compact, so six cards read side by side without counting digits.
function PileCard({
  pile,
  label,
  badge,
  testId,
}: {
  pile: RestockPile;
  label?: string;
  badge?: ReactNode;
  testId: string;
}) {
  const { t } = useTranslation();

  return (
    <SummaryCard
      label={label}
      badge={badge}
      value={t("restock.selling.summary.transactionCount", { count: pile.transactions })}
      line={t("restock.selling.summary.pileLine", {
        units: formatCountCompact(pile.units),
        value: formatRupiahCompact(BigInt(Math.round(pileValue(pile)))),
      })}
      muted={pile.transactions === 0}
      testId={testId}
    />
  );
}
