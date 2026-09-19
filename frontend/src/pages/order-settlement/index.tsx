import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Flex, Heading, Icon, Spacer, Stack, Table, Text } from "@chakra-ui/react";
import { Hand, TriangleAlert } from "lucide-react";

import { formatRupiah } from "../../lib/money";
import { hiddenCost, loss, netReceived, type OrderSettlement } from "./model";

// WHICH ORDERS LOST THE MOST AGAINST THEIR ESTIMATE — the settlement list.
//
// ⚠ A DESIGN PROTOTYPE. Takes its rows as a PROP; no query hook, no client, no route yet. See
// model.ts for why the contract does not exist.
//
// ── What this screen is NOT, and both are decisions rather than omissions ────────────────────────
//
// It is **not a worklist**. `a-residual-balance-is-normal` says almost every order ends non-zero, so
// a queue of "unsettled" orders would contain all of them and mean nothing. Nothing here is ticked
// off, cleared or assigned.
//
// It is **not a debt list**. `hidden-cost-is-left-in-the-balance` says the gap is money the platform
// already took and nobody is going to collect. The column is therefore **Lost**, never "outstanding"
// or "unpaid" — a label implying somebody owes us would be wrong on every row.
//
// ── What it IS ──────────────────────────────────────────────────────────────────────────────────
//
// A ranking. Sorted by loss, worst first, because the only action this screen supports is *look at
// the ones that went furthest wrong*. The **Hidden** column is the part of that loss nobody itemised
// — summed down the page it is the closest thing this system has to a take-rate.
export interface OrderSettlementPageProps {
  orders: OrderSettlement[];
  onOpenOrder?: (orderId: bigint) => void;
}

export function OrderSettlementPage({ orders, onOpenOrder }: OrderSettlementPageProps) {
  const { t } = useTranslation();
  const [shop, setShop] = useState<string | null>(null);

  const shops = useMemo(
    () => Array.from(new Set(orders.map((o) => o.shopName))).sort(),
    [orders],
  );

  const rows = useMemo(() => {
    const filtered = shop ? orders.filter((o) => o.shopName === shop) : orders;
    // Worst loss first. An order with no estimate sorts last: its loss is not a real figure.
    return [...filtered].sort((a, b) => {
      if (a.initialTotal === 0n) return 1;
      if (b.initialTotal === 0n) return -1;
      return Number(loss(b) - loss(a));
    });
  }, [orders, shop]);

  const totals = useMemo(
    () =>
      rows
        .filter((o) => o.initialTotal !== 0n)
        .reduce(
          (acc, o) => ({
            estimate: acc.estimate + o.initialTotal,
            lost: acc.lost + loss(o),
            hidden: acc.hidden + hiddenCost(o),
          }),
          { estimate: 0n, lost: 0n, hidden: 0n },
        ),
    [rows],
  );

  return (
    <Stack gap="section" data-testid="order-settlement-page">
      <Flex align="center" gap="3">
        <Heading size="md">{t("orderSettlement.listTitle")}</Heading>
        <Spacer />
        <ShopFilter shops={shops} value={shop} onChange={setShop} />
      </Flex>

      <Text fontSize="sm" color="fg.muted">
        {t("orderSettlement.listSubtitle")}
      </Text>

      <TakeRateCard estimate={totals.estimate} lost={totals.lost} hidden={totals.hidden} />

      <Box overflowX="auto">
        <Table.Root size="sm" interactive data-testid="settlement-list-table">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t("orderSettlement.col.order")}</Table.ColumnHeader>
              <Table.ColumnHeader>{t("orderSettlement.col.shop")}</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">
                {t("orderSettlement.col.estimate")}
              </Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">
                {t("orderSettlement.col.received")}
              </Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">
                {t("orderSettlement.col.lost")}
              </Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">
                {t("orderSettlement.col.hidden")}
              </Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((order) => (
              <ListRow key={String(order.orderId)} order={order} onOpen={onOpenOrder} />
            ))}
          </Table.Body>
        </Table.Root>
      </Box>
    </Stack>
  );
}

// ── The one aggregate worth a card ──────────────────────────────────────────────────────────────

