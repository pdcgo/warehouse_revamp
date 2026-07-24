import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Field,
  Flex,
  Heading,
  Icon,
  NativeSelect,
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
import {
  useCostLayers,
  usePlacementList,
  useProductBatches,
  useProductStockSummary,
  useWarehouseProduct,
  useWarehouseProductActivity,
} from "../../features/inventory/queries";
import { AdjustStockDialog } from "../../features/inventory/AdjustStockDialog";
import { MoveStockDialog } from "../../features/inventory/MoveStockDialog";

function parseId(raw: string | undefined): bigint {
  if (!raw) return 0n;

  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

function formatDateUnix(unix: bigint): string {
  return new Date(Number(unix) * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// A batch is flagged amber when it expires within 30 days — the "expiring soon" window the server uses.
function isExpiringSoon(unix: bigint): boolean {
  return Number(unix) * 1000 <= Date.now() + 30 * 24 * 60 * 60 * 1000;
}

// A shelf's count reads amber once its last opname is more than two weeks old — overdue for a re-count.
function isStaleOpname(unix: bigint): boolean {
  return Number(unix) * 1000 < Date.now() - 14 * 24 * 60 * 60 * 1000;
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
  const lastOpname = stockQuery.data?.lastOpname ?? null;
  const history = stockQuery.data?.history ?? [];
  const placementHistory = stockQuery.data?.placementHistory ?? [];
  // Resolved for the two history tabs' "By" and "Place" columns (#209): the actor's name and the rack
  // CODE. Both fall back to "#id" when a lookup misses, never to a blank.
  const rackCodes = stockQuery.data?.rackCodes ?? new Map<string, string>();
  const actorNames = stockQuery.data?.actorNames ?? new Map<string, string>();

  const lastOrders = activityQuery.data?.lastOrders ?? [];
  const restocks = activityQuery.data?.restocks ?? [];
  const incoming = activityQuery.data?.incoming ?? [];

  // The new per-(shelf × batch) reads (#209): cost LAYERS for Prices, and the batches themselves
  // (with Used / Ready / expiry) for the Batches tab — the FIFO cost-layer model the old view could
  // not show.
  const costLayers = useCostLayers({ warehouseId, productId });
  const layers = costLayers.data?.layers ?? [];
  const layersTotal = costLayers.data?.totalValue ?? 0n;

  const batchesQuery = useProductBatches({ warehouseId, productId });
  const batchRows = batchesQuery.data ?? [];

  // The last in/out/opname per shelf (#209) — merged onto the placement rows by rack so a stale count
  // flags a shelf overdue. `places` carries the rack CODE; this read carries the dates.
  const placementDates = usePlacementList({ warehouseId, productId }).data ?? [];
  const datesByRack = new Map(placementDates.map((p) => [p.rackId, p]));

  // The Info tab's money tiles (#209): Ready value, and the estimated value of what is inbound.
  const summary = useProductStockSummary({ warehouseId, productId }).data;

  const loading = stockQuery.isPending && warehouseId !== undefined && productId !== 0n;
  const error = stockQuery.isError ? rpcError(stockQuery.error) : "";


  // C — how much is here, summed across its places. The same arithmetic StockList does (#135): a
  // warehouse total is a SUM across a product's shelves, never one shelf's figure.
  const onHand = places.reduce((sum, p) => sum + p.onHand, 0n);

  const [moving, setMoving] = useState(false);
  const [adjusting, setAdjusting] = useState(false);

  // The history tabs filter by batch, and Placement History also by rack (#209). "" = no filter (All).
  // Client-side over the loaded page, the same shape the mock drives them: the ledger is one page here,
  // and a batch-less recount (batch_id 0) simply never matches a specific batch, as it should.
  const [historyBatch, setHistoryBatch] = useState("");
  const [phRack, setPhRack] = useState("");
  const [phBatch, setPhBatch] = useState("");

  // The batch options both filters offer — this product's deliveries, labelled by delivery number.
  const batchOptions = batchRows.map((b) => ({ value: b.id.toString(), label: `#${b.deliveryId}` }));
  // The rack options Placement History offers — every rack a move in view touched, resolved to its code.
  const phRackIds = [...new Set(placementHistory.map((m) => m.rackId))];

  const filteredHistory = historyBatch
    ? history.filter((m) => m.batchId.toString() === historyBatch)
    : history;
  const filteredPlacementHistory = placementHistory.filter((m) => {
    if (phRack && m.rackId.toString() !== phRack) return false;
    if (phBatch && m.batchId.toString() !== phBatch) return false;
    return true;
  });

  // A rack's code for the Place column / filter label — the unplaced pile in words (#135), else its code.
  const rackLabel = (rackId: bigint): string => {
    if (rackId === 0n) return t("racks.select.unplaced");
    return rackCodes.get(rackId.toString()) ?? `#${rackId.toString()}`;
  };

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

      {/* THE HEADER (#198): the product, and what a person standing here can DO to it. */}
      <Flex align="center" gap="card" wrap="wrap">
        <Stack gap="0">
          <Heading size="md">{product.name}</Heading>
          <Text fontSize="sm" color="fg.muted">
            {product.sku}
          </Text>
        </Stack>
        <Spacer />

        {/* THE ACTION GROUP — Move and Adjust only (#209). There is deliberately NO Receive here:
            stock enters through restock ACCEPTANCE, which freezes a cost layer (#155/#208). A manual
            receive would create batch-less, cost-unknown stock and undo the whole cost-layer model.
            Both are the dialogs the stock list already uses — a second set scoped to one product would
            be a second place for "adjust to a counted figure" to mean something slightly different. */}
        <Button
          size="xs"
          variant="outline"
          data-testid="wp-action-move"
          onClick={() => setMoving(true)}
        >
          {t("inventory.move")}
        </Button>
        <Button
          size="xs"
          variant="outline"
          data-testid="wp-action-adjust"
          onClick={() => setAdjusting(true)}
        >
          {t("inventory.adjust")}
        </Button>
      </Flex>

      {warehouseId !== undefined && (
        <>
          <MoveStockDialog
            warehouseId={warehouseId}
            product={product}
            currentOnHand={onHand}
            open={moving}
            onOpenChange={setMoving}
          />
          <AdjustStockDialog
            warehouseId={warehouseId}
            product={product}
            currentOnHand={onHand}
            open={adjusting}
            onOpenChange={setAdjusting}
          />
        </>
      )}

      {/* VERTICAL tabs down the left, content beside them (#198) — the same shape the rack detail
          uses, because they are the same kind of screen: one record, read section by section. */}
      <Tabs.Root defaultValue="info" orientation="vertical" data-testid="wp-tabs">
        <Tabs.List minW="48">
          <Tabs.Trigger value="info" data-testid="wp-tab-info">
            {t("warehouseProduct.tab.info")}
          </Tabs.Trigger>
          <Tabs.Trigger value="prices" data-testid="wp-tab-prices">
            {t("warehouseProduct.tab.prices")}
          </Tabs.Trigger>
          <Tabs.Trigger value="placement" data-testid="wp-tab-placement">
            {t("warehouseProduct.tab.placement")}
          </Tabs.Trigger>
          <Tabs.Trigger value="batches" data-testid="wp-tab-batches">
            {t("warehouseProduct.tab.batches")}
          </Tabs.Trigger>
          <Tabs.Trigger value="history" data-testid="wp-tab-history">
            {t("warehouseProduct.tab.stockHistory")}
          </Tabs.Trigger>
          <Tabs.Trigger value="placementHistory" data-testid="wp-tab-placement-history">
            {t("warehouseProduct.tab.placementHistory")}
          </Tabs.Trigger>
        </Tabs.List>

        {/* INFO — whose it is, how much is here, and what happened around it lately.
            A customer RETURN is deliberately absent: that event does not exist yet. #150 drew the line
            on purpose — "what comes back after shipping is a RETURN, a different event with different
            money" — and only the cancel half was ever built. Showing restock alone is honest;
            inventing a returns figure from cancelled orders would not be. */}
        <Tabs.Content value="info" flex="1" data-testid="wp-info-panel">
          <SimpleGrid columns={{ base: 2, md: 3 }} gap="card">
            <Stat label={t("warehouseProduct.owner")} testId="warehouse-product-owner">
              {ownerName ? (
                <Badge colorPalette="brand">
                  {t("warehouseProduct.ownedBy", { team: ownerName })}
                </Badge>
              ) : (
                t("warehouseProduct.none")
              )}
            </Stat>

            {/* How much is here, summed across its places. The same arithmetic StockList does
                (#135): a warehouse total is a SUM across a product's shelves, never one shelf's. */}
            <Stat label={t("warehouseProduct.onHand")} testId="warehouse-product-onhand">
              {onHand.toString()}
            </Stat>

            {/* The value of what is ready now — the sum across cost layers (#209). */}
            <Stat label={t("warehouseProduct.readyValue")} testId="warehouse-product-ready-value">
              {summary ? formatRupiah(summary.readyValue) : "—"}
            </Stat>

            <Stat label={t("warehouseProduct.lastOpname")} testId="warehouse-product-last-opname">
              {lastOpname ? lastOpname.createdAt : t("warehouseProduct.neverCounted")}
            </Stat>

            <Stat label={t("warehouseProduct.incoming")} testId="warehouse-product-incoming">
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
            </Stat>

            <Stat label={t("warehouseProduct.lastOrder")} testId="warehouse-product-last-order">
              {lastOrders[0] ? `#${lastOrders[0].id}` : t("warehouseProduct.none")}
            </Stat>

            <Stat label={t("warehouseProduct.lastRestock")} testId="warehouse-product-last-restock">
              {restocks[0] ? `#${restocks[0].id}` : t("warehouseProduct.none")}
            </Stat>
          </SimpleGrid>
        </Tabs.Content>

        {/* PRICES — stock value by COST LAYER (#209): each delivery froze its own HPP, so on-hand
            splits into layers and the shelf's value is their sum, not on-hand × one price. */}
        <Tabs.Content value="prices" flex="1" data-testid="wp-prices-panel">
          <Stack gap="card">
            <Table.Root size="sm" data-testid="wp-prices-table">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("warehouseProduct.unitCost")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("warehouseProduct.onHand")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("warehouseProduct.amount")}</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {layers.map((layer, i) => (
                  <Table.Row key={i}>
                    {/* ⚠ UNKNOWN IS NOT ZERO (#74): a layer with no recorded cost reads "Unknown". */}
                    <Table.Cell>
                      {layer.costKnown ? formatRupiah(layer.unitCost) : t("warehouseProduct.costUnknown")}
                    </Table.Cell>
                    <Table.Cell textAlign="end">{layer.onHand.toString()}</Table.Cell>
                    <Table.Cell textAlign="end">
                      {layer.costKnown ? formatRupiah(layer.amount) : t("warehouseProduct.costUnknown")}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>

            {layers.length === 0 ? (
              <Text color="fg.muted" data-testid="wp-prices-empty">
                {t("warehouseProduct.noStock")}
              </Text>
            ) : (
              <Stat label={t("warehouseProduct.valuation")} testId="warehouse-product-valuation">
                {formatRupiah(layersTotal)}
              </Stat>
            )}
          </Stack>
        </Tabs.Content>

        {/* Where it sits, and when it last moved (#209): a stale Last opname flags a shelf overdue for
            a count — the whole reason the dates ride beside the quantity. */}
        <Tabs.Content value="placement" flex="1">
          <Table.Root size="sm" data-testid="wp-placement-table">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>{t("warehouseProduct.place")}</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">{t("warehouseProduct.onHand")}</Table.ColumnHeader>
                <Table.ColumnHeader>{t("warehouseProduct.lastOut")}</Table.ColumnHeader>
                <Table.ColumnHeader>{t("warehouseProduct.lastIn")}</Table.ColumnHeader>
                <Table.ColumnHeader>{t("warehouseProduct.lastOpnameCol")}</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {places.map((p) => {
                const d = datesByRack.get(p.rackId);
                const opname = d?.lastOpnameUnix ?? 0n;
                return (
                  <Table.Row key={`${p.rackId}-${p.rackCode}`}>
                    <Table.Cell>
                      {/* The unplaced pile is a REAL place (#135), named in words rather than blank. */}
                      {p.rackId === 0n ? t("racks.select.unplaced") : p.rackCode}
                    </Table.Cell>
                    <Table.Cell textAlign="end">{p.onHand.toString()}</Table.Cell>
                    <Table.Cell>{d && d.lastOutUnix > 0n ? formatDateUnix(d.lastOutUnix) : "—"}</Table.Cell>
                    <Table.Cell>{d && d.lastInUnix > 0n ? formatDateUnix(d.lastInUnix) : "—"}</Table.Cell>
                    <Table.Cell>
                      {opname > 0n ? (
                        <Text color={isStaleOpname(opname) ? "orange.fg" : undefined}>
                          {formatDateUnix(opname)}
                        </Text>
                      ) : (
                        "—"
                      )}
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>

          {places.length === 0 && (
            <Text color="fg.muted" data-testid="wp-placement-empty">
              {t("warehouseProduct.noStock")}
            </Text>
          )}
        </Tabs.Content>

        {/* Tab 4 — everything that ever happened to it here, filterable by batch (#209). */}
        <Tabs.Content value="history" flex="1">
          <Stack gap="card">
            <Flex gap="card" wrap="wrap">
              <FilterSelect
                label={t("warehouseProduct.batch")}
                value={historyBatch}
                onChange={setHistoryBatch}
                testId="wp-history-batch-filter"
                allLabel={t("warehouseProduct.allBatches")}
                options={batchOptions}
              />
            </Flex>
            <MovementTable
              movements={filteredHistory}
              t={t}
              testId="wp-history-table"
              kindLabel={kindLabel}
              actorNames={actorNames}
              rackLabel={rackLabel}
            />
          </Stack>
        </Tabs.Content>

        {/* Tab 5 — only the shelf-to-shelf moves (#136), filterable by rack AND batch (#209). */}
        <Tabs.Content value="placementHistory" flex="1">
          <Stack gap="card">
            <Flex gap="card" wrap="wrap">
              {/* A FILTER, not a destination picker: it offers "All" and only the racks in view, which
                  is why it is a NativeSelect rather than RackSelect (that one is for choosing where
                  stock GOES, and deliberately has no "All"). */}
              <FilterSelect
                label={t("warehouseProduct.rack")}
                value={phRack}
                onChange={setPhRack}
                testId="wp-ph-rack-filter"
                allLabel={t("warehouseProduct.allRacks")}
                options={phRackIds.map((id) => ({ value: id.toString(), label: rackLabel(id) }))}
              />
              <FilterSelect
                label={t("warehouseProduct.batch")}
                value={phBatch}
                onChange={setPhBatch}
                testId="wp-ph-batch-filter"
                allLabel={t("warehouseProduct.allBatches")}
                options={batchOptions}
              />
            </Flex>
            <MovementTable
              movements={filteredPlacementHistory}
              t={t}
              testId="wp-placement-history-table"
              kindLabel={kindLabel}
              actorNames={actorNames}
              rackLabel={rackLabel}
            />
          </Stack>
        </Tabs.Content>

        {/* BATCHES — the deliveries of this product as COST LAYERS (#209): each carries its own frozen
            cost and a lifecycle (Arrived = Damaged + Used + Ready), and the number optionally expires. */}
        <Tabs.Content value="batches" flex="1">
          <Stack gap="card">
            <Table.Root size="sm" data-testid="wp-batches-table">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>{t("warehouseProduct.delivery")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("warehouseProduct.arrived")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("warehouseProduct.damaged")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("warehouseProduct.used")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("warehouseProduct.ready")}</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="end">{t("warehouseProduct.lineCost")}</Table.ColumnHeader>
                  <Table.ColumnHeader>{t("warehouseProduct.expiring")}</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {batchRows.map((b) => (
                  <Table.Row key={b.id.toString()} data-testid={`wp-batch-${b.deliveryId}`}>
                    <Table.Cell>
                      <Text as="span" fontWeight="medium">
                        #{b.deliveryId.toString()}
                      </Text>
                      {b.receiptNo && (
                        <Text as="span" color="fg.subtle" ml="1">
                          {b.receiptNo}
                        </Text>
                      )}
                    </Table.Cell>
                    <Table.Cell textAlign="end">{b.arrived.toString()}</Table.Cell>
                    <Table.Cell textAlign="end">{b.damaged.toString()}</Table.Cell>
                    <Table.Cell textAlign="end">{b.used.toString()}</Table.Cell>
                    <Table.Cell textAlign="end">{b.ready.toString()}</Table.Cell>
                    <Table.Cell textAlign="end">
                      {b.costKnown ? formatRupiah(b.lineCost) : t("warehouseProduct.costUnknown")}
                    </Table.Cell>
                    <Table.Cell>
                      {b.expiresOnUnix > 0n ? (
                        <Text color={isExpiringSoon(b.expiresOnUnix) ? "orange.fg" : undefined}>
                          {formatDateUnix(b.expiresOnUnix)}
                        </Text>
                      ) : (
                        "—"
                      )}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>

            {batchRows.length === 0 && (
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

// One labelled figure. Extracted because the Info and Prices tabs are nine of them between them, and
// nine copies of a label-over-value Stack is how two of them end up styled differently.
function Stat({ label, testId, children }: { label: string; testId: string; children: React.ReactNode }) {
  return (
    <Stack gap="0">
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Text fontWeight="medium" data-testid={testId}>
        {children}
      </Text>
    </Stack>
  );
}

// A labelled filter dropdown, "All" first. A filter over data in view — NativeSelect, not a picker.
function FilterSelect({
  label,
  value,
  onChange,
  testId,
  allLabel,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testId: string;
  allLabel: string;
  options: { value: string; label: string }[];
}) {
  return (
    <Field.Root maxW="52">
      <Field.Label>{label}</Field.Label>
      <NativeSelect.Root>
        <NativeSelect.Field
          value={value}
          data-testid={testId}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{allLabel}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    </Field.Root>
  );
}

// The ledger, rendered. Shared by the two history tabs so a movement reads identically in both — the
// only difference between them is which kinds the server was asked for. By (#209) resolves the actor's
// name; Batch names the delivery its units came from ("—" for a batch-less shelf recount); Place is the
// rack CODE, both resolved best-effort with an "#id" fallback.
function MovementTable({
  movements,
  t,
  testId,
  kindLabel: label,
  actorNames,
  rackLabel,
}: {
  movements: StockMovement[];
  t: ReturnType<typeof useTranslation>["t"];
  testId: string;
  kindLabel: (t: ReturnType<typeof useTranslation>["t"], kind: MovementKind) => string;
  actorNames: Map<string, string>;
  rackLabel: (rackId: bigint) => string;
}) {
  return (
    <Stack gap="card">
      <Table.Root size="sm" data-testid={testId}>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("warehouseProduct.when")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("warehouseProduct.what")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("warehouseProduct.by")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("warehouseProduct.batch")}</Table.ColumnHeader>
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
                {m.actorUserId > 0n
                  ? actorNames.get(m.actorUserId.toString()) ?? `#${m.actorUserId}`
                  : "—"}
              </Table.Cell>
              {/* A batch-less shelf recount lands on the oldest batch by FIFO but names none (#211). */}
              <Table.Cell>{m.batchId > 0n ? `#${m.batchId}` : "—"}</Table.Cell>
              <Table.Cell>{rackLabel(m.rackId)}</Table.Cell>
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
