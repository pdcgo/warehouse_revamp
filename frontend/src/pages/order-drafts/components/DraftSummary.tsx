import { useTranslation } from "react-i18next";

import type { OrderDraft } from "../../../gen/warehouse/selling/v1/order_draft_pb";
import { formatUnixDate } from "../../../lib/datetime";
import { SummaryCard, SummaryStrip } from "../../../features/orders/SummaryCard";

// THREE NUMBERS ABOVE THE DRAFTS (owner: *"3 teratas saja"*) — the three the data can carry, drawn with
// the order list's own `SummaryCard` in its own strip, so a card here is the same shape as a card there,
// and at most the same share of the row (owner: *"gunakan referensi statistik dari list secara bentuk dan ukuran"*).
//
//   Draft      the whole set — `page_info.total_items`, real
//   Tertua     how long the oldest draft has waited — one ASC row off the same RPC, real. The pruning
//              signal: nothing expires, so the age of the oldest is how you know it is time to clear
//   Siap       the whole set's ready drafts — OrderDraftList's `ready_count` (#16), the server's SQL twin of
//              `draftGaps`, so it reads the backlog and not the page on screen. Out of the same total as the first card
//
// Like the order list's cards, none of them is a control.

export function DraftSummary({
  total,
  oldest,
  ready,
}: {
  total: number;
  oldest: OrderDraft | null | undefined;
  /** How many of the WHOLE set are ready (OrderDraftList's `ready_count`), not of the page on screen. */
  ready: number;
}) {
  const { t } = useTranslation();

  return (
    <SummaryStrip testId="draft-summary">
      <SummaryCard label={t("orderDrafts.summary.total")} value={total} testId="draft-summary-total" />

      <SummaryCard
        label={t("orderDrafts.summary.oldest")}
        value={oldest ? age(t, oldest.createdAtUnix) : "—"}
        line={oldest ? formatUnixDate(oldest.createdAtUnix) : undefined}
        testId="draft-summary-oldest"
      />

      {/* Out of the whole set, as the first card counts it — the server counts both. */}
      <SummaryCard
        label={t("orderDrafts.summary.ready")}
        value={t("orderDrafts.summary.readyValue", { ready, total })}
        testId="draft-summary-ready"
      />
    </SummaryStrip>
  );
}

/**
 * How long a draft has waited — whole hours under a day, whole days above it, rounded DOWN. A draft
 * 47 hours old has waited one day, not two.
 */
function age(t: (key: string, opts?: Record<string, unknown>) => string, createdAtUnix: bigint): string {
  const hours = Math.max(0, (Date.now() / 1000 - Number(createdAtUnix)) / 3600);

  if (hours < 24) {
    return t("orderDrafts.summary.age.hours", { count: Math.max(1, Math.floor(hours)) });
  }

  return t("orderDrafts.summary.age.days", { count: Math.floor(hours / 24) });
}
