import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Badge, Box, Button, Flex, Heading, Icon, IconButton, Span, Stack, Table, Tabs, Text } from "@chakra-ui/react";
import { ArrowLeft, History, Pencil, Warehouse } from "lucide-react";

import { rpcError } from "../../api/clients";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { BatchOrigin } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { formatRupiah } from "../../lib/money";
import { useTeam } from "../../features/team/TeamContext";
import { MovementTable } from "../../features/inventory/MovementTable";
import { BatchExplainer } from "../../features/inventory/BatchExplainer";
import { BatchSource } from "../../features/inventory/BatchSource";
import { BATCH_PENDING } from "../../features/inventory/pending";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { useBatchDetail, useBatchHistory, useBatchPlacements } from "../../features/inventory/queries";
import { AdjustStockDialog } from "../../features/inventory/AdjustStockDialog";
import { SummaryCard, SummaryStrip } from "../../features/orders/SummaryCard";
import { CompactActions } from "../../components/chrome/CompactActions";
import { FilterSearch } from "../../components/chrome/FilterBar";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { ALL_DATES, DateRangePicker, resolveRange } from "../../components/datetime/DateRangePicker";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { ProductListItem } from "../../components/products/ProductListItem";
import { TeamItem } from "../../components/entity/TeamItem";
import { useIsMobile } from "../../layouts/shell";
import { cameFrom } from "../../lib/cameFrom";
import { formatUnixDateShort, formatUnixDateTimeShort } from "../../lib/datetime";
import { dateRangeCodec, textCodec, useUrlState } from "../../lib/urlState";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// A ROW LIGHTS UP UNDER THE POINTER, every cell of it (a-table-row-lights-up).
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

