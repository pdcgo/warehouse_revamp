import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Grid,
  Heading,
  Icon,
  Span,
  Stack,
  StackSeparator,
  Table,
  Text,
  useBreakpointValue,
} from "@chakra-ui/react";
import { History, Pencil, Tag, Warehouse } from "lucide-react";

import { rpcError } from "../../api/clients";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { BatchOrigin, MovementKind } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { isExpiringSoon } from "../../lib/expiry";
import { formatRupiah } from "../../lib/money";
import { canWrite, useTeam } from "../../features/team/TeamContext";
import { MovementTable } from "../../features/inventory/MovementTable";
import { BatchSource } from "../../features/inventory/BatchSource";
import { ExpiryCell } from "../../features/inventory/ExpiryCell";
import { useBatchDetail, useBatchHistory, useBatchPlacements } from "../../features/inventory/queries";
import { useRackCodes, useRacks } from "../../features/racks/queries";
import { AdjustStockDialog } from "../../features/inventory/AdjustStockDialog";
import { CorrectPriceDialog } from "../../features/inventory/CorrectPriceDialog";
import { canCorrectPrice } from "../../features/inventory/priceChange";
import { ProductStickyStrip } from "../../features/products/ProductTitleRow";
import { SummaryCard, SummaryStrip } from "../../features/orders/SummaryCard";
import { CompactActions } from "../../components/chrome/CompactActions";
import { Section } from "../../components/chrome/DetailSection";
import { FilterSearch } from "../../components/chrome/FilterBar";
import { ENDS_BARE, GrowingPager, pagerStepsAside } from "../../components/chrome/GrowingPager";
import { SectionNav } from "../../components/chrome/SectionNav";
import { ALL_DATES, DateRangePicker, resolveRange } from "../../components/datetime/DateRangePicker";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { ProductListItem } from "../../components/products/ProductListItem";
import { TeamItem } from "../../components/entity/TeamItem";
import { useIsMobile } from "../../layouts/shell";
import { cameFrom } from "../../lib/cameFrom";
import { enterStep } from "../../lib/motion";
import { formatUnixDateShort, formatUnixDateTimeShort } from "../../lib/datetime";
import { dateRangeCodec, enumCodec, textCodec, useUrlState } from "../../lib/urlState";
import { LEDGER_KINDS, MovementKindSelect } from "../../features/inventory/MovementKindSelect";
import { useScrollSpy } from "../../lib/useScrollSpy";
import { useStickyTitle } from "../../lib/useStickyTitle";
import { BatchTitleRow } from "./components/BatchTitleRow";
import { ImagePreview, type PreviewTarget } from "../../components/feedback/ImagePreview";
import { InfoFact } from "./components/InfoFact";
import { LastCountBadge } from "./components/LastCountBadge";
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
//                 ┌ Penempatan ── Tempat · Ditaruh · Opname ┐              ┌ Info Batch ── Dari · Diterima oleh ┐
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
  // THE PICTURE OPENED BIG — the product's cover or the owner's avatar, whichever was clicked
  // (a-small-picture-opens-its-preview). One piece of state, one dialog.
  const [preview, setPreview] = useState<PreviewTarget | null>(null);

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

  // THE BATCH'S RACKS, WHOLE, FOR SESUAIKAN STOK — its rack picker offers only these (owner: *"racknya jangan tampil
  // semua, sesuai dengan rack batchnya"*, the-adjust-dialog-leads-with-what-it-adjusts). Penempatan above is paged, so the
  // dialog reads the list in one page of its own (a batch sits on a handful) — only while it is open, never on load.
  const batchRacksQuery = useBatchPlacements({ warehouseId, batchId, page: 1, pageSize: 200, enabled: adjusting });
  const batchRackIds = useMemo(
    () => [...new Set((batchRacksQuery.data?.shelves ?? []).map((s) => s.rackId))],
    [batchRacksQuery.data],
  );

  // The history pages on its own (#218), independent of the detail aggregate above, and filters
  // by a date range on the movement timestamp — server-side, so it narrows the whole ledger, not just
  // the loaded page. Changing either bound resets to page 1.
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(20);
  const [historyRange, setHistoryRange] = useUrlState("range", ALL_DATES, dateRangeCodec);
  const { fromUnix: historyFromUnix, toUnix: historyToUnix } = resolveRange(historyRange);
  // …and by ONE kind of movement, server-side as the range is (owner: *"pakai kindnya"*, riwayat-filters-by-one-kind).
  const [historyKind, setHistoryKind] = useUrlState(
    "kind",
    MovementKind.UNSPECIFIED,
    enumCodec([MovementKind.UNSPECIFIED, ...LEDGER_KINDS]),
  );
  const historyQuery = useBatchHistory({
    warehouseId,
    productId: batch?.productId ?? 0n,
    batchId,
    page: historyPage,
    pageSize: historyPageSize,
    fromUnix: historyFromUnix,
    toUnix: historyToUnix,
    kind: historyKind,
  });
  const historyMovements = historyQuery.data?.movements ?? [];

  // EVERY RACK BY ITS CODE — the warehouse's shelf list, as every screen naming a stored placement reads it
  // (useRackCodes). Riwayat names the rack each movement touched and Ditaruh the racks the accept put it on, and the
  // product may have LEFT those racks since: ProductPlaces (the aggregate's codes) lists only where it sits now.
  const warehouseRackCodes = useRackCodes({ warehouseId: warehouseId ?? 0n, enabled: warehouseId !== undefined });
  // …and their NAMES, for Penempatan's rows (owner: *"data rak tidak ada namanya?"*, a-placement-names-its-rack) — the
  // same RackList read, one cache entry, so no second request.
  const warehouseRacks = useRacks({ warehouseId: warehouseId ?? 0n, enabled: warehouseId !== undefined });
  const rackNames = useMemo(
    () => new Map((warehouseRacks.data ?? []).map((rack) => [rack.id.toString(), rack.name])),
    [warehouseRacks.data],
  );
  const historyTotal = Number(historyQuery.data?.pageInfo?.totalItems ?? 0n);

  // WHICH PAGER HAS NOTHING TO DO — page 1 holding the whole list at the smallest size — so it steps aside and its table
  // ends bare (the-batch-page-hides-a-pager-that-fits). The pager asks the same of itself; one rule, asked twice.
  const placementsPagerAside = pagerStepsAside({
    page: placementPage,
    total: placementsTotal,
    pageSize: placementPageSize,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
  });
  const historyPagerAside = pagerStepsAside({
    page: historyPage,
    total: historyTotal,
    pageSize: historyPageSize,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
  });

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

  // The place a shelf sits: its painted code, the named unplaced pile (#135) — a row that touched no rack — or a bare id
  // if the code could not be resolved.
  const placeLabel = (rackId: bigint): string => {
    if (rackId === 0n) return t("racks.select.unplaced");
    const key = rackId.toString();
    return warehouseRackCodes.data?.[key] ?? data?.rackCodes.get(key) ?? `#${key}`;
  };

  // A rack's name, under its code — empty for the unplaced pile and a rack that has none.
  const placeName = (rackId: bigint): string => (rackId === 0n ? "" : (rackNames.get(rackId.toString()) ?? ""));

  // Placements filtered by the rack search — matched on the code the operator reads off the shelf AND the rack's name,
  // never the internal id.
  const rackQuery = rackSearch.trim().toLowerCase();
  const filteredShelves = shelves.filter(
    (s) =>
      rackQuery === "" ||
      placeLabel(s.rackId).toLowerCase().includes(rackQuery) ||
      placeName(s.rackId).toLowerCase().includes(rackQuery),
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
  // The cover at its full size for the preview — the thumbnail only when there is no full one.
  const productImage = product?.defaultImageUrl || product?.defaultImageThumbnailUrl || "";

  // Sesuaikan (was *Koreksi* — owner: *"koreksi jadi sesuaikan"*, the-batch-page-adjusts-its-own-batch: the word the
  // product page's button and the dialog's own title use) carries its icon — on a phone, and in the sticky bar, its icon
  // alone (a-phone-header-action-is-an-icon). It acts on THIS batch via the shared stock dialog (#218). Not while the admin team monitors the warehouse
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

  // THE HEADING — the title row, then what it is a batch OF and whose. Watched whole by the sticky bar: it shows once the
  // product card has gone too, so the product is never on screen twice.
  //
  // NO *APA ITU BATCH?* HERE (owner: *"apa itu batch tidak usah ada di detail"*, what-a-batch-is-said-on-the-list-only) —
  // somebody on a batch's page already opened a batch; the answer stays on the batch list, where the word is met first.
  //
  // THE PRODUCT IS ONE FULL-WIDTH CARD (owner: *"buat 1 kartu panjang penuh, ada info yang sudah tampil … terlalu banyak
  // whitespace"*, the-batch-product-is-one-full-card) — the same facts, its picture, name, code and owner, held in a card
  // the width of the figures under it. They were a loose line under the title, indented and floating, the rest of the
  // row empty.
  //
  //   ←  Batch #5031  [Restok] [Kedaluwarsa 17 Des]                                [✎ Koreksi]
  //   ┌────────────────────────────────────────────────────────────────────────────────────┐
  //   │ [img]  Beras Pandan Wangi 5kg                                Pemilik               │
  //   │        SKU-BERAS-5K ⧉                                        [TM] Toko Melati      │
  //   └────────────────────────────────────────────────────────────────────────────────────┘
  //   [Tiba 10] [Rusak 2] [Hilang 1] [Terpakai 0] [Siap 7]
  const heading = (
    <Stack gap="2" ref={stick.title}>
      {titleRow(false)}
      <Card.Root data-testid="batch-detail-product-card">
        <Card.Body>
          {/* TWO HALVES THAT WEIGH THE SAME (owner: *"secara besar tidak balance, pemilik terlihat kecil"*,
              the-owner-weighs-the-same-as-its-product) — the product and its owner at one size, a thin line between them;
              on a phone the owner under the product. */}
          <Flex direction={isMobile ? "column" : "row"} align={isMobile ? "stretch" : "center"} gap="card">
            <Box data-testid="batch-detail-product-name" flex="1" minW="0">
              {/* The product code copies (sku-is-copyable). Large where there is room — it is the subject of the card. */}
              <ProductListItem
                productCodeCopyable
                size={isMobile ? "md" : "lg"}
                product={
                  product ? { ...product, teamId: undefined } : { id: batch.productId, name: batch.name, productCode: batch.productCode }
                }
                // Its cover opens big — only when it has one (a-small-picture-opens-its-preview).
                onImageClick={
                  productImage
                    ? () => setPreview({ src: productImage, title: productName, caption: product?.productCode ?? batch.productCode })
                    : undefined
                }
              />
            </Box>
            {/* The owning team — whose goods these are (#142): always a selling team, so no type badge
                (a-team-of-a-known-type-shows-no-badge) — at the product's own size, *Pemilik* where the product has its
                code. */}
            {data?.owner && (
              <Box
                data-testid="batch-detail-owner"
                minW="0"
                flexShrink={0}
                {...(isMobile
                  ? { borderTopWidth: "1px", pt: "card" }
                  : { borderStartWidth: "1px", ps: "section", minW: "16rem" })}
              >
                <TeamItem
                  size={isMobile ? "md" : "lg"}
                  caption={t("batchDetail.owner")}
                  team={{
                    teamId: data.owner.id,
                    teamName: data.owner.name,
                    teamType: data.owner.type,
                    imageUrl: data.owner.imageUrl,
                  }}
                  // Its picture opens big, as the product's does; initials have nothing to open.
                  onImageClick={() =>
                    data.owner?.imageUrl && setPreview({ src: data.owner.imageUrl, title: data.owner.name })
                  }
                />
              </Box>
            )}
          </Flex>
        </Card.Body>
      </Card.Root>
    </Stack>
  );

  // THE LIFECYCLE, the card strip (a-list-summary-is-the-order-lists-card-strip) — Tiba = Rusak + Hilang + Terpakai
  // + Siap (#218); each figure's value under it, at the batch's frozen cost. Under the heading, over the sections: the
  // whole batch's.
  //
  // SIAP LEADS, AND EVERY FIGURE SAYS WHAT IT COUNTS (owner: *"pindahkan, sama per stat itu kasih keterangan agar mudah
  // dikenali, tidak judul saja"*, ready-leads-and-each-figure-says-what-it-counts) — what is left of the batch is what
  // somebody on this page came for, and the lit card leads as on every strip; on a phone it was alone on the third row.
  // Each card's note says what its units are, in the owner's words (*"Siap, stok di rak, bisa untuk transaksi …"*), on up
  // to two lines — one line at a fifth of the row cut the longer two (a phone drops the note, a-phone-card-shows-no-note):
  //
  //   [Siap 7]                     [Tiba 10]                   [Rusak 2]                [Hilang 1]           [Terpakai 0]
  //    Stok di rak, bisa untuk      Stok yang diterima di       Stok yang mengalami      Stok yang tidak      Stok yang telah
  //    transaksi                    batch ini                   kerusakan                sampai atau hilang   ditransaksikan
  //
  // WHAT IT IS WORTH, UNDER THE COUNT — AND TIBA'S DATE IN INFO (owner, after trying it beside the count, bold and
  // labelled, then lighter: *"di bawahnya aja, seperti sebelumnya, bedanya diterimanya tetap di info"*,
  // tiba-keeps-its-date-in-info) — the price is the small line under each count it always was; only Tiba's date, once
  // wedged after its Rp, has left the card for Info's *Tiba pada*.
  //
  //   Siap
  //   7
  //   Rp 463.169
  const valueOf = (amount: ReactNode, key: string) => <Span data-testid={`batch-detail-${key}-amount`}>{amount}</Span>;
  const figures = (
    <SummaryStrip testId="batch-detail-lifecycle">
      <SummaryCard
        emphasis
        label={t("batchDetail.ready")}
        value={<Span data-testid="batch-detail-ready">{batch.ready.toString()}</Span>}
        line={valueOf(cost(batch.readyValue), "ready")}
        note={t("batchDetail.readyNote")}
        noteLines={2}
        testId="batch-detail-ready-card"
      />
      <SummaryCard
        label={t("batchDetail.arrived")}
        note={t("batchDetail.arrivedNote")}
        noteLines={2}
        value={<Span data-testid="batch-detail-arrived">{batch.arrived.toString()}</Span>}
        line={valueOf(cost(batch.lineCost), "arrived")}
        testId="batch-detail-arrived-card"
      />
      <SummaryCard
        label={t("batchDetail.broken")}
        value={
          <Span color={batch.broken > 0n ? "error.fg" : undefined} data-testid="batch-detail-broken">
            {batch.broken.toString()}
          </Span>
        }
        line={valueOf(cost(figureValue.broken), "broken")}
        note={t("batchDetail.brokenNote")}
        noteLines={2}
        testId="batch-detail-broken-card"
      />
      <SummaryCard
        label={t("batchDetail.lost")}
        value={
          <Span color={batch.lost > 0n ? "error.fg" : undefined} data-testid="batch-detail-lost">
            {batch.lost.toString()}
          </Span>
        }
        line={valueOf(cost(figureValue.lost), "lost")}
        note={t("batchDetail.lostNote")}
        noteLines={2}
        testId="batch-detail-lost-card"
      />
      <SummaryCard
        label={t("batchDetail.used")}
        value={<Span data-testid="batch-detail-used">{batch.used.toString()}</Span>}
        line={valueOf(cost(figureValue.used), "used")}
        note={t("batchDetail.usedNote")}
        noteLines={2}
        testId="batch-detail-used-card"
      />
    </SummaryStrip>
  );

  /** A section card, keyed by its entry in `sections.ts` — its id, icon and title come from there. */
  const section = (key: BatchSectionKey, children: ReactNode, testId: string, description?: ReactNode) => {
    const entry = batchSection(key);

    return (
      <Section id={batchSectionDomId(key)} icon={entry.icon} title={t(entry.titleKey)} description={description} testId={testId}>
        {children}
      </Section>
    );
  };

  // PENEMPATAN — the shelves the accept put this batch on (a-batch-shows-the-racks-it-was-put-on). Its title is the one
  // word, and what it means is the line under it (owner: *"Ditaruh Saat Diterima, jadi Penempatan — kata ditaruh saat
  // diterima bisa diperpanjang jadi sub judul"*, placement-is-one-word-its-meaning-a-line): the racks it was PUT ON, which
  // is history — where the product sits now is the product's page.
  const placements = section(
    "placements",
    <Stack gap="card">
      {/* Rack search — client-side over the loaded page (a batch sits on a handful of shelves); its × clears it. The
          section's full width (owner: *"filter rak full"*). */}
      <FilterSearch
        value={rackSearch}
        onChange={(value) => {
          setRackSearch(value);
          setPlacementPage(1);
        }}
        placeholder={t("batchDetail.searchRack")}
        testId="batch-detail-rack-search"
        full
      />

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
          {/* With no pager under it, no line under its last row (the-batch-page-hides-a-pager-that-fits). */}
          <Table.Root
            size="sm"
            css={placementsPagerAside ? ENDS_BARE : undefined}
            data-testid="batch-detail-placements-table"
            data-ends-bare={placementsPagerAside || undefined}
          >
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
                  {/* The code painted on the shelf, its name under it — one rack, read twice. */}
                  <Table.Cell data-testid={`batch-detail-shelf-place-${s.rackId}`}>
                    <Stack gap="0">
                      <Span fontWeight="bold">{placeLabel(s.rackId)}</Span>
                      {placeName(s.rackId) && (
                        <Span fontSize="xs" color="fg.muted" data-testid={`batch-detail-shelf-name-${s.rackId}`}>
                          {placeName(s.rackId)}
                        </Span>
                      )}
                    </Stack>
                  </Table.Cell>
                  <Table.Cell textAlign="end">{s.qty.toString()}</Table.Cell>
                  <Table.Cell>
                    <LastCountBadge unix={s.lastOpnameUnix} testId={`batch-detail-shelf-opname-${s.rackId}`} />
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Box>
      )}

      {/* Out of the way while it has nothing to do — page 1 holding every rack at the smallest size, 10 (owner:
          *"sembunyikan kalau pagenya page 1 dan itemnya tidak lebih dari samadengan yang terkecil di perpage"*,
          the-batch-page-hides-a-pager-that-fits). */}
      <GrowingPager
        page={placementPage}
        onPageChange={setPlacementPage}
        hasNext={placementPage * placementPageSize < placementsTotal}
        resetKey={[rackQuery, placementPageSize].join("|")}
        pageSize={placementPageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        total={placementsTotal}
        testId="batch-detail-placements-pager"
        onPageSizeChange={(size) => {
          setPlacementPageSize(size);
          setPlacementPage(1);
        }}
      />
    </Stack>,
    "batch-placements-panel",
    t("batchDetail.placementsLine"),
  );

  // INFO — the batch's own record: where it came from, as a way there (a-batch-opens-where-it-came-from), who took it in,
  // what one unit cost, and when it expires. Each a quiet label over its value in bold, a thin line between them — the
  // owner's drawing (the-batch-info-reads-label-over-value, InfoFact).
  const info = section(
    "info",
    <Stack gap="4" separator={<StackSeparator />}>
      <InfoFact label={t("batchDetail.source")}>
        <BatchSource batch={batch} testId={isReturn ? "batch-detail-return" : "batch-detail-order"} />
      </InfoFact>
      {/* Who accepted the delivery — resolved best-effort (#142); a dash when it could not be. */}
      <InfoFact label={t("batchDetail.acceptedBy")}>
        {data?.acceptedByName ? (
          <Text as="span" data-testid="batch-detail-received-by">
            {data.acceptedByName}
          </Text>
        ) : undefined}
      </InfoFact>
      {/* When it arrived — the batch is minted AT acceptance, so its created_at IS the arrival. It was wedged after Tiba's
          Rp on the card (tiba-keeps-its-date-in-info). */}
      <InfoFact label={t("batchDetail.arrivedAt")}>
        <Text as="span" data-testid="batch-detail-arrived-date">
          {formatUnixDateTimeShort(batch.createdAtUnix)}
        </Text>
      </InfoFact>
      {/* The frozen cost every figure above is priced at — the same number as a rack's *Harga satuan*. */}
      <InfoFact label={t("batchDetail.unitCost")}>
        <Text as="span" data-testid="batch-detail-unit-cost">
          {cost(batch.unitCost)}
        </Text>
        {/* A corrected price says what it was — the newest correction's price before it; a note, so not bold. */}
        {correctedFrom !== undefined && (
          <Text fontSize="xs" fontWeight="normal" color="fg.muted" data-testid="batch-detail-unit-cost-corrected">
            {t("correctPrice.info.correctedFrom", { from: formatRupiah(correctedFrom) })}
          </Text>
        )}
      </InfoFact>
      {/* The day and how long is left, as the list says it (an-expiry-says-how-long-is-left); a dash when it has none. */}
      <InfoFact label={t("batchDetail.expiry")}>
        {/* At the size of the facts above it, how long is left a badge (owner: *"kadaluarsa ukurannya sama dengan
            atasnya, hari tersisa buat jadi badge"*, the-expiry-left-is-a-badge). */}
        <ExpiryCell inline leftAsBadge fontSize="inherit" unix={batch.expiresOnUnix} testId="batch-detail-expiry" />
      </InfoFact>
    </Stack>,
    "batch-info-panel",
  );

  // RIWAYAT — this batch's ledger. A batch-less recount (batch_id 0) does not appear here.
  const history = section(
    "history",
    <Stack gap="card">
      {/* Date range over the movement timestamp (#218/#224) and the kind (riwayat-filters-by-one-kind) — both server-side,
          so they narrow the whole ledger. Together the section's full width, as Penempatan's search (owner: *"filter
          tanggal full width"*): the date four parts of the row, Kegiatan three beside it — narrower than the date (owner:
          *"buat lebih kecil juga daripada tanggal"*), but not the 14rem slot that was *"terlalu kecil"*; one under the
          other on a phone — two full-width rows, not the ragged strip a sheet exists for. Each has its × back to
          everything (owner: *"ada closeable … tanggal ada closeable juga"*). */}
      <Grid
        templateColumns={isMobile ? "minmax(0, 1fr)" : "minmax(0, 4fr) minmax(0, 3fr)"}
        gap={isMobile ? "2" : "card"}
        data-testid="batch-detail-history-filters"
      >
        <DateRangePicker
          value={historyRange}
          onChange={(r) => {
            setHistoryRange(r);
            setHistoryPage(1);
          }}
          testId="batch-detail-date"
          full
          clearable
        />
        <MovementKindSelect
          value={historyKind}
          onChange={(kind) => {
            setHistoryKind(kind);
            setHistoryPage(1);
          }}
          testId="batch-detail-kind"
        />
      </Grid>
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
          // The rack's name under its code, as Penempatan's (owner: *"tempatnya pakai nama"*); the kind a badge in its
          // colour (owner: *"kegiatan pakai badge"*, a-movement-kind-is-a-badge).
          rackName={placeName}
          kindBadge
          // With no pager under it, no line under its last row (the-batch-page-hides-a-pager-that-fits).
          endsBare={historyPagerAside}
          afterLabel={t("batchDetail.after")}
          emptyText={t("batchDetail.noHistory")}
          emptyIcon={History}
          emptyDescription={t("batchDetail.noHistoryHint")}
        />
      )}
      {/* Out of the way while it has nothing to do, as Penempatan's — an empty or short history on page 1 draws none
          (the-batch-page-hides-a-pager-that-fits; it was always on screen, the-pager-is-always-on-screen). */}
      <GrowingPager
        page={historyPage}
        onPageChange={setHistoryPage}
        hasNext={historyPage * historyPageSize < historyTotal}
        resetKey={[dateRangeCodec.encode(historyRange), historyKind, historyPageSize].join("|")}
        pageSize={historyPageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        total={historyTotal}
        testId="batch-detail-history-pager"
        onPageSizeChange={(size) => {
          setHistoryPageSize(size);
          setHistoryPage(1);
        }}
      />
    </Stack>,
    "batch-history-panel",
    // What the ledger holds, as Penempatan says what it holds (owner: *"riwayat kasih subjudul"*).
    t("batchDetail.historyLine"),
  );

  // THE PAGE ARRIVES IN ORDER (owner: *"tambah animasi"*, the-batch-page-arrives-in-order) — each block its own `enter`,
  // one step after the block above it: the heading (and the nav beside it), the figures, then the sections down the
  // column. The root carries none — a rise inside a rise reads as 16px (motion-is-small-quick-and-shared).
  const arrives = (step: number, node: ReactNode, testId: string) => (
    <Box minW="0" {...enterStep(step)} data-testid={testId} data-enter-step={step}>
      {node}
    </Box>
  );

  return (
    <Stack gap="section" data-testid="batch-detail-page" style={{ ["--detail-header-h" as string]: `${stick.height}px` }}>
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
          <Box position="sticky" top="calc(var(--detail-header-h, 0px) + 1rem)" {...enterStep(0)}>
            <SectionNav sections={navSections} ariaLabel={t("batchDetail.navLabel")} active={active} onSelect={scrollTo} />
          </Box>
        )}

        {/* THE PUT-AWAY AND THE LEDGER IN THE MAIN COLUMN, INFO BESIDE IT where there is room — in the nav's order in one column
            otherwise. A JS branch, so no card exists twice. Each block a step in the page's arrival. */}
        {wide ? (
          <Stack gap="section" minW="0" w="full">
            {arrives(0, heading, "batch-detail-enter-heading")}
            {arrives(1, figures, "batch-detail-enter-figures")}
            <Grid templateColumns="minmax(0, 1fr) 20rem" gap="section" alignItems="start" minW="0">
              <Stack gap="section" minW="0">
                {arrives(2, placements, "batch-detail-enter-placements")}
                {arrives(3, history, "batch-detail-enter-history")}
              </Stack>
              <Stack gap="section" minW="0">
                {/* Beside Penempatan, so it arrives with it. */}
                {arrives(2, info, "batch-detail-enter-info")}
              </Stack>
            </Grid>
          </Stack>
        ) : (
          <Stack gap="section" minW="0" w="full">
            {arrives(0, heading, "batch-detail-enter-heading")}
            {arrives(1, figures, "batch-detail-enter-figures")}
            {arrives(2, placements, "batch-detail-enter-placements")}
            {arrives(3, history, "batch-detail-enter-history")}
            {/* The lowest of the three, so the last on a narrow screen (info-batch-comes-last). */}
            {arrives(4, info, "batch-detail-enter-info")}
          </Stack>
        )}
      </Grid>

      <ImagePreview target={preview} onClose={() => setPreview(null)} />

      {warehouseId !== undefined && product && (
        <AdjustStockDialog
          warehouseId={warehouseId}
          product={product}
          // The dialog's *Tersedia* is the PRODUCT's units here — the sum of where it sits now. It was given this batch's
          // Siap, a different number under the product's name; the batch's own is *Tersisa*, under it.
          currentOnHand={(data?.places ?? []).reduce((sum, p) => sum + p.onHand, 0n)}
          open={adjusting}
          onOpenChange={setAdjusting}
          // The page's own ProductPlaces answer — mounted closed, the dialog's read of its own was the same one again (#133).
          places={data?.places}
          // Rusak and Hilang take THIS batch — never asked again on its own page (owner: *"kenapa di sesuaikan stok harus
          // pilih batch lagi?"*, the-batch-page-adjusts-its-own-batch); the dialog says it at the top with its units
          // left, and offers only its racks — none until they have been read, never the whole warehouse meanwhile.
          fixedBatch={{
            id: batch.id,
            ready: batch.ready,
            source: isReturn
              ? t("batches.fromReturn")
              : batch.deliveryId > 0n
                ? t("batches.fromRestock", { id: batch.deliveryId.toString() })
                : "",
            rackIds: batchRackIds,
          }}
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
