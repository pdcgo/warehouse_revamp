import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Card,
  Flex,
  Heading,
  Icon,
  SimpleGrid,
  Spacer,
  Spinner,
  Stack,
  Table,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";

import { inventoryClient, orderClient, productClient, restockClient, rpcError, teamClient } from "../api/clients";
import type { ProductPlace, StockMovement } from "../gen/warehouse/inventory/v1/inventory_pb";
import { MovementKind } from "../gen/warehouse/inventory/v1/inventory_pb";
import type { Product } from "../gen/warehouse/product/v1/product_pb";
import type { RestockRequest } from "../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockRequestStatus } from "../gen/warehouse/inventory/v1/restock_request_pb";
import type { Order } from "../gen/warehouse/selling/v1/order_pb";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { formatRupiah } from "../lib/money";
import { useTeam } from "../team/TeamContext";

function parseId(raw: string | undefined): bigint {
  if (!raw) return 0n;

  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// The movement kinds, worded once. The ledger stores a number; a person reads a word.
function kindLabel(t: ReturnType<typeof useTranslation>["t"], kind: MovementKind): string {
  switch (kind) {
    case MovementKind.RECEIVE:
      return t("warehouseProduct.kind.receive");
    case MovementKind.ADJUST:
      return t("warehouseProduct.kind.adjust");
    case MovementKind.TRANSFER_OUT:
      return t("warehouseProduct.kind.transferOut");
    case MovementKind.TRANSFER_IN:
      return t("warehouseProduct.kind.transferIn");
    case MovementKind.PICK:
      return t("warehouseProduct.kind.pick");
    case MovementKind.MOVE:
      return t("warehouseProduct.kind.move");
    case MovementKind.RETURN:
      return t("warehouseProduct.kind.return");
    default:
      return t("warehouseProduct.kind.unknown");
  }
}

// WarehouseProductPage is what a WAREHOUSE sees when it opens a product (#144/#158).
//
// It is deliberately NOT the selling team's product page. That one is about the catalogue entry — the
// name, the images, the category — which a warehouse does not own and cannot edit (#142). What a
// warehouse cares about is the STOCK: how much is here, what it is worth, where it sits, and what has
// happened to it.
export function WarehouseProductPage() {
  const { current } = useTeam();
  const { productId: rawId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const productId = parseId(rawId);

  const [product, setProduct] = useState<Product | null>(null);
  const [ownerName, setOwnerName] = useState("");
  const [places, setPlaces] = useState<ProductPlace[]>([]);
  const [unitCost, setUnitCost] = useState<bigint>(0n);
  const [costKnown, setCostKnown] = useState(false);
  const [lastOpname, setLastOpname] = useState<StockMovement | null>(null);
  const [history, setHistory] = useState<StockMovement[]>([]);
  const [placementHistory, setPlacementHistory] = useState<StockMovement[]>([]);
  const [lastOrders, setLastOrders] = useState<Order[]>([]);
  const [restocks, setRestocks] = useState<RestockRequest[]>([]);
  const [incoming, setIncoming] = useState<RestockRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const warehouseId = isWarehouse ? current?.teamId : undefined;

  const load = useCallback(async () => {
    if (warehouseId === undefined || productId === 0n) return;

    setLoading(true);
    setError("");

    try {
      // A warehouse may read a product it does not own BY ID (#138's rule): a person standing at a
      // shelf must be able to read the label on the box sitting on it.
      const found = await productClient.productByIds({ teamId: warehouseId, productIds: [productId] });
      const p = found.products[0] ?? null;

      setProduct(p);

      const [placesRes, costRes, opnameRes, historyRes, moveRes] = await Promise.all([
        inventoryClient.productPlaces({ warehouseId, productIds: [productId] }),
        inventoryClient.stockCost({ teamId: warehouseId, warehouseId, productIds: [productId] }),
        // The LAST stock-take. Filtered server-side (#158) — page one of an unfiltered ledger would
        // report "never counted" the moment the last one scrolled off it.
        inventoryClient.stockHistory({
          warehouseId,
          productId,
          page: { page: 1, limit: 1 },
          kind: MovementKind.ADJUST,
        }),
        inventoryClient.stockHistory({ warehouseId, productId, page: { page: 1, limit: 50 } }),
        inventoryClient.stockHistory({
          warehouseId,
          productId,
          page: { page: 1, limit: 50 },
          kind: MovementKind.MOVE,
        }),
      ]);

      setPlaces(placesRes.places);
      setLastOpname(opnameRes.movements[0] ?? null);
      setHistory(historyRes.movements);
      setPlacementHistory(moveRes.movements);

      // E and G, and the batch tab (#159/#160) — all three are "this product's history", which is
      // exactly what the product filter added. Without it these would mean paging every order and
      // every restock the warehouse has ever had and filtering in the browser.
      //
      // Fetched after the block above rather than inside it: they are the lower half of the page, and
      // a failure here should not cost the stock figures at the top.
      const [orderRes, restockRes, incomingRes] = await Promise.all([
        orderClient.orderList({
          teamId: warehouseId,
          productId,
          page: { page: 1, limit: 5 },
        }),
        // Fulfilled deliveries — the BATCHES (owner, 2026-07-21: a batch is a delivery).
        restockClient.restockRequestList({
          teamId: warehouseId,
          productId,
          status: RestockRequestStatus.FULFILLED,
          page: { page: 1, limit: 20 },
        }),
        // Still on its way — D's "ongoing restock".
        restockClient.restockRequestList({
          teamId: warehouseId,
          productId,
          status: RestockRequestStatus.PENDING,
          page: { page: 1, limit: 20 },
        }),
      ]);

      setLastOrders(orderRes.orders);
      setRestocks(restockRes.requests);
      setIncoming(incomingRes.requests);

      // ABSENT means the cost is UNKNOWN, not zero (#74). A valuation computed over an unknown cost
      // would read as "these goods are worth nothing", which is a different claim entirely.
      const cost = costRes.costs[0];
      setUnitCost(cost?.unitCost ?? 0n);
      setCostKnown(cost !== undefined);

      // Who owns the catalogue entry — a warehouse holds other teams' products (#142).
      if (p && p.teamId > 0n) {
        try {
          const teams = await teamClient.teamByIds({ ids: [p.teamId] });
          // Unknown and soft-deleted ids are OMITTED from the map, so this is a presence check rather
          // than a blind index — a deleted owning team leaves the badge off rather than showing blank.
          setOwnerName(teams.data[p.teamId.toString()]?.name ?? "");
        } catch {
          setOwnerName("");
        }
      }
    } catch (err) {
      setError(rpcError(err));
      setProduct(null);
    } finally {
      setLoading(false);
    }
  }, [warehouseId, productId]);

  useEffect(() => {
    void load();
  }, [load]);

  // C — how much is here, summed across its places. The same arithmetic StockList does (#135): a
  // warehouse total is a SUM across a product's shelves, never one shelf's figure.
  const onHand = places.reduce((sum, p) => sum + p.onHand, 0n);

  const back = (
    <Button
      size="xs"
      variant="ghost"
      alignSelf="flex-start"
      onClick={() => navigate("/products")}
      data-testid="warehouse-product-back"
    >
      <Icon as={ArrowLeft} boxSize="4" />
      {t("warehouseProduct.back")}
    </Button>
  );

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("warehouseProduct.title")}</Heading>
        <Text color="fg.muted" data-testid="warehouse-product-no-team">
          {t("products.noTeam")}
        </Text>
      </Stack>
    );
  }

  if (!isWarehouse) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("warehouseProduct.title")}</Heading>
        <Text color="fg.muted" data-testid="warehouse-product-not-warehouse">
          {t("warehouseProduct.warehouseOnly")}
        </Text>
      </Stack>
    );
  }

  if (loading) {
    return (
      <Stack gap="section">
        {back}
        <Spinner colorPalette="brand" />
      </Stack>
    );
  }

  if (error || !product) {
    return (
      <Stack gap="section">
        {back}
        <Text color="red.fg" data-testid="warehouse-product-error">
          {error || t("warehouseProduct.notFound")}
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="section" data-testid="warehouse-product-page">
      {back}

      {/* A — the product, and B — whose catalogue it belongs to. */}
      <Flex align="center" gap="card" wrap="wrap">
        <Stack gap="0">
          <Heading size="md">{product.name}</Heading>
          <Text fontSize="sm" color="fg.muted">
            {product.sku}
          </Text>
        </Stack>
        <Spacer />
        {ownerName && (
          <Badge colorPalette="brand" data-testid="warehouse-product-owner">
            {t("warehouseProduct.ownedBy", { team: ownerName })}
          </Badge>
        )}
      </Flex>

      {/* C — ready stock and what it is worth. F — the last stock-take. */}
      <Card.Root>
        <Card.Body>
          <SimpleGrid columns={{ base: 2, md: 4 }} gap="card">
            <Stack gap="0">
              <Text fontSize="xs" color="fg.muted">
                {t("warehouseProduct.onHand")}
              </Text>
              <Text fontWeight="medium" data-testid="warehouse-product-onhand">
                {onHand.toString()}
              </Text>
            </Stack>

            <Stack gap="0">
              <Text fontSize="xs" color="fg.muted">
                {t("warehouseProduct.unitCost")}
              </Text>
              {/* UNKNOWN is not zero (#74) — a product never restocked has no recorded cost, and
                  showing Rp 0 would claim it was free. */}
              <Text fontWeight="medium" data-testid="warehouse-product-unitcost">
                {costKnown ? formatRupiah(unitCost) : t("warehouseProduct.costUnknown")}
              </Text>
            </Stack>

            <Stack gap="0">
              <Text fontSize="xs" color="fg.muted">
                {t("warehouseProduct.valuation")}
              </Text>
              <Text fontWeight="medium" data-testid="warehouse-product-valuation">
                {costKnown ? formatRupiah(onHand * unitCost) : t("warehouseProduct.costUnknown")}
              </Text>
            </Stack>

            <Stack gap="0">
              <Text fontSize="xs" color="fg.muted">
                {t("warehouseProduct.lastOpname")}
              </Text>
              <Text fontWeight="medium" data-testid="warehouse-product-last-opname">
                {lastOpname ? lastOpname.createdAt : t("warehouseProduct.neverCounted")}
              </Text>
            </Stack>
          </SimpleGrid>
        </Card.Body>
      </Card.Root>

      {/* D — what is still on its way, and E/G — what happened last. All three read this product's own
          history, which is what the #159 filter made answerable without paging everything.

          A customer RETURN is deliberately not here: that event does not exist yet. #150 drew the line
          on purpose — "what comes back after shipping is a RETURN, a different event with different
          money" — and only the cancel half was ever built. Showing restock alone is honest; inventing
          a returns figure from cancelled orders would not be. */}
      <Card.Root>
        <Card.Body>
          <SimpleGrid columns={{ base: 1, md: 3 }} gap="card">
            <Stack gap="0">
              <Text fontSize="xs" color="fg.muted">
                {t("warehouseProduct.incoming")}
              </Text>
              <Text fontWeight="medium" data-testid="warehouse-product-incoming">
                {incoming
                  .reduce(
                    (sum, r) =>
                      sum +
                      r.items
                        .filter((i) => i.productId === productId)
                        .reduce((q, i) => q + i.quantity, 0n),
                    0n,
                  )
                  .toString()}
              </Text>
            </Stack>

            <Stack gap="0">
              <Text fontSize="xs" color="fg.muted">
                {t("warehouseProduct.lastOrder")}
              </Text>
              <Text fontWeight="medium" data-testid="warehouse-product-last-order">
                {lastOrders[0] ? `#${lastOrders[0].id}` : t("warehouseProduct.none")}
              </Text>
            </Stack>

            <Stack gap="0">
              <Text fontSize="xs" color="fg.muted">
                {t("warehouseProduct.lastRestock")}
              </Text>
              <Text fontWeight="medium" data-testid="warehouse-product-last-restock">
                {restocks[0] ? `#${restocks[0].id}` : t("warehouseProduct.none")}
              </Text>
            </Stack>
          </SimpleGrid>
        </Card.Body>
      </Card.Root>

      <Tabs.Root defaultValue="placement">
        <Tabs.List>
          <Tabs.Trigger value="placement" data-testid="wp-tab-placement">
            {t("warehouseProduct.tab.placement")}
          </Tabs.Trigger>
          <Tabs.Trigger value="history" data-testid="wp-tab-history">
            {t("warehouseProduct.tab.stockHistory")}
          </Tabs.Trigger>
          <Tabs.Trigger value="placementHistory" data-testid="wp-tab-placement-history">
            {t("warehouseProduct.tab.placementHistory")}
          </Tabs.Trigger>
          <Tabs.Trigger value="batches" data-testid="wp-tab-batches">
            {t("warehouseProduct.tab.batches")}
          </Tabs.Trigger>
        </Tabs.List>

        {/* Tab 2 — where it sits right now (#156). */}
        <Tabs.Content value="placement">
          <Table.Root size="sm" data-testid="wp-placement-table">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>{t("warehouseProduct.place")}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t("warehouseProduct.onHand")}</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {places.map((p) => (
                <Table.Row key={`${p.rackId}-${p.rackCode}`}>
                  <Table.Cell>
                    {/* The unplaced pile is a REAL place (#135), named in words rather than blank. */}
                    {p.rackId === 0n ? t("racks.select.unplaced") : p.rackCode}
                  </Table.Cell>
                  <Table.Cell textAlign="end">{p.onHand.toString()}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>

          {places.length === 0 && (
            <Text color="fg.muted" data-testid="wp-placement-empty">
              {t("warehouseProduct.noStock")}
            </Text>
          )}
        </Tabs.Content>

        {/* Tab 4 — everything that ever happened to it here. */}
        <Tabs.Content value="history">
          <MovementTable movements={history} t={t} testId="wp-history-table" kindLabel={kindLabel} />
        </Tabs.Content>

        {/* Tab 5 — only the shelf-to-shelf moves (#136). */}
        <Tabs.Content value="placementHistory">
          <MovementTable
            movements={placementHistory}
            t={t}
            testId="wp-placement-history-table"
            kindLabel={kindLabel}
          />
        </Tabs.Content>

        {/* Tab 1 — BATCHES. A batch IS a delivery (owner, 2026-07-21): no lot numbers, no expiry, no
            per-batch stock. Each fulfilled restock that brought this product in is one batch, and the
            data was already there — this is a view, not a model. */}
        <Tabs.Content value="batches">
          <Stack gap="card">
            <Table.Root size="sm" data-testid="wp-batches-table">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("warehouseProduct.delivery")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("warehouseProduct.arrived")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("warehouseProduct.damaged")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("warehouseProduct.lineCost")}</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {restocks.map((r) => {
                  // Only THIS product's lines — a delivery usually carries several products, and the
                  // other lines are somebody else's batch.
                  const mine = r.items.filter((i) => i.productId === productId);
                  const arrived = mine.reduce((sum, i) => sum + i.receivedQuantity, 0n);
                  const broken = mine.reduce(
                    (sum, i) => sum + i.damaged.reduce((d, x) => d + x.quantity, 0n),
                    0n,
                  );
                  const cost = mine.reduce((sum, i) => sum + i.totalPrice, 0n);

                  return (
                    <Table.Row key={r.id.toString()} data-testid={`wp-batch-${r.id}`}>
                      <Table.Cell>#{r.id.toString()}</Table.Cell>
                      <Table.Cell textAlign="end">{arrived.toString()}</Table.Cell>
                      <Table.Cell textAlign="end">{broken.toString()}</Table.Cell>
                      <Table.Cell textAlign="end">{formatRupiah(cost)}</Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>

            {restocks.length === 0 && (
              <Text color="fg.muted" data-testid="wp-batches-empty">
                {t("warehouseProduct.noBatches")}
              </Text>
            )}
          </Stack>
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}

// The ledger, rendered. Shared by the two history tabs so a movement reads identically in both — the
// only difference between them is which kinds the server was asked for.
function MovementTable({
  movements,
  t,
  testId,
  kindLabel: label,
}: {
  movements: StockMovement[];
  t: ReturnType<typeof useTranslation>["t"];
  testId: string;
  kindLabel: (t: ReturnType<typeof useTranslation>["t"], kind: MovementKind) => string;
}) {
  return (
    <Stack gap="card">
      <Table.Root size="sm" data-testid={testId}>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("warehouseProduct.when")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("warehouseProduct.what")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("warehouseProduct.place")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("warehouseProduct.change")}</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">{t("warehouseProduct.after")}</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {movements.map((m) => (
            <Table.Row key={m.id.toString()}>
              <Table.Cell>{m.createdAt}</Table.Cell>
              <Table.Cell>{label(t, m.kind)}</Table.Cell>
              <Table.Cell>
                {m.rackId === 0n ? t("racks.select.unplaced") : `#${m.rackId}`}
              </Table.Cell>
              {/* Signed, and shown as such: +9 and -9 are different events, and a bare 9 hides which. */}
              <Table.Cell textAlign="end">
                {m.delta > 0n ? `+${m.delta}` : m.delta.toString()}
              </Table.Cell>
              {/* THIS PLACE's balance after the movement, not the warehouse total (#135). */}
              <Table.Cell textAlign="end">{m.balance.toString()}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>

      {movements.length === 0 && (
        <Text color="fg.muted" data-testid={`${testId}-empty`}>
          {t("warehouseProduct.noMovements")}
        </Text>
      )}
    </Stack>
  );
}