function parseId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
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
//
// ON THE SCREEN RULES (owner: *"inisiasi dan kasih keterangan batch itu apa"*, the-batches-follow-the-screen-rules):
//
//   ←  Batch #5031  [Restok] [Kedaluwarsa 27 Nov]                              [✎ Koreksi]
//      [img] Beras Pandan Wangi 5kg · SKU-BERAS-5K      [TM] Toko Melati
//      Dari Restok #503 · SCP5544332211 · Diterima oleh Budi Santoso (budi)
//      [ⓘ Apa itu batch? ⌄]                                                   ← a-batch-says-what-it-is
//   [Tiba 10] [Rusak 2] [Hilang 1] [Terpakai 0] [Siap 7]                       ← the card strip, each with its value
//   Ditaruh Saat Diterima │ Tempat   Ditaruh   Opname terakhir
//   Riwayat               │ A-01-1        5   Belum pernah dihitung
export function BatchDetailPage() {
  const { current } = useTeam();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { batchId: raw } = useParams();
  const batchId = parseId(raw);
  // EVERY WAY OUT GOES WHERE THE PAGE WAS OPENED (a-form-returns-where-it-was-opened) — the list with its filters; by a
  // link, the list.
  const backTo = cameFrom(useLocation()) ?? "/inventories/batches";

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
  //
  // THE TWO LISTS' FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — the rack search here, the
  // history's range below. The tab does not: it picks a different panel, not a narrower list.
  const [placementPage, setPlacementPage] = useState(1);
  const [placementPageSize, setPlacementPageSize] = useState(20);
  const [rackSearch, setRackSearch] = useUrlState("rack", "", textCodec);
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
  const [historyPageSize, setHistoryPageSize] = useState(20);
  const [historyRange, setHistoryRange] = useUrlState("range", ALL_DATES, dateRangeCodec);
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

  // Back is its icon alone, in the title's row.
  const back = (
    <IconButton
      variant="ghost"
      size="sm"
      flexShrink={0}
      onClick={() => navigate(backTo)}
      aria-label={t("batchDetail.back")}
      title={t("batchDetail.back")}
      data-testid="batch-detail-back"
    >
      <Icon as={ArrowLeft} boxSize="4" />
    </IconButton>
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

  // The first load shows the page's shape (motion-is-small-quick-and-shared).
  if (query.isPending) {
    return <ListSkeleton heading rows={3} testId="batch-detail-loading" />;
  }

  if (query.isError || !batch) {
    return (
      <Stack gap="section">
        <Box>{back}</Box>
        <Text color={query.isError ? "error.fg" : "fg.muted"} data-testid={query.isError ? "batch-detail-error" : "batch-detail-missing"}>
          {query.isError ? rpcError(query.error) : t("batchDetail.notFound")}
        </Text>
      </Stack>
    );
  }

  const cost = (v: bigint) => (batch.costKnown ? formatRupiah(v) : t("batchDetail.costUnknown"));
  // A lifecycle figure's value = its count × the frozen unit cost (Unknown when the cost isn't known).
  const amount = (count: bigint) => cost(count * batch.unitCost);
  const isReturn = batch.origin === BatchOrigin.RETURN;

  // Koreksi carries its icon — on a phone, its icon alone (a-phone-header-action-is-an-icon). It acts on THIS batch via
  // the shared stock dialog (#218).
  const actions = isMobile ? (
    <CompactActions
      menuLabel={t("batchDetail.actions")}
      actions={[
        {
          id: "adjust",
          label: t("batchDetail.adjust"),
          icon: Pencil,
          disabled: !product,
          testId: "batch-detail-adjust",
          onClick: () => setAdjusting(true),
        },
      ]}
    />
  ) : (
    <Button variant="outline" flexShrink={0} data-testid="batch-detail-adjust" disabled={!product} onClick={() => setAdjusting(true)}>
      <Icon as={Pencil} boxSize="4" />
      {t("batchDetail.adjust")}
    </Button>
  );

  return (
    // The page arrives — a fade and a short rise (motion-is-small-quick-and-shared).
    <Stack gap="section" animationStyle="enter" data-testid="batch-detail-page">
      {/* THE TITLE'S ROW (the-phone-header-is-one-row) — back, the batch's OWN number (the one in a label's QR), where
          it came from and whether it expires soon, and Koreksi. */}
      <Stack gap="2">
        <Flex align="center" gap={isMobile ? "2" : "card"}>
          {back}
          <Flex align="center" gap="2" wrap="wrap" flex="1" minW="0">
            <Heading size="lg" data-testid="batch-detail-name">
              {t("batchDetail.batchNo", { id: batch.id.toString() })}
            </Heading>
            {/* Restock vs return origin (#218) — UNSPECIFIED reads as a restock. Categorical, so a hue. */}
            <Badge colorPalette={isReturn ? "orange" : "gray"} data-testid="batch-detail-origin">
              {t(isReturn ? "batchDetail.originReturn" : "batchDetail.originRestock")}
            </Badge>
            {batch.expiresOnUnix > 0n && isExpiringSoon(batch.expiresOnUnix) && (
              <Badge colorPalette="warning" data-testid="batch-detail-expiring">
                {t("batchDetail.expiring", { date: formatUnixDateShort(batch.expiresOnUnix) })}
              </Badge>
            )}
          </Flex>
          {actions}
        </Flex>

        {/* WHAT IT IS A BATCH OF, AND WHOSE — the product with its picture, then where it came from and who took it in. */}
        <Stack gap="1" ps={isMobile ? "0" : "10"}>
          <Flex align="center" gap="card" wrap="wrap">
            <Box data-testid="batch-detail-product-name">
              {/* The SKU copies (sku-is-copyable). */}
              <ProductListItem
                skuCopyable
                product={
                  product
                    ? { ...product, teamId: undefined }
                    : { id: batch.productId, name: batch.name, sku: batch.sku }
                }
              />
            </Box>
            {/* The owning team — whose goods these are (#142): always a selling team, so the small avatar and the name
                alone (a-team-of-a-known-type-shows-no-badge). */}
            {data?.owner && (
              <Box data-testid="batch-detail-owner" minW="0">
                <TeamItem
                  size="xs"
                  team={{
                    teamId: data.owner.id,
                    teamName: data.owner.name,
                    teamType: data.owner.type,
                    imageUrl: data.owner.imageUrl,
                  }}
                />
              </Box>
            )}
          </Flex>
          {/* WHERE IT CAME FROM, AS A WAY THERE (a-batch-opens-where-it-came-from) — the restock's page, or a return's
              ⚠; no resi, it is the restock's. Then who received it. */}
          <Text fontSize="sm" color="fg.muted" data-testid="batch-detail-receipt-order">
            <BatchSource batch={batch} prefix="from" testId={isReturn ? "batch-detail-return" : "batch-detail-order"} />
            {/* Who accepted the delivery — resolved best-effort (#142). */}
            {data?.acceptedByName && (
              <Span data-testid="batch-detail-received-by">
                {" · "}
                {t("batchDetail.receivedBy", { name: data.acceptedByName })}
              </Span>
            )}
          </Text>
          <Box ms="-1">
            <BatchExplainer />
          </Box>
        </Stack>
      </Stack>

      {/* What is not wired yet — only a return's batch shows it (features/inventory/pending.ts). */}
      {isReturn && <NotImplementedSummary list={BATCH_PENDING} />}

      {warehouseId !== undefined && product && (
        <AdjustStockDialog
          warehouseId={warehouseId}
          product={product}
          currentOnHand={batch.ready}
          open={adjusting}
          onOpenChange={setAdjusting}
        />
      )}

      {/* THE LIFECYCLE, the card strip (a-list-summary-is-the-order-lists-card-strip) — Tiba = Rusak + Hilang + Terpakai
          + Siap (#218); each figure's value under it, at the batch's frozen cost. What is left leads. */}
      <SummaryStrip testId="batch-detail-lifecycle">
        <SummaryCard
          label={t("batchDetail.arrived")}
          value={<Span data-testid="batch-detail-arrived">{batch.arrived.toString()}</Span>}
          // The batch is minted AT acceptance, so its created_at IS the arrival date.
          line={
            <>
              {cost(batch.lineCost)}
              {" · "}
              <Span data-testid="batch-detail-arrived-date">{formatUnixDateTimeShort(batch.createdAtUnix)}</Span>
            </>
          }
          testId="batch-detail-arrived-card"
        />
        <SummaryCard
          label={t("batchDetail.broken")}
          value={
            <Span color={batch.broken > 0n ? "error.fg" : undefined} data-testid="batch-detail-broken">
              {batch.broken.toString()}
            </Span>
          }
          line={amount(batch.broken)}
          testId="batch-detail-broken-card"
        />
        <SummaryCard
          label={t("batchDetail.lost")}
          value={
            <Span color={batch.lost > 0n ? "error.fg" : undefined} data-testid="batch-detail-lost">
              {batch.lost.toString()}
            </Span>
          }
          line={amount(batch.lost)}
          testId="batch-detail-lost-card"
        />
        <SummaryCard
          label={t("batchDetail.used")}
          value={<Span data-testid="batch-detail-used">{batch.used.toString()}</Span>}
          line={amount(batch.used)}
          testId="batch-detail-used-card"
        />
        <SummaryCard
          emphasis
          label={t("batchDetail.ready")}
          value={<Span data-testid="batch-detail-ready">{batch.ready.toString()}</Span>}
          line={cost(batch.readyValue)}
          testId="batch-detail-ready-card"
        />
      </SummaryStrip>

      {/* TABS — where it was put, and its own ledger (#198 vertical tabs) — across the top on a phone, scrolling in
          their own row (nothing-runs-past-a-phones-edge). */}
      <Tabs.Root defaultValue="placements" orientation={isMobile ? "horizontal" : "vertical"} data-testid="batch-detail-tabs">
        <Tabs.List
          minW={isMobile ? undefined : "48"}
          flexShrink={0}
          flexWrap="nowrap"
          overflowX={isMobile ? "auto" : undefined}
          overflowY={isMobile ? "hidden" : undefined}
        >
          <Tabs.Trigger value="placements" flexShrink={0} data-testid="batch-detail-tab-placements">
            {t("batchDetail.tabPlacements")}
          </Tabs.Trigger>
          <Tabs.Trigger value="history" flexShrink={0} data-testid="batch-detail-tab-history">
            {t("batchDetail.tabHistory")}
          </Tabs.Trigger>
        </Tabs.List>

        {/* PLACEMENTS — the shelves the accept put this batch on (a-batch-shows-the-racks-it-was-put-on). */}
        <Tabs.Content value="placements" flex="1" minW="0">
          <Stack gap="card">
            {/* Rack search — client-side over the loaded page (a batch sits on a handful of shelves); its × clears it. */}
            <Box maxW="xs">
              <FilterSearch
                value={rackSearch}
                onChange={(value) => {
                  setRackSearch(value);
                  setPlacementPage(1);
                }}
                placeholder={t("batchDetail.searchRack")}
                testId="batch-detail-rack-search"
              />
            </Box>

            {placementsQuery.isPending ? (
              <ListSkeleton rows={2} testId="batch-detail-placements-loading" />
            ) : filteredShelves.length === 0 ? (
              // AN EMPTY TAB SAYS WHY (an-empty-list-shows-a-hint) — never put on a rack, or no rack matches the search.
              <EmptyHint
                size="sm"
                icon={Warehouse}
                title={shelves.length === 0 ? t("batchDetail.noPlacements") : t("batchDetail.noRackMatch")}
                testId="batch-detail-placements-empty"
              />
            ) : (
              <Box overflowX="auto" w="full" maxW="full" minW="0">
                <Table.Root size="sm" data-testid="batch-detail-placements-table">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader>{t("batchDetail.place")}</Table.ColumnHeader>
                      <Table.ColumnHeader textAlign="end">{t("batchDetail.readyHere")}</Table.ColumnHeader>
                      <Table.ColumnHeader>{t("batchDetail.lastOpname")}</Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {filteredShelves.map((s) => (
                      <Table.Row key={s.rackId.toString()} css={LIGHTS_UP} data-testid={`batch-detail-shelf-${s.rackId}`}>
                        <Table.Cell fontWeight="bold">{placeLabel(s.rackId)}</Table.Cell>
                        <Table.Cell textAlign="end">{s.qty.toString()}</Table.Cell>
                        <Table.Cell>
                          {s.lastOpnameUnix > 0n ? (
                            <Text color={isStaleOpname(s.lastOpnameUnix) ? "warning.fg" : undefined}>
                              {formatUnixDateShort(s.lastOpnameUnix)}
                            </Text>
                          ) : (
                            <Text color="fg.muted">{t("batchDetail.neverCounted")}</Text>
                          )}
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </Box>
            )}

            <GrowingPager
              page={placementPage}
              onPageChange={setPlacementPage}
              hasNext={placementPage * placementPageSize < placementsTotal}
              resetKey={[rackQuery, placementPageSize].join("|")}
              pageSize={placementPageSize}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              onPageSizeChange={(size) => {
                setPlacementPageSize(size);
                setPlacementPage(1);
              }}
            />
          </Stack>
        </Tabs.Content>

        {/* HISTORY — this batch's ledger. A batch-less recount (batch_id 0) does not appear here. */}
        <Tabs.Content value="history" flex="1" minW="0">
          <Stack gap="card">
            {/* Date range over the movement timestamp (#218/#224) — server-side, so it narrows the whole ledger. */}
            <Flex>
              <DateRangePicker
                value={historyRange}
                onChange={(r) => {
                  setHistoryRange(r);
                  setHistoryPage(1);
                }}
                testId="batch-detail-date"
              />
            </Flex>
            {historyQuery.isPending && batch.productId > 0n ? (
              <ListSkeleton rows={3} testId="batch-detail-history-loading" />
            ) : (
              // The shared ledger, REWORKED (an-empty-list-shows-a-hint, a-table-row-lights-up, a-phone-reads-each-line-
              // as-a-block). "Ready after" stays this page's wording: the balance here is the BATCH's ready units, which is
              // not the same number as a shelf's count or a place's balance (#135).
              <MovementTable
                movements={historyMovements}
                testId="batch-detail-history"
                columns={["place"]}
                rackLabel={placeLabel}
                afterLabel={t("batchDetail.after")}
                emptyText={t("batchDetail.noHistory")}
                emptyIcon={History}
                emptyDescription={t("batchDetail.noHistoryHint")}
              />
            )}
            {/* Always on screen, an empty history included (the-pager-is-always-on-screen). */}
            <GrowingPager
              page={historyPage}
              onPageChange={setHistoryPage}
              hasNext={historyPage * historyPageSize < historyTotal}
              resetKey={[dateRangeCodec.encode(historyRange), historyPageSize].join("|")}
              pageSize={historyPageSize}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              onPageSizeChange={(size) => {
                setHistoryPageSize(size);
                setHistoryPage(1);
              }}
            />
          </Stack>
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}
