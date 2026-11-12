import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Badge, Box, Button, Flex, Grid, Heading, Icon, Span, Stack, Table, Text, useBreakpointValue } from "@chakra-ui/react";
import { History, Pencil, Tag, Warehouse } from "lucide-react";

import { rpcError } from "../../api/clients";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { BatchOrigin } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { isExpiringSoon } from "../../lib/expiry";
import { formatRupiah } from "../../lib/money";
import { canWrite, useTeam } from "../../features/team/TeamContext";
import { MovementTable } from "../../features/inventory/MovementTable";
import { BatchExplainer } from "../../features/inventory/BatchExplainer";
import { BatchSource } from "../../features/inventory/BatchSource";
import { ExpiryCell } from "../../features/inventory/ExpiryCell";
import { BATCH_PENDING } from "../../features/inventory/pending";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { useBatchDetail, useBatchHistory, useBatchPlacements } from "../../features/inventory/queries";
import { AdjustStockDialog } from "../../features/inventory/AdjustStockDialog";
import { CorrectPriceDialog } from "../../features/inventory/CorrectPriceDialog";
import { canCorrectPrice } from "../../features/inventory/priceChange";
import { ProductStickyStrip } from "../../features/products/ProductTitleRow";
import { SummaryCard, SummaryStrip } from "../../features/orders/SummaryCard";
import { CompactActions } from "../../components/chrome/CompactActions";
import { Fact, Section } from "../../components/chrome/DetailSection";
import { FilterSearch } from "../../components/chrome/FilterBar";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { SectionNav } from "../../components/chrome/SectionNav";
import { ALL_DATES, DateRangePicker, resolveRange } from "../../components/datetime/DateRangePicker";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { ProductListItem } from "../../components/products/ProductListItem";
import { TeamItem } from "../../components/entity/TeamItem";
import { useIsMobile } from "../../layouts/shell";
import { cameFrom } from "../../lib/cameFrom";
import { formatUnixDateShort, formatUnixDateTimeShort } from "../../lib/datetime";
import { dateRangeCodec, textCodec, useUrlState } from "../../lib/urlState";
import { useScrollSpy } from "../../lib/useScrollSpy";
import { useStickyTitle } from "../../lib/useStickyTitle";
import { BatchTitleRow } from "./components/BatchTitleRow";
import {
  BATCH_MAIN_SECTIONS,
  BATCH_SECTION_KEYS,
  type BatchSectionKey,
  batchSection,
  batchSectionDomId,
} from "./sections";

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
// ONE PAGE OF SECTIONS, AS EVERY OTHER DETAIL PAGE (owner: *"inisiasi bacth detail"*, a-batch-page-is-one-page-of-
// sections) — the rack page's shape, which REPLACES the two tabs. The batch's record moves out of the heading into Info:
//
//   ┌ Ditaruh ┐   ←  Batch #5031  [Restok] [Kedaluwarsa 27 Nov]                          [✎ Koreksi]
//   │ Info    │      [img] Beras Pandan Wangi 5kg · SKU-BERAS-5K      [TM] Toko Melati
//   └ Riwayat ┘      [ⓘ Apa itu batch?]
//                 [Tiba 10] [Rusak 2] [Hilang 1] [Terpakai 0] [Siap 7]
//                 ┌ Ditaruh Saat Diterima ── Tempat · Ditaruh · Opname ┐   ┌ Info Batch ── Dari · Diterima oleh ┐
//                 ┌ Riwayat ── (Tiba · semua tanggal) ─────────────────┐   │ Harga satuan · Kedaluwarsa         │
//
// The nav on the left (Section, SectionNav, useScrollSpy); the heading sticks once it scrolls away; on a phone the
// section chips stick at the top and Koreksi is its icon. Info is the batch's short record, so where there is room it
// stands beside the rest, as a rack's Info does.
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

  // KOREKSI HARGA (the-correct-price-prototype-is-accepted). This is the warehouse's page: the warehouse holding the batch
  // never corrects its price, it READS each correction in Riwayat (the-owning-team-revalues-with-a-reason), so the button
  // shows here only to Root and the Administrator — canCorrectPrice passes no warehouse role.
  const [correcting, setCorrecting] = useState(false);

  // Placements pages on its own (#218) — its own read, independent of the detail aggregate. The rack
  // search filters the loaded page client-side (a batch sits on a handful of shelves); changing it
  // resets to page 1.
  //
  // THE TWO LISTS' FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — the rack search here, the
  // history's range below.
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

  // The history pages on its own (#218), independent of the detail aggregate above, and filters
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

  // ── The layout's own state, before the early returns: hooks may not be conditional. ─────────────────────────────────
  // Info beside the rest where there is room beside the nav — Chakra's `xl`, as a rack's Info.
  const wide = useBreakpointValue({ base: false, xl: true }, { ssr: false }) ?? false;
  const stick = useStickyTitle(batch !== null, isMobile);
  const { active, scrollTo } = useScrollSpy(
    batch !== null,
    stick.bar,
    BATCH_SECTION_KEYS,
    batchSectionDomId,
    wide ? BATCH_MAIN_SECTIONS : undefined,
  );
  const navSections = useMemo(
    () => BATCH_SECTION_KEYS.map((key) => ({ key, label: t(batchSection(key).titleKey), icon: batchSection(key).icon })),
    [t],
  );

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

  const back = () => navigate(backTo);

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
        <BatchTitleRow stuck={false} title={t("batchDetail.title")} backLabel={t("batchDetail.back")} onBack={back} />
        <Text color={query.isError ? "error.fg" : "fg.muted"} data-testid={query.isError ? "batch-detail-error" : "batch-detail-missing"}>
          {query.isError ? rpcError(query.error) : t("batchDetail.notFound")}
        </Text>
      </Stack>
    );
  }

  const cost = (v: number) => (batch.costKnown ? formatRupiah(v) : t("batchDetail.costUnknown"));
  // A lifecycle figure's value is the server's, from its OWN rows (BatchDetail) — never its count × today's unit cost:
  // units that already left keep the price they left at, a correction reprices only the units left
  // (a-late-cost-is-an-expense-not-a-revaluation). Unknown when the cost isn't known.
  const correctable = canCorrectPrice(current) && batch.costKnown && product !== null;
  const figureValue = { broken: data?.brokenValue ?? 0, lost: data?.lostValue ?? 0, used: data?.usedValue ?? 0 };
  // The newest correction's price before it — undefined when the price was never corrected.
  const correctedFrom = data?.priceCorrected ? data.priceCorrectedFrom : undefined;
  const isReturn = batch.origin === BatchOrigin.RETURN;
  const productName = product?.name ?? batch.name;

  // Koreksi carries its icon — on a phone, and in the sticky bar, its icon alone (a-phone-header-action-is-an-icon). It
  // acts on THIS batch via the shared stock dialog (#218). Not while the admin team monitors the warehouse
  // (the-admin-team-monitors-read-only). The bar's copy suffixes its test id `-sticky`, so a test finds the page's once.
  const actions = (compact: boolean, suffix = "") =>
    !canWrite(current) ? null : compact ? (
      <CompactActions
        menuLabel={t("batchDetail.actions")}
        actions={[
          {
            id: "adjust",
            label: t("batchDetail.adjust"),
            icon: Pencil,
            disabled: !product,
            testId: `batch-detail-adjust${suffix}`,
            onClick: () => setAdjusting(true),
          },
          // Koreksi Harga — Root and the Administrator only, here.
          ...(correctable
            ? [
                {
                  id: "correct-price",
                  label: t("correctPrice.action"),
                  icon: Tag,
                  testId: `batch-detail-correct-price${suffix}`,
                  onClick: () => setCorrecting(true),
                },
              ]
            : []),
        ]}
      />
    ) : (
      <>
        <Button variant="outline" flexShrink={0} data-testid="batch-detail-adjust" disabled={!product} onClick={() => setAdjusting(true)}>
          <Icon as={Pencil} boxSize="4" />
          {t("batchDetail.adjust")}
        </Button>
        {correctable && (
          <Button variant="outline" flexShrink={0} data-testid="batch-detail-correct-price" onClick={() => setCorrecting(true)}>
            <Icon as={Tag} boxSize="4" />
            {t("correctPrice.action")}
          </Button>
        )}
      </>
    );

  // Beside the number: where it came from — restock vs return (#218), UNSPECIFIED reads as a restock; categorical, so a
  // hue — and that it expires soon.
  const badges = (
    <>
      <Badge colorPalette={isReturn ? "orange" : "gray"} data-testid="batch-detail-origin">
        {t(isReturn ? "batchDetail.originReturn" : "batchDetail.originRestock")}
      </Badge>
      {batch.expiresOnUnix > 0n && isExpiringSoon(batch.expiresOnUnix) && (
        <Badge colorPalette="warning" data-testid="batch-detail-expiring">
          {t("batchDetail.expiring", { date: formatUnixDateShort(batch.expiresOnUnix) })}
        </Badge>
      )}
    </>
  );

  // ── THE TITLE ROW — ONE builder, drawn twice: the page's, and the bar that sticks once the heading has scrolled behind
  // it (the-title-row-is-the-sticky-bar). The bar names the product under the number. ─────────────────────────────────
  const titleRow = (stuck: boolean) => (
    <BatchTitleRow
      stuck={stuck}
      title={t("batchDetail.batchNo", { id: batch.id.toString() })}
      badges={stuck ? undefined : badges}
      productName={stuck ? productName : undefined}
      backLabel={t("batchDetail.back")}
      onBack={back}
      actions={stuck ? <Box data-testid="batch-detail-sticky-actions">{actions(true, "-sticky")}</Box> : actions(isMobile)}
    />
  );

  // THE HEADING — the title row, then what it is a batch OF and whose, then what a batch is. Watched whole by the sticky
  // bar: it shows once the product line has gone too, so the product is never on screen twice.
  const heading = (
    <Stack gap="2" ref={stick.title}>
      {titleRow(false)}
      <Stack gap="1" ps={isMobile ? "0" : "10"}>
        <Flex align="center" gap="card" wrap="wrap">
          <Box data-testid="batch-detail-product-name">
            {/* The product code copies (sku-is-copyable). */}
            <ProductListItem
              productCodeCopyable
              product={
                product ? { ...product, teamId: undefined } : { id: batch.productId, name: batch.name, productCode: batch.productCode }
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
        <Box ms="-1">
          <BatchExplainer />
        </Box>
      </Stack>
    </Stack>
  );

  // THE LIFECYCLE, the card strip (a-list-summary-is-the-order-lists-card-strip) — Tiba = Rusak + Hilang + Terpakai
  // + Siap (#218); each figure's value under it, at the batch's frozen cost. What is left leads. Under the heading, over
  // the sections: the whole batch's.
  const figures = (
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
        line={cost(figureValue.broken)}
        testId="batch-detail-broken-card"
      />
      <SummaryCard
        label={t("batchDetail.lost")}
        value={
          <Span color={batch.lost > 0n ? "error.fg" : undefined} data-testid="batch-detail-lost">
            {batch.lost.toString()}
          </Span>
        }
        line={cost(figureValue.lost)}
        testId="batch-detail-lost-card"
      />
      <SummaryCard
        label={t("batchDetail.used")}
        value={<Span data-testid="batch-detail-used">{batch.used.toString()}</Span>}
        line={cost(figureValue.used)}
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
  );

  /** A section card, keyed by its entry in `sections.ts` — its id, icon and title come from there. */
  const section = (key: BatchSectionKey, children: ReactNode, testId: string) => {
    const entry = batchSection(key);

    return (
      <Section id={batchSectionDomId(key)} icon={entry.icon} title={t(entry.titleKey)} testId={testId}>
        {children}
      </Section>
    );
  };

  // DITARUH SAAT DITERIMA — the shelves the accept put this batch on (a-batch-shows-the-racks-it-was-put-on).
  const placements = section(
    "placements",
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
        // AN EMPTY LIST SAYS WHY (an-empty-list-shows-a-hint) — never put on a rack, or no rack matches the search.
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
    </Stack>,
    "batch-placements-panel",
  );

  // INFO — the batch's own record: where it came from, as a way there (a-batch-opens-where-it-came-from), who took it in,
  // what one unit cost, and when it expires.
  const info = section(
    "info",
    <Stack gap="card">
      <Fact label={t("batchDetail.source")}>
        <BatchSource batch={batch} testId={isReturn ? "batch-detail-return" : "batch-detail-order"} />
      </Fact>
      {/* Who accepted the delivery — resolved best-effort (#142); a dash when it could not be. */}
      <Fact label={t("batchDetail.acceptedBy")}>
        {data?.acceptedByName ? (
          <Text as="span" data-testid="batch-detail-received-by">
            {data.acceptedByName}
          </Text>
        ) : undefined}
      </Fact>
      {/* The frozen cost every figure above is priced at — the same number as a rack's *Harga satuan*. */}
      <Fact label={t("batchDetail.unitCost")}>
        <Text as="span" data-testid="batch-detail-unit-cost">
          {cost(batch.unitCost)}
        </Text>
        {/* A corrected price says what it was — the newest correction's price before it. */}
        {correctedFrom !== undefined && (
          <Text fontSize="xs" color="fg.muted" data-testid="batch-detail-unit-cost-corrected">
            {t("correctPrice.info.correctedFrom", { from: formatRupiah(correctedFrom) })}
          </Text>
        )}
      </Fact>
      {/* The day and how long is left, as the list says it (an-expiry-says-how-long-is-left); a dash when it has none. */}
      <Fact label={t("batchDetail.expiry")}>
        <ExpiryCell inline fontSize="md" unix={batch.expiresOnUnix} testId="batch-detail-expiry" />
      </Fact>
    </Stack>,
    "batch-info-panel",
  );

  // RIWAYAT — this batch's ledger. A batch-less recount (batch_id 0) does not appear here.
  const history = section(
    "history",
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
    </Stack>,
    "batch-history-panel",
  );

  return (
    // The page arrives — a fade and a short rise (motion-is-small-quick-and-shared).
    <Stack
      gap="section"
      animationStyle="enter"
      data-testid="batch-detail-page"
      style={{ ["--detail-header-h" as string]: `${stick.height}px` }}
    >
      {/* What is not wired yet — only a return's batch shows it (features/inventory/pending.ts). */}
      {isReturn && <NotImplementedSummary list={BATCH_PENDING} />}

      {/* THE STICKY STRIP — the section chips on a phone (always), and the title bar under them, drawn over the page once
          the heading has gone behind it. */}
      <ProductStickyStrip
        prefix="batch-detail"
        stripRef={stick.strip}
        barRef={stick.bar}
        shown={stick.past}
        isMobile={isMobile}
        chips={<SectionNav compact sections={navSections} ariaLabel={t("batchDetail.navLabel")} active={active} onSelect={scrollTo} />}
      >
        {titleRow(true)}
      </ProductStickyStrip>

      {/* THE NAVIGATION, THEN THE SECTIONS. ⚠ `minmax(0, 1fr)` so a wide table scrolls in its own box. */}
      <Grid templateColumns={isMobile ? "minmax(0, 1fr)" : "13rem minmax(0, 1fr)"} gap="section" alignItems="start">
        {!isMobile && (
          <Box position="sticky" top="calc(var(--detail-header-h, 0px) + 1rem)">
            <SectionNav sections={navSections} ariaLabel={t("batchDetail.navLabel")} active={active} onSelect={scrollTo} />
          </Box>
        )}

        {/* THE PUT-AWAY AND THE LEDGER IN THE MAIN COLUMN, INFO BESIDE IT where there is room — in the nav's order in one column
            otherwise. A JS branch, so no card exists twice. */}
        {wide ? (
          <Stack gap="section" minW="0" w="full">
            {heading}
            {figures}
            <Grid templateColumns="minmax(0, 1fr) 20rem" gap="section" alignItems="start" minW="0">
              <Stack gap="section" minW="0">
                {placements}
                {history}
              </Stack>
              <Stack gap="section" minW="0">
                {info}
              </Stack>
            </Grid>
          </Stack>
        ) : (
          <Stack gap="section" minW="0" w="full">
            {heading}
            {figures}
            {placements}
            {info}
            {history}
          </Stack>
        )}
      </Grid>

      {warehouseId !== undefined && product && (
        <AdjustStockDialog
          warehouseId={warehouseId}
          product={product}
          currentOnHand={batch.ready}
          open={adjusting}
          onOpenChange={setAdjusting}
        />
      )}

      {/* Koreksi Harga — scoped to the OWNING team (the batch's), never this warehouse. */}
      {correctable && warehouseId !== undefined && product?.teamId !== undefined && (
        <CorrectPriceDialog
          open={correcting}
          onOpenChange={setCorrecting}
          batch={{
            id: batch.id,
            teamId: product.teamId,
            warehouseId,
            warehouseName: current.teamName,
            productName,
            units: batch.ready,
            price: batch.unitCost,
            value: batch.readyValue,
          }}
        />
      )}
    </Stack>
  );
}
