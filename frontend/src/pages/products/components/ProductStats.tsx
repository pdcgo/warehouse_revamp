import { useTranslation } from "react-i18next";
import { SimpleGrid, Stat, Text } from "@chakra-ui/react";
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
  /** The warehouse lens, when one is chosen — the stock tiles then describe only that warehouse. */
  warehouseName?: string;
}

// The catalogue's headline numbers — the guideline's stat "preview" (guidelines/service-guideline.md).
//
// Ready and ongoing each carry a COUNT and a VALUATION because they answer different questions off
// the same rows — "can I sell it?" and "what is it worth / what have I committed?" — and a screen
// showing only one of the two sends you elsewhere for the other half. Last order and last restock are
// the two DATES that say whether this catalogue is alive: nothing sold in three weeks, or nothing
// arriving, is a fact you want on the way in, not after you go looking.
//
// ⚠ Everything except the product count is OPTIONAL and currently arrives undefined. Stock lives in
// inventory_service (per warehouse, warehouse roles only), orders in selling_service, restocks in
// inventory_service — none of them exposes a per-catalogue read a SELLING team may call. Undefined
// renders an em dash rather than a zero: "we do not know" and "you have none" are different
// statements, and the confident version of the wrong one is worse than a blank.
export function ProductStats({
  totalItems,
  ready,
  ongoing,
  lastOrderUnix,
  lastRestockUnix,
  warehouseName,
}: ProductStatsProps) {
  const { t } = useTranslation();

  // Same rule as the table headers: a stock figure narrowed to one warehouse has to say so, or it
  // reads as the total.
  const scoped = (label: string) => (warehouseName ? label + " · " + warehouseName : label);

  return (
    <SimpleGrid columns={{ base: 1, md: 3, xl: 5 }} gap="card">
      <Stat.Root>
        <Stat.Label>{t("products.totalStat")}</Stat.Label>
        <Stat.ValueText data-testid="products-total">{totalItems}</Stat.ValueText>
      </Stat.Root>

      <StockStat
        label={scoped(t("products.stat.ready"))}
        hint={t("products.stat.readyHint")}
        figure={ready}
        testId="products-ready-stock"
      />

      <StockStat
        label={scoped(t("products.stat.ongoing"))}
        hint={t("products.stat.ongoingHint")}
        figure={ongoing}
        testId="products-ongoing-stock"
      />

      <DateStat
        label={t("products.stat.lastOrder")}
        hint={t("products.stat.lastOrderHint")}
        unix={lastOrderUnix}
        testId="products-last-order"
      />

      <DateStat
        label={t("products.stat.lastRestock")}
        hint={t("products.stat.lastRestockHint")}
        unix={lastRestockUnix}
        testId="products-last-restock"
      />
    </SimpleGrid>
  );
}

function StockStat({
  label,
  hint,
  figure,
  testId,
}: {
  label: string;
  hint: string;
  figure?: StockFigure;
  testId: string;
}) {
  const { t } = useTranslation();

  return (
    <Stat.Root>
      <Stat.Label>{label}</Stat.Label>
      <Stat.ValueText data-testid={testId}>
        {figure ? t("products.stat.pcs", { n: figure.qty.toString() }) : "—"}
      </Stat.ValueText>
      <Stat.HelpText>
        {figure ? (
          <>
            {formatRupiah(figure.value)}{" "}
            <Text as="span" color="fg.subtle">
              {hint}
            </Text>
          </>
        ) : (
          <Text as="span" color="fg.subtle">
            {t("products.stat.pending")}
          </Text>
        )}
      </Stat.HelpText>
    </Stat.Root>
  );
}

function DateStat({
  label,
  hint,
  unix,
  testId,
}: {
  label: string;
  hint: string;
  unix?: bigint;
  testId: string;
}) {
  const { t } = useTranslation();

  // 0 is "never happened", which is a real answer and reads as such — unlike undefined, which means
  // nobody has told us yet.
  const never = unix === 0n;

  return (
    <Stat.Root>
      <Stat.Label>{label}</Stat.Label>
      <Stat.ValueText data-testid={testId}>
        {unix === undefined ? "—" : never ? t("products.stat.never") : formatUnixDate(unix)}
      </Stat.ValueText>
      <Stat.HelpText>
        <Text as="span" color="fg.subtle">
          {unix === undefined ? t("products.stat.pending") : hint}
        </Text>
      </Stat.HelpText>
    </Stat.Root>
  );
}