// `hidden-cost-is-left-in-the-balance`: summed per shop, the unexplained gap becomes an IMPLIED TAKE
// RATE — the nearest this system can get to "what does selling here actually cost us". It is on the
// page rather than in a report because it is the only number here that compares marketplaces.
function TakeRateCard({
  estimate,
  lost,
  hidden,
}: {
  estimate: bigint;
  lost: bigint;
  hidden: bigint;
}) {
  const { t } = useTranslation();
  // Basis points, so a rate under 1% does not render as "0%".
  const rate = estimate > 0n ? Number((hidden * 10_000n) / estimate) / 100 : null;

  return (
    <Flex
      gap="card"
      wrap="wrap"
      borderWidth="1px"
      borderRadius="md"
      p="card"
      data-testid="take-rate-card"
    >
      <Stat label={t("orderSettlement.totalEstimate")} value={formatRupiah(estimate)} />
      <Stat label={t("orderSettlement.totalLost")} value={formatRupiah(lost)} tone="fg.error" />
      <Stat
        label={t("orderSettlement.totalHidden")}
        value={formatRupiah(hidden)}
        hint={rate !== null ? t("orderSettlement.impliedRate", { rate }) : undefined}
        testId="hidden-total"
      />
    </Flex>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
  testId,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
  testId?: string;
}) {
  return (
    <Box minW="10rem" data-testid={testId}>
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Text fontSize="lg" fontWeight="semibold" color={tone}>
        {value}
      </Text>
      {hint && (
        <Text fontSize="xs" color="fg.muted">
          {hint}
        </Text>
      )}
    </Box>
  );
}

// ── One row ─────────────────────────────────────────────────────────────────────────────────────

function ListRow({
  order,
  onOpen,
}: {
  order: OrderSettlement;
  onOpen?: (orderId: bigint) => void;
}) {
  const { t } = useTranslation();
  const unknown = order.initialTotal === 0n;
  const lost = loss(order);

  return (
    <Table.Row
      cursor={onOpen ? "pointer" : undefined}
      onClick={() => onOpen?.(order.orderId)}
      data-testid={`settlement-row-${order.orderId}`}
    >
      <Table.Cell>
        <Text fontSize="sm">{order.orderRef || t("orderSettlement.noRef")}</Text>
        {order.entries.some((e) => e.sourceType === "manual") && (
          <Flex align="center" gap="1" data-testid="has-manual">
            <Icon as={Hand} boxSize="3" color="fg.muted" />
            <Text fontSize="xs" color="fg.muted">
              {t("orderSettlement.hasManual")}
            </Text>
          </Flex>
        )}
      </Table.Cell>
      <Table.Cell>
        <Text fontSize="sm">{order.shopName}</Text>
      </Table.Cell>

      {unknown ? (
        // ⚠ No estimate means no denominator, so every figure on this row would be a fiction.
        // The row refuses rather than printing one — see fixtures.noEstimate.
        <Table.Cell colSpan={4} data-testid="row-no-estimate">
          <Flex align="center" gap="2">
            <Icon as={TriangleAlert} boxSize="4" color="orange.400" />
            <Text fontSize="sm" color="fg.muted">
              {t("orderSettlement.rowNoEstimate")}
            </Text>
          </Flex>
        </Table.Cell>
      ) : (
        <>
          <Table.Cell textAlign="end">
            <Text fontSize="sm">{formatRupiah(order.initialTotal)}</Text>
          </Table.Cell>
          <Table.Cell textAlign="end">
            <Text fontSize="sm">{formatRupiah(netReceived(order))}</Text>
          </Table.Cell>
          <Table.Cell textAlign="end">
            <Text
              fontSize="sm"
              fontWeight="medium"
              color={lost > 0n ? "fg.error" : lost < 0n ? "fg.success" : undefined}
            >
              {formatRupiah(lost)}
            </Text>
          </Table.Cell>
          <Table.Cell textAlign="end">
            <Text fontSize="sm" color="fg.muted">
              {formatRupiah(hiddenCost(order))}
            </Text>
          </Table.Cell>
        </>
      )}
    </Table.Row>
  );
}

// ── The filter ──────────────────────────────────────────────────────────────────────────────────

function ShopFilter({
  shops,
  value,
  onChange,
}: {
  shops: string[];
  value: string | null;
  onChange: (shop: string | null) => void;
}) {
  const { t } = useTranslation();

  return (
    <Flex gap="2" align="center">
      <Text fontSize="sm" color="fg.muted">
        {t("orderSettlement.filterShop")}
      </Text>
      <select
        // ⚠ PROTOTYPE ONLY. A real one is `ShopSelect` from the design system, which needs the team
        // context and a client — neither exists on a page taking its rows as a prop.
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        data-testid="shop-filter"
      >
        <option value="">{t("orderSettlement.allShops")}</option>
        {shops.map((shop) => (
          <option key={shop} value={shop}>
            {shop}
          </option>
        ))}
      </select>
    </Flex>
  );
}
