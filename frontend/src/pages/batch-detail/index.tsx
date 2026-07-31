import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Flex,
  Heading,
  Icon,
  IconButton,
  Input,
  InputGroup,
  Separator,
  SimpleGrid,
  Spinner,
  Stack,
  Stat,
  Table,
  Tabs,
  Text,
} from "@chakra-ui/react";
import { ArrowLeft, Package, Pencil, Search } from "lucide-react";

import { rpcError } from "../../api/clients";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { BatchOrigin } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { formatRupiah } from "../../lib/money";
import { useTeam } from "../../features/team/TeamContext";
import { MovementTable } from "../../features/inventory/MovementTable";
import { useBatchDetail, useBatchHistory, useBatchPlacements } from "../../features/inventory/queries";
import { AdjustStockDialog } from "../../features/inventory/AdjustStockDialog";
import { Pagination } from "../../components/Pagination";
import {
  ALL_DATES,
  DateRangePicker,
  resolveRange,
  type DateRange,
} from "../../components/DateRangePicker";

const HISTORY_PAGE_SIZE = 20;
const PLACEMENTS_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [10, 20, 50];

function parseId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

function formatDateUnix(unix: bigint): string {
  if (unix <= 0n) return "—";
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
// Same rule as the warehouse product's placement tab.
function isStaleOpname(unix: bigint): boolean {
  return Number(unix) * 1000 < Date.now() - 14 * 24 * 60 * 60 * 1000;
}

// BatchDetailPage is one batch's living detail (#209) — drilled into from the Batches list or a
// delivery on the warehouse product's Batches tab. A batch = one product's units from one delivery,
// carrying a frozen cost (HPP), a lifecycle (Arrived = Damaged + Used + Ready), where its ready units
// sit now, and its own history.
export function BatchDetailPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { batchId: raw } = useParams();
  const batchId = parseId(raw);

  const isWarehouse = current?.teamType === TeamType.WAREHOUSE;
  const warehouseId = isWarehouse ? current?.teamId : undefined;

  const query = useBatchDetail({ warehouseId, batchId });
  const data = query.data;
  const batch = data?.batch ?? null;
  const product = data?.product ?? null;

  const [adjusting, setAdjusting] = useState(false);

  // Placements pages on its own (#218) — its own read, independent of the detail aggregate. The rack
  // search filters the loaded page client-side (a batch sits on a handful of shelves); changing it
  // resets to page 1.
  const [placementPage, setPlacementPage] = useState(1);
  const [placementPageSize, setPlacementPageSize] = useState(PLACEMENTS_PAGE_SIZE);
  const [rackSearch, setRackSearch] = useState("");
  const placementsQuery = useBatchPlacements({
    warehouseId,
    batchId,
    page: placementPage,
    pageSize: placementPageSize,
  });
  const shelves = placementsQuery.data?.shelves ?? [];
  const placementsTotal = Number(placementsQuery.data?.pageInfo?.totalItems ?? 0n);

  // The History tab pages on its own (#218), independent of the detail aggregate above, and filters
  // by a date range on the movement timestamp — server-side, so it narrows the whole ledger, not just
  // the loaded page. Changing either bound resets to page 1.
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(HISTORY_PAGE_SIZE);
  const [historyRange, setHistoryRange] = useState<DateRange>(ALL_DATES);
  const { fromUnix: historyFromUnix, toUnix: historyToUnix } = resolveRange(historyRange);
  const historyQuery = useBatchHistory({
    warehouseId,
    productId: batch?.productId ?? 0n,
    batchId,
    page: historyPage,
    pageSize: historyPageSize,
    fromUnix: historyFromUnix,
    toUnix: historyToUnix,
  });
  const historyMovements = historyQuery.data?.movements ?? [];
  const historyTotal = Number(historyQuery.data?.pageInfo?.totalItems ?? 0n);

  // The place a shelf sits: its painted code, the named unplaced pile (#135), or a bare id if the code
  // could not be resolved.
  const placeLabel = (rackId: bigint): string => {
    if (rackId === 0n) return t("racks.select.unplaced");
    return data?.rackCodes.get(rackId.toString()) ?? `#${rackId.toString()}`;
  };

  // Placements filtered by the rack-name search — matched on the resolved place label, so a search hits
  // the painted code the operator actually reads, not the internal id.
  const rackQuery = rackSearch.trim().toLowerCase();
  const filteredShelves = shelves.filter(
    (s) => rackQuery === "" || placeLabel(s.rackId).toLowerCase().includes(rackQuery),
  );

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("batchDetail.title")}</Heading>
        <Text color="fg.muted">{t("batches.selectTeam")}</Text>
      </Stack>
    );
  }

  if (!isWarehouse) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("batchDetail.title")}</Heading>
        <Text color="fg.muted" data-testid="batch-detail-not-warehouse">
          {t("batches.warehouseOnly")}
        </Text>
      </Stack>
    );
  }

  if (query.isPending) {
    return <Spinner colorPalette="brand" />;
  }

  if (query.isError) {
    return (
      <Stack gap="section">
        <BackButton onClick={() => navigate("/inventories/batches")} label={t("batchDetail.back")} />
        <Text color="red.fg" data-testid="batch-detail-error">
          {rpcError(query.error)}
        </Text>
      </Stack>
    );
  }

  if (!batch) {
    return (
      <Stack gap="section">
        <BackButton onClick={() => navigate("/inventories/batches")} label={t("batchDetail.back")} />
        <Text color="fg.muted" data-testid="batch-detail-missing">
          {t("batchDetail.notFound")}
        </Text>
      </Stack>
    );
  }

  const cost = (v: bigint) => (batch.costKnown ? formatRupiah(v) : t("batchDetail.costUnknown"));
  // A lifecycle figure's value = its count × the frozen unit cost (Unknown when the cost isn't known).
  const amount = (count: bigint) => cost(count * batch.unitCost);

  return (
    <Stack gap="section" data-testid="batch-detail-page">
      {/* Adjust sits ABOVE the box, top-right — it acts on THIS batch via the shared stock dialog (#218). */}
      <Flex justify="end">
        <Button
          variant="outline"
          size="sm"
          data-testid="batch-detail-adjust"
          disabled={!product}
          onClick={() => setAdjusting(true)}
        >
          <Icon as={Pencil} boxSize="4" />
          {t("batchDetail.adjust")}
        </Button>
      </Flex>

      {/* Header — a TWO-COLUMN grid: PRODUCT | BATCH, both left-aligned. */}
      <SimpleGrid columns={{ base: 1, md: 2 }} gap="section">
        {/* PRODUCT INFO — cover image beside the name (H1) and code. */}
        <Flex gap="card" align="center" minW="0">
          <Avatar.Root shape="rounded" size="2xl" colorPalette="gray" flexShrink={0}>
            <Avatar.Fallback>
              <Icon as={Package} boxSize="6" />
            </Avatar.Fallback>
            <Avatar.Image
              src={product?.defaultImageThumbnailUrl || product?.defaultImageUrl || undefined}
              alt={batch.name}
            />
          </Avatar.Root>
          <Stack gap="1" minW="0" align="start">
            <Heading as="h1" size="lg" data-testid="batch-detail-product-name">
              {batch.name}
            </Heading>
            <Text color="fg.subtle" fontSize="sm" data-testid="batch-detail-product-code">
              {batch.sku}
            </Text>
            {/* The owning team — whose goods these are (#142). */}
            {data?.ownerName && (
              <Badge colorPalette="brand" data-testid="batch-detail-owner">
                {data.ownerName}
              </Badge>
            )}
          </Stack>
        </Flex>

        {/* BATCH INFO — the batch number, origin, expiry, and its receipt/order. */}
        <Stack gap="0">
          <Flex align="center" gap="2" wrap="wrap">
            <Heading size="md" data-testid="batch-detail-name">
              {t("batchDetail.batchNo", { id: batch.deliveryId.toString() })}
            </Heading>
            {/* Restock vs return origin (#218) — UNSPECIFIED reads as a restock. */}
            <Badge
              colorPalette={batch.origin === BatchOrigin.RETURN ? "orange" : "gray"}
              data-testid="batch-detail-origin"
            >
              {t(batch.origin === BatchOrigin.RETURN ? "batchDetail.originReturn" : "batchDetail.originRestock")}
            </Badge>
            {batch.expiresOnUnix > 0n && isExpiringSoon(batch.expiresOnUnix) && (
              <Badge colorPalette="orange" data-testid="batch-detail-expiring">
                {t("batchDetail.expiring", { date: formatDateUnix(batch.expiresOnUnix) })}
              </Badge>
            )}
          </Flex>
          {/* Receipt (GRN) and a link to the order/delivery it arrived on. */}
          <Text fontSize="sm" color="fg.subtle" data-testid="batch-detail-receipt-order">
            {batch.receiptNo && `${batch.receiptNo} · `}
            <Text
              as="span"
              color="brand.fg"
              cursor="pointer"
              textDecoration="underline"
              data-testid="batch-detail-order"
              onClick={() => navigate(`/inventories/restock/${batch.deliveryId}`)}
            >
              {t("batchDetail.order", { id: batch.deliveryId.toString() })}
            </Text>
          </Text>
          {/* Who accepted the delivery — resolved best-effort (#142). */}
          {data?.acceptedByName && (
            <Text fontSize="sm" color="fg.subtle" data-testid="batch-detail-received-by">
              {t("batchDetail.receivedBy", { name: data.acceptedByName })}
            </Text>
          )}
        </Stack>
      </SimpleGrid>

      {warehouseId !== undefined && product && (
        <AdjustStockDialog
          warehouseId={warehouseId}
          product={product}
          currentOnHand={batch.ready}
          open={adjusting}
          onOpenChange={setAdjusting}
        />
      )}

      <Separator />

      {/* LIFECYCLE — on top, no card, one Chakra Stat per figure. Arrived = Broken + Lost + Used + Ready
          (#218). */}
      <SimpleGrid columns={{ base: 2, md: 5 }} gap="card">
        <Stat.Root>
          <Stat.Label>{t("batchDetail.arrived")}</Stat.Label>
          <Stat.ValueText data-testid="batch-detail-arrived">{batch.arrived.toString()}</Stat.ValueText>
          <Stat.HelpText>{cost(batch.lineCost)}</Stat.HelpText>
          {/* The batch is minted AT acceptance, so its created_at IS the arrival date. */}
          <Stat.HelpText data-testid="batch-detail-arrived-date">
            {formatDateUnix(batch.createdAtUnix)}
          </Stat.HelpText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label>{t("batchDetail.broken")}</Stat.Label>
          <Stat.ValueText color={batch.broken > 0n ? "red.fg" : undefined} data-testid="batch-detail-broken">
            {batch.broken.toString()}
          </Stat.ValueText>
          <Stat.HelpText>{amount(batch.broken)}</Stat.HelpText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label>{t("batchDetail.lost")}</Stat.Label>
          <Stat.ValueText color={batch.lost > 0n ? "red.fg" : undefined} data-testid="batch-detail-lost">
            {batch.lost.toString()}
          </Stat.ValueText>
          <Stat.HelpText>{amount(batch.lost)}</Stat.HelpText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label>{t("batchDetail.used")}</Stat.Label>
          <Stat.ValueText>{batch.used.toString()}</Stat.ValueText>
          <Stat.HelpText>{amount(batch.used)}</Stat.HelpText>
        </Stat.Root>
        <Stat.Root>
          <Stat.Label>{t("batchDetail.ready")}</Stat.Label>
          <Stat.ValueText color={batch.ready > 0n ? "green.fg" : undefined} data-testid="batch-detail-ready">
            {batch.ready.toString()}
          </Stat.ValueText>
          <Stat.HelpText>{cost(batch.readyValue)}</Stat.HelpText>
        </Stat.Root>
      </SimpleGrid>

      {/* TABS — where it sits now, and its own ledger (#198 vertical tabs). */}
      <Card.Root>
        <Card.Body>
          <Tabs.Root defaultValue="placements" orientation="vertical">
            <Tabs.List>
              <Tabs.Trigger value="placements" data-testid="batch-detail-tab-placements">
                {t("batchDetail.tabPlacements")}
              </Tabs.Trigger>
              <Tabs.Trigger value="history" data-testid="batch-detail-tab-history">
                {t("batchDetail.tabHistory")}
              </Tabs.Trigger>
            </Tabs.List>

            {/* PLACEMENTS — the shelves that still hold some of this batch. */}
            <Tabs.Content value="placements" flex="1">
              {/* Rack-name search — client-side over the loaded page (a batch sits on a handful of shelves). */}
              <InputGroup startElement={<Icon as={Search} boxSize="4" color="fg.subtle" />} mb="card" maxW="xs">
                <Input
                  placeholder={t("batchDetail.searchRack")}
                  aria-label={t("batchDetail.searchRack")}
                  value={rackSearch}
                  data-testid="batch-detail-rack-search"
                  onChange={(e) => {
                    setRackSearch(e.target.value);
                    setPlacementPage(1);
                  }}
                />
              </InputGroup>
              <Table.Root striped data-testid="batch-detail-placements-table">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>{t("batchDetail.place")}</Table.ColumnHeader>
                    <Table.ColumnHeader textAlign="end">{t("batchDetail.readyHere")}</Table.ColumnHeader>
                    <Table.ColumnHeader>{t("batchDetail.lastOpname")}</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {filteredShelves.map((s) => (
                    <Table.Row key={s.rackId.toString()}>
                      <Table.Cell>{placeLabel(s.rackId)}</Table.Cell>
                      <Table.Cell textAlign="end">{s.qty.toString()}</Table.Cell>
                      <Table.Cell>
                        {s.lastOpnameUnix > 0n ? (
                          <Text color={isStaleOpname(s.lastOpnameUnix) ? "orange.fg" : undefined}>
                            {formatDateUnix(s.lastOpnameUnix)}
                          </Text>
                        ) : (
                          <Text color="fg.subtle">{t("batchDetail.neverCounted")}</Text>
                        )}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
              {filteredShelves.length === 0 ? (
                <Text color="fg.muted" data-testid="batch-detail-placements-empty">
                  {shelves.length === 0
                    ? t("batchDetail.noPlacements")
                    : t("batchDetail.noRackMatch")}
                </Text>
              ) : (
                <Pagination
                  page={placementPage}
                  pageSize={placementPageSize}
                  count={placementsTotal}
                  onPageChange={setPlacementPage}
                  pageSizeOptions={PAGE_SIZE_OPTIONS}
                  onPageSizeChange={(size) => {
                    setPlacementPageSize(size);
                    setPlacementPage(1);
                  }}
                />
              )}
            </Tabs.Content>

            {/* HISTORY — this batch's ledger. A batch-less recount (batch_id 0) does not appear here. */}
            <Tabs.Content value="history" flex="1">
              {/* Date range over the movement timestamp (#218/#224) — the shared Grafana-style picker.
                  Server applies it, so it narrows the whole ledger, not just this page. */}
              <Flex mb="card">
                <DateRangePicker
                  value={historyRange}
                  onChange={(r) => {
                    setHistoryRange(r);
                    setHistoryPage(1);
                  }}
                  testId="batch-detail-date"
                />
              </Flex>
              {/* The shared ledger (features/inventory/MovementTable). "Ready after" stays this page's
                  wording: the balance here is the BATCH's ready units, which is not the same number as
                  a shelf's count or a place's balance (#135). */}
              <MovementTable
                movements={historyMovements}
                testId="batch-detail-history"
                columns={["place"]}
                rackLabel={placeLabel}
                afterLabel={t("batchDetail.after")}
                emptyText={t("batchDetail.noHistory")}
                striped
              />
              {historyMovements.length === 0 ? null : (
                <Pagination
                  page={historyPage}
                  pageSize={historyPageSize}
                  count={historyTotal}
                  onPageChange={setHistoryPage}
                  pageSizeOptions={PAGE_SIZE_OPTIONS}
                  onPageSizeChange={(size) => {
                    setHistoryPageSize(size);
                    setHistoryPage(1);
                  }}
                />
              )}
            </Tabs.Content>
          </Tabs.Root>
        </Card.Body>
      </Card.Root>
    </Stack>
  );
}

// Icon-only back — the arrow alone, the label kept as aria-label so it still reads to assistive tech.
function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <IconButton
      variant="ghost"
      size="sm"
      onClick={onClick}
      aria-label={label}
      data-testid="batch-detail-back"
    >
      <Icon as={ArrowLeft} boxSize="4" />
    </IconButton>
  );
}
