import { useTranslation } from "react-i18next";

import type { OrderDraft } from "../../../gen/warehouse/selling/v1/order_draft_pb";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { formatUnixDate } from "../../../lib/datetime";
import { draftGaps } from "../../../features/orderDrafts/draftReadiness";
import { SummaryCard, SummaryStrip } from "../../../features/orders/SummaryCard";
import { ORDER_DRAFTS_PENDING } from "../pending";

// THREE NUMBERS ABOVE THE DRAFTS (owner: *"3 teratas saja"*) — the three the data can carry, drawn with
// the order list's own `SummaryCard` in its own strip, so a card here is the same shape as a card there,
// and at most the same share of the row (owner: *"gunakan referensi statistik dari list secara bentuk dan ukuran"*).
//
//   Draft      the whole set — `page_info.total_items`, real
//   Tertua     how long the oldest draft has waited — one ASC row off the same RPC, real. The pruning
//              signal: nothing expires, so the age of the oldest is how you know it is time to clear
//   Siap       ⚠ counted over THIS PAGE only, and the card's own line says so. `draftGaps` is per draft and the
//              list is paginated; the whole set needs an aggregate the server does not have yet
//
// Like the order list's cards, none of them is a control.

export function DraftSummary({
  total,
  oldest,
  page,
}: {
  total: number;
  oldest: OrderDraft | null | undefined;
  /** The drafts on screen — what "ready" is counted over. */
  page: OrderDraft[];
}) {
  const { t } = useTranslation();

  const ready = page.filter((draft) => draftGaps(draft).length === 0).length;

  return (
    <SummaryStrip testId="draft-summary">
      <SummaryCard label={t("orderDrafts.summary.total")} value={total} testId="draft-summary-total" />

      <SummaryCard
        label={t("orderDrafts.summary.oldest")}
        value={oldest ? age(t, oldest.createdAtUnix) : "—"}
        line={oldest ? formatUnixDate(oldest.createdAtUnix) : undefined}
        testId="draft-summary-oldest"
      />

      {/* The scope is on the card's own line, not left to the ⚠'s tooltip — a reader who never hovers
          must still not take "1 of 2" for the whole backlog. */}
      <SummaryCard
        label={t("orderDrafts.summary.ready")}
        mark={<NotImplemented list={ORDER_DRAFTS_PENDING} id="readyCount" />}
        value={t("orderDrafts.summary.readyValue", { ready, total: page.length })}
        line={t("orderDrafts.summary.onThisPage")}
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
