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

import { rpcError } from "../../api/clients";
import type { StockMovement } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { MovementKind } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { formatRupiah } from "../../lib/money";
import { useTeam } from "../../features/team/TeamContext";
import { kindLabel } from "../../features/inventory/movementKind";
import { useWarehouseProduct, useWarehouseProductActivity } from "../../features/inventory/queries";

function parseId(raw: string | undefined): bigint {
  if (!raw) return 0n;

  try {
    return BigInt(raw);
  } catch {
    return 0n;
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

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const warehouseId = isWarehouse ? current?.teamId : undefined;

  // TWO queries (#176): the stock half renders whether or not the activity half succeeds. The old
  // loader intended this — its comment said a failure below "should not cost the stock figures at the
  // top" — but both blocks shared one try/catch, so an order-history failure blanked the very figures
  // it meant to protect.
  const stockQuery = useWarehouseProduct({
    warehouseId,
    productId,
    adjustKind: MovementKind.ADJUST,
    moveKind: MovementKind.MOVE,
  });
  const activityQuery = useWarehouseProductActivity({
    warehouseId,
    productId,
    fulfilledStatus: RestockRequestStatus.FULFILLED,
    pendingStatus: RestockRequestStatus.PENDING,
  });

  const product = stockQuery.data?.product ?? null;
  const ownerName = stockQuery.data?.ownerName ?? "";
  const places = stockQuery.data?.places ?? [];
  const unitCost = stockQuery.data?.unitCost ?? 0n;
  const costKnown = stockQuery.data?.costKnown ?? false;
  const lastOpname = stockQuery.data?.lastOpname ?? null;
  const history = stockQuery.data?.history ?? [];
  const placementHistory = stockQuery.data?.placementHistory ?? [];

  const lastOrders = activityQuery.data?.lastOrders ?? [];
  const restocks = activityQuery.data?.restocks ?? [];
  const incoming = activityQuery.data?.incoming ?? [];

  const loading = stockQuery.isPending && warehouseId !== undefined && productId !== 0n;
  const error = stockQuery.isError ? rpcError(stockQuery.error) : "";


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
