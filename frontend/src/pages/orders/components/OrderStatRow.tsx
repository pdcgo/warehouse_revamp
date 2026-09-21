import { useTranslation } from "react-i18next";
import { SimpleGrid, Stat } from "@chakra-ui/react";
import type { OrderStatSummary } from "../../../features/orders/stat";
import { formatRupiah } from "../../../lib/money";

// The header above the order list — six numbers in two rows, and the split between them is the point:
//
//   the TOP row is WORK — who is each pile sitting with right now, and it is a live census. These are
//   the numbers somebody acts on, so "to confirm" leads: it is the only one where the person reading
//   this screen is the bottleneck.
//
//   the BOTTOM row is MONEY over the last thirty days — how selling is going, which nobody acts on
//   in the next minute but everybody wants to see.
//
// They are not the same kind of number and are deliberately not interleaved: mixing a live queue with
// a rolling window in one strip invites reading the count as "orders this month".
export function OrderStatRow({ stat }: { stat: OrderStatSummary }) {
  const { t } = useTranslation();

  return (
    <SimpleGrid columns={{ base: 1, sm: 3 }} gap="card">
      <Stat.Root>
        <Stat.Label>{t("orders.stat.toConfirm")}</Stat.Label>
        {/* Coloured only when there IS something waiting. A permanent orange zero trains people to
            stop seeing the colour, which is the one thing this tile cannot afford. */}
        <Stat.ValueText
          color={stat.toConfirm > 0 ? "orange.fg" : undefined}
          data-testid="orders-stat-to-confirm"
        >
          {stat.toConfirm}
        </Stat.ValueText>
        <Stat.HelpText>{t("orders.stat.toConfirmHint")}</Stat.HelpText>
      </Stat.Root>

      <Stat.Root>
        <Stat.Label>{t("orders.stat.inWarehouse")}</Stat.Label>
        <Stat.ValueText data-testid="orders-stat-in-warehouse">{stat.inWarehouse}</Stat.ValueText>
        <Stat.HelpText>{t("orders.stat.inWarehouseHint")}</Stat.HelpText>
      </Stat.Root>

      <Stat.Root>
        <Stat.Label>{t("orders.stat.shipped")}</Stat.Label>
        <Stat.ValueText data-testid="orders-stat-shipped">{stat.shipped}</Stat.ValueText>
        <Stat.HelpText>{t("orders.stat.shippedHint")}</Stat.HelpText>
      </Stat.Root>

      <Stat.Root>
        <Stat.Label>{t("orders.stat.orders30d")}</Stat.Label>
        <Stat.ValueText data-testid="orders-stat-orders-30d">{stat.orders30d}</Stat.ValueText>
        <Stat.HelpText>{t("orders.stat.orders30dHint")}</Stat.HelpText>
      </Stat.Root>

      <Stat.Root>
        <Stat.Label>{t("orders.stat.revenue30d")}</Stat.Label>
        <Stat.ValueText data-testid="orders-stat-revenue-30d">
          {formatRupiah(stat.revenue30d)}
        </Stat.ValueText>
        <Stat.HelpText>{t("orders.stat.revenue30dHint")}</Stat.HelpText>
      </Stat.Root>

      <Stat.Root>
        <Stat.Label>{t("orders.stat.avgOrder")}</Stat.Label>
        <Stat.ValueText data-testid="orders-stat-avg-order">
          {formatRupiah(stat.avgOrder)}
        </Stat.ValueText>
        <Stat.HelpText>{t("orders.stat.avgOrderHint")}</Stat.HelpText>
      </Stat.Root>
    </SimpleGrid>
  );
}
