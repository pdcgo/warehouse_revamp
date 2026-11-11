import { useTranslation } from "react-i18next";

import type { RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { SummaryCard, SummaryStrip } from "../orders/SummaryCard";
import { useIsMobile } from "../../layouts/shell";
import { askedQuantity, brokenQuantity, goodQuantity, missingQuantity } from "./summary";

// WHAT THE BOX IS, IN FIVE CARDS (owner: *"di produk kasih statistik"*, then *"kurasa selling juga sama"*,
// the-restock-page-leads-with-the-box) — the head of a restock page's Produk section, on both sides:
//
//   [Produk 2 · 30 pcs dipesan] [Datang 29 pcs · dari 30 dipesan] [Baik 27 pcs · masuk stok] [Rusak 2 pcs] [Kurang 1 pc]
//
// Until the box is counted the four after the first read "—", not counted yet — never the 0 the fields hold, which would
// say "nothing arrived" about a box nobody has opened.
export function BoxStats({ request }: { request: RestockRequest }) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const counted = request.status === RestockRequestStatus.ACCEPTED;
  const items = request.items;

  const ordered = askedQuantity(items);
  const received = items.reduce((sum, item) => sum + item.receivedCount, 0n);
  const good = items.reduce((sum, item) => sum + goodQuantity(item), 0n);
  const broken = items.reduce((sum, item) => sum + brokenQuantity(item), 0n);
  const short = items.reduce((sum, item) => sum + missingQuantity(item), 0n);
  // A counted figure, or the dash that says the box is not open yet.
  const counts = (n: bigint) => (counted ? t("restock.detail.stat.pcs", { count: Number(n) }) : "—");
  const notYet = counted ? undefined : t("restock.detail.notCounted");

  return (
    <SummaryStrip testId="restock-detail-stats">
      <SummaryCard
        emphasis
        wide={isMobile}
        label={t("restock.detail.stat.products")}
        value={items.length.toString()}
        line={t("restock.detail.stat.ordered", { count: Number(ordered) })}
        testId="restock-detail-stat-products"
      />
      <SummaryCard
        label={t("restock.detail.received")}
        value={counts(received)}
        line={counted ? t("restock.detail.stat.ofOrdered", { count: Number(ordered) }) : notYet}
        testId="restock-detail-stat-received"
      />
      <SummaryCard
        label={t("restock.detail.good")}
        value={counts(good)}
        line={counted ? t("restock.detail.stat.intoStock") : notYet}
        testId="restock-detail-stat-good"
      />
      <SummaryCard label={t("restock.problem.broken")} value={counts(broken)} line={notYet} testId="restock-detail-stat-broken" />
      <SummaryCard label={t("restock.problem.missing")} value={counts(short)} line={notYet} testId="restock-detail-stat-missing" />
    </SummaryStrip>
  );
}
