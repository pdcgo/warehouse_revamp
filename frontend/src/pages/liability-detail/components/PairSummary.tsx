import { useTranslation } from "react-i18next";
import { Span } from "@chakra-ui/react";

import { SummaryCard, SummaryStrip } from "../../../features/orders/SummaryCard";
import { directionCopy, directionOf, directionPalette } from "../../../features/liability/direction";
import { formatRupiah } from "../../../lib/money";

// THE PAIR'S FIGURES, AS THE ORDER LIST'S CARDS (a-list-summary-is-the-order-lists-card-strip) — the net position
// leading in pale blue, then its two gross sides. Each card is a label, ONE figure and one quiet line: the direction is
// the line under the figure, in words, never a sign. They were Chakra `Stat`s laid out by hand.
export function PairSummary({ balance, phone = false }: { balance: number; phone?: boolean }) {
  const { t } = useTranslation();

  // The gross tiles are the two sides of the single signed balance: a pair carries one net figure, so "they owe you"
  // and "you owe them" are the positive and negative reading of it — mirroring the liability list's two columns.
  const copy = directionCopy(balance);
  const direction = directionOf(balance);
  // By the direction, so float dust beyond 4 places reads as square on all three cards alike.
  const receivable = direction === "they-owe-you" ? balance : 0;
  const payable = direction === "you-owe-them" ? -balance : 0;
  const directionLine =
    direction === "they-owe-you"
      ? t("liabilityDetail.receivableHint")
      : direction === "you-owe-them"
        ? t("liabilityDetail.payableHint")
        : t("liability.square");

  return (
    <SummaryStrip testId="liability-detail-summary">
      <SummaryCard
        label={t("liabilityDetail.positionLabel")}
        value={
          <Span color={`${directionPalette(balance)}.fg`} data-testid="liability-detail-balance">
            {copy.amount}
          </Span>
        }
        line={<Span data-testid="liability-detail-direction">{directionLine}</Span>}
        emphasis
        // On a phone the lead card takes the whole row, never half of it alone (SummaryCard's `wide`).
        wide={phone}
        testId="liability-detail-position"
      />
      <SummaryCard
        label={t("liabilityDetail.receivableLabel")}
        value={<Span color="success.fg">{formatRupiah(receivable)}</Span>}
        line={t("liabilityDetail.receivableHint")}
        testId="liability-detail-receivable-card"
      />
      <SummaryCard
        label={t("liabilityDetail.payableLabel")}
        value={<Span color="warning.fg">{formatRupiah(payable)}</Span>}
        line={t("liabilityDetail.payableHint")}
        testId="liability-detail-payable-card"
      />
    </SummaryStrip>
  );
}
