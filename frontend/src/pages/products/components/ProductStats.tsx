import { useTranslation } from "react-i18next";
import { SummaryCard, SummaryStrip } from "../../../features/orders/SummaryCard";
import { formatRupiah } from "../../../lib/money";
import { formatUnixDate } from "../../../lib/datetime";

interface StockFigure {
  /** Units. */
  qty: bigint;
  /** What those units are worth AT COST. Never a selling price — a product has no catalogue price. */
  value: bigint;
}

interface ProductStatsProps {
  /** How many ACTIVE products the catalogue holds. Not the tab's count — see the page. */
  totalItems: number;
  /** On hand now, across every warehouse holding this team's goods. */
  ready?: StockFigure;
  /** Inbound: ordered on restocks that have not been accepted onto a rack yet. */
  ongoing?: StockFigure;
  /** When this team last SOLD anything (unix seconds). */
  lastOrderUnix?: bigint;
  /** When stock last ARRIVED (unix seconds). */
  lastRestockUnix?: bigint;
  /** The warehouse lens, when one is chosen — the stock cards then describe only that warehouse. */
  warehouseName?: string;
}

// The catalogue's headline numbers, as THE ORDER LIST'S CARD STRIP (a-list-summary-is-the-order-lists-card-strip) —
// grey cards with a thin line, none wider than a fifth of the row (a-summary-card-is-at-most-a-fifth).
//
// Ready and ongoing each carry a COUNT and a VALUATION because they answer different questions off the same rows — "can
// I sell it?" and "what is it worth / what have I committed?" — and a screen showing only one of the two sends you
// elsewhere for the other half. Last order and last restock are the two DATES that say whether this catalogue is alive:
// nothing sold in three weeks, or nothing arriving, is a fact you want on the way in, not after you go looking.
//
// Undefined renders an em dash rather than a zero: "we do not know" and "you have none" are different statements, and
// the confident version of the wrong one is worse than a blank.
export function ProductStats({
  totalItems,
  ready,
  ongoing,
  lastOrderUnix,
  lastRestockUnix,
  warehouseName,
}: ProductStatsProps) {
  const { t } = useTranslation();

  // Same rule as the table headers: a stock figure narrowed to one warehouse has to say so, or it reads as the total.
  const scoped = (label: string) => (warehouseName ? label + " · " + warehouseName : label);

  return (
    <SummaryStrip testId="products-stats">
      <SummaryCard label={t("products.totalStat")} value={totalItems} testId="products-total" />

      <StockCard
        label={scoped(t("products.stat.ready"))}
        hint={t("products.stat.readyHint")}
        figure={ready}
        testId="products-ready-stock"
      />

      <StockCard
        label={scoped(t("products.stat.ongoing"))}
        hint={t("products.stat.ongoingHint")}
        figure={ongoing}
        testId="products-ongoing-stock"
      />

      <DateCard
        label={t("products.stat.lastOrder")}
        hint={t("products.stat.lastOrderHint")}
        unix={lastOrderUnix}
        testId="products-last-order"
      />

      <DateCard
        label={t("products.stat.lastRestock")}
        hint={t("products.stat.lastRestockHint")}
        unix={lastRestockUnix}
        testId="products-last-restock"
      />
    </SummaryStrip>
  );
}

// The units as the figure; what they are worth at cost as the quiet line under it.
function StockCard({ label, hint, figure, testId }: { label: string; hint: string; figure?: StockFigure; testId: string }) {
  const { t } = useTranslation();

  return (
    <SummaryCard
      label={label}
      value={figure ? t("products.stat.pcs", { n: figure.qty.toString() }) : "—"}
      muted={!figure}
      line={figure ? `${formatRupiah(figure.value)} · ${hint}` : t("products.stat.pending")}
      testId={testId}
    />
  );
}

function DateCard({ label, hint, unix, testId }: { label: string; hint: string; unix?: bigint; testId: string }) {
  const { t } = useTranslation();

  // 0 is "never happened", which is a real answer and reads as such — unlike undefined, which means nobody has told
  // us yet.
  const never = unix === 0n;

  return (
    <SummaryCard
      label={label}
      value={unix === undefined ? "—" : never ? t("products.stat.never") : formatUnixDate(unix)}
      muted={unix === undefined}
      line={unix === undefined ? t("products.stat.pending") : hint}
      testId={testId}
    />
  );
}
