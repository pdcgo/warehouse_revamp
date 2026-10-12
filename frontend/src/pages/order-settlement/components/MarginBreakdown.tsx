import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Box, CloseButton, Dialog, Drawer, Flex, Portal, Stack, Text } from "@chakra-ui/react";

import { useIsMobile } from "../../../layouts/shell";
import { formatRupiah, formatSignedRupiah } from "../../../lib/money";
import type { OrderSettlement, SettlementType } from "../model";

// HOW THE TRUE MARGIN ADDS UP (owner: *"margin rill kasih opsi untuk mendetailkannya ke modal"*), opened from
// the "Rincian ›" at the end of its card's label (`the-margin-breakdown-opens-from-rincian`).
//
//   Dana cair                 +Rp 100.000      ← every entry after the sale, summed per type
//   Biaya iklan               −Rp 10.000
//   Penyesuaian marketplace   +Rp 20.000
//   = Diterima                 Rp 110.000
//   Total beli                −Rp 80.000
//   = Margin riil              Rp 30.000
//                       25,00% dari harga jual   ← the share UNDER the figure, as on the card
//   ─────────
//   Harga jual 120.000 · Estimasi margin 40.000 · selisih −10.000 = Penyesuaian
//   Potongan saat cair 20.000                  ← only once a payout has arrived
//
// ⚠ BUILT FROM THE ENTRIES, NOT FROM "harga jual − potongan". Before any payout arrives, the sale less the
// payouts is money still to come, not a deduction — so the deduction is shown only beside a real payout.
// A dialog on a desktop, a bottom sheet on a phone: a modal squeezed to 390px reads as a cramped popup.

type Group = { type: SettlementType; total: bigint; count: number };

function groupsOf(settlement: OrderSettlement): Group[] {
  const byType = new Map<SettlementType, Group>();
  for (const e of settlement.entries) {
    if (e.settlementType === "initial_total" || e.settlementType === "initial_total_cancel") continue;
    const g = byType.get(e.settlementType) ?? { type: e.settlementType, total: 0n, count: 0 };
    g.total += e.change;
    g.count += 1;
    byType.set(e.settlementType, g);
  }
  return [...byType.values()];
}

function Line({
  label,
  value,
  sub,
  strong = false,
  muted = false,
  testId,
}: {
  label: ReactNode;
  value: ReactNode;
  /** A second, quieter line under the value — the margin's share of the selling price. */
  sub?: ReactNode;
  strong?: boolean;
  muted?: boolean;
  testId?: string;
}) {
  return (
    <Flex justify="space-between" align="baseline" gap="4" data-testid={testId}>
      <Text fontSize="sm" fontWeight={strong ? "bold" : undefined} color={muted ? "fg.muted" : undefined}>
        {label}
      </Text>
      <Stack gap="0" align="flex-end">
        <Text fontSize="sm" whiteSpace="nowrap" fontWeight={strong ? "bold" : undefined} color={muted ? "fg.muted" : undefined}>
          {value}
        </Text>
        {sub && (
          <Text fontSize="xs" whiteSpace="nowrap" color="fg.muted">
            {sub}
          </Text>
        )}
      </Stack>
    </Flex>
  );
}

function Breakdown({ settlement, totalBeli }: { settlement: OrderSettlement; totalBeli: bigint }) {
  const { t } = useTranslation();
  const groups = groupsOf(settlement);
  const sale = settlement.initialTotal;
  const received = settlement.lastBalance + sale;
  const margin = received - totalBeli;
  const estimated = sale - totalBeli;
  const funded = groups.find((g) => g.type === "fund")?.total ?? 0n;
  const pct = sale > 0n ? ((Number(margin) * 100) / Number(sale)).toFixed(2) : null;

  return (
    <Stack gap="2" data-testid="margin-breakdown">
      {groups.map((g) => (
        <Line
          key={g.type}
          label={
            <>
              {t(`orderSettlement.type.${g.type}`)}
              {g.count > 1 && (
                <Text as="span" color="fg.muted">
                  {" "}
                  ({g.count})
                </Text>
              )}
            </>
          }
          value={formatSignedRupiah(g.total)}
          testId={`breakdown-${g.type}`}
        />
      ))}
      <Box borderTopWidth="1px" borderColor="border" />
      <Line label={`= ${t("orderSettlement.received")}`} value={formatRupiah(received)} strong testId="breakdown-received" />
      <Line label={t("orderSettlement.breakdown.totalBeli")} value={formatSignedRupiah(-totalBeli)} />
      <Box borderTopWidth="1px" borderColor="border" />
      <Line
        label={`= ${t("orderSettlement.trueMargin")}`}
        value={formatRupiah(margin)}
        sub={pct !== null && t("orderSettlement.stat.ofSales", { pct })}
        strong
        testId="breakdown-margin"
      />

      <Stack gap="1" mt="3" pt="3" borderTopWidth="1px" borderColor="border" borderStyle="dashed">
        <Line label={t("orderSettlement.estimate")} value={formatRupiah(sale)} muted />
        <Line label={t("orderSettlement.estimatedMargin")} value={formatRupiah(estimated)} muted />
        <Line
          label={t("orderSettlement.breakdown.difference")}
          value={formatSignedRupiah(margin - estimated)}
          muted
          testId="breakdown-difference"
        />
        {funded > 0n && (
          <Line
            label={t("orderSettlement.breakdown.deducted")}
            value={formatRupiah(sale - funded)}
            muted
            testId="breakdown-deducted"
          />
        )}
      </Stack>
    </Stack>
  );
}

export function MarginBreakdown({
  open,
  onOpenChange,
  settlement,
  totalBeli,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settlement: OrderSettlement;
  totalBeli: bigint;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const title = t("orderSettlement.breakdown.title");

  if (isMobile) {
    return (
      <Drawer.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} placement="bottom">
        <Portal>
          <Drawer.Backdrop />
          <Drawer.Positioner>
            <Drawer.Content roundedTop="l3" data-testid="margin-breakdown-sheet">
              <Drawer.Header>
                <Drawer.Title>{title}</Drawer.Title>
              </Drawer.Header>
              <Drawer.CloseTrigger asChild>
                <CloseButton size="sm" />
              </Drawer.CloseTrigger>
              <Drawer.Body pb="6">
                <Breakdown settlement={settlement} totalBeli={totalBeli} />
              </Drawer.Body>
            </Drawer.Content>
          </Drawer.Positioner>
        </Portal>
      </Drawer.Root>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={(e) => onOpenChange(e.open)} size="sm">
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content data-testid="margin-breakdown-dialog">
            <Dialog.Header>
              <Dialog.Title>{title}</Dialog.Title>
            </Dialog.Header>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
            <Dialog.Body pb="6">
              <Breakdown settlement={settlement} totalBeli={totalBeli} />
            </Dialog.Body>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
