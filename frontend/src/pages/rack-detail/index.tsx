import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Box, Button, Flex, Grid, HStack, Heading, Icon, Span, Stack, Table, Text, useBreakpointValue } from "@chakra-ui/react";
import { ArrowRightLeft, Gift, History, PackageOpen, PackageSearch } from "lucide-react";
import { personName } from "../../lib/users";
import { productClient, rackClient, rpcError } from "../../api/clients";
import type { StockMovement } from "../../gen/warehouse/inventory/v1/inventory_pb";
import type { Rack, RackStockLine, RackSummary } from "../../gen/warehouse/inventory/v1/rack_pb";
import type { Product } from "../../gen/warehouse/product/v1/product_pb";
import type { Team } from "../../gen/warehouse/team/v1/team_pb";
import { TeamItem } from "../../components/entity/TeamItem";
import { productByIdsRowData, productsFromByIds } from "../../features/products/adapt";
import { ProductStickyStrip } from "../../features/products/ProductTitleRow";
import { rackHistoryFromList, rackHistoryRowData } from "../../features/racks/adapt";
import { canWrite, useTeam } from "../../features/team/TeamContext";
import { CompactActions } from "../../components/chrome/CompactActions";
import { Fact, Section } from "../../components/chrome/DetailSection";
import { FilterChips } from "../../components/chrome/FilterChips";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { SectionNav } from "../../components/chrome/SectionNav";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { ProductListItem } from "../../components/products/ProductListItem";
import { SummaryCard, SummaryStrip } from "../../features/orders/SummaryCard";
import { cameFrom } from "../../lib/cameFrom";
import { formatUnixDate } from "../../lib/datetime";
import { PLACEMENT_KINDS } from "../../features/inventory/movementKind";
import { MovementTable } from "../../features/inventory/MovementTable";
import { formatRupiah } from "../../lib/money";
import { useIsMobile } from "../../layouts/shell";
import { useScrollSpy } from "../../lib/useScrollSpy";
import { useStickyTitle } from "../../lib/useStickyTitle";
import { fetchActors } from "../../features/users/queries";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { ReportFoundDialog } from "../../features/inventory/ReportFoundDialog";
import { canReportFound } from "../../lib/roles";
import { MoveGoodsDialog } from "./components/MoveGoodsDialog";
import { RackTitleRow } from "./components/RackTitleRow";
import { RecordSampleDialog } from "./components/RecordSampleDialog";
import { RACK_DETAIL_PENDING } from "./pending";
import {
  RACK_MAIN_SECTIONS,
  RACK_SECTION_KEYS,
  type RackSectionKey,
  rackSection,
  rackSectionDomId,
} from "./sections";
import { type RackShelf, useRackShelf } from "./useRackShelf";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

// A ROW LIGHTS UP UNDER THE POINTER, every cell of it (a-table-row-lights-up).
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

function parseRackId(raw: string | undefined): bigint {
  if (!raw) return 0n;

  try {
    const id = BigInt(raw);
    // Zero and negatives are as invalid as "abc": the proto demands uint64 > 0, so such an id can
    // only ever be refused. Fail it here rather than spend a round-trip proving it.
    return id > 0n ? id : 0n;
  } catch {
    return 0n;
  }
}

// RackDetailPage answers the questions someone standing at a shelf has (#138/#197): which rack is this, what is on it,
// what it is worth, and what has happened to it — a PAGE, not a dialog, because it is a record being read.
//
// WHAT IT IS WORTH IS NOT A WAREHOUSE'S (a-warehouse-sees-ready-value-but-a-shelf-only-units): a caller acting with a
// warehouse role reads the shelf in UNITS ONLY, and the server leaves the money unset for it. The page draws the money
// only where the server sent it — the tile's value line, Harga/pcs and Nilai, the phone block's price line — so a
// warehouse sees no empty column and no Rp 0, and Root (from outside the warehouse) sees them all.
//
// ONE PAGE OF SECTIONS, AS EVERY OTHER DETAIL PAGE (owner: *"iya seperti usulmu, gunakan detail lain sebagai
// referensi"*, a-rack-page-is-one-page-of-sections) — the product page's and the restock pages' shape. It REPLACES the
// five vertical tabs of #197, and their pairs that read twice on one page are one section each: Produk carries Harga's
// two columns, Riwayat carries Riwayat Penempatan as its Penempatan chip.
//
//   ┌ Produk  ┐   ← A-01-1  Aisle A bawah                         [⊕ Temuan] [🎁 Sampel] [⇄ Pindahkan]
//   │ Info    │   [Di rak ini 25 unit · Rp …]  [Opname terakhir …]
//   └ Riwayat ┘   ┌ Produk ── Produk · Tim · Di rak ini · Harga/pcs · Nilai ──┐   ┌ Info ── Kode · Nama · Deskripsi ┐
//                 ┌ Riwayat ── (Semua) (Hanya penempatan) ────────────────────┐
//
// The nav on the left (Section, SectionNav, useScrollSpy); the title row sticks once it scrolls away; on a phone the
// section chips stick at the top, the acts are their icons (three fold into ⋯) and each product is a block. Info is the
// rack's short record, so where there is room it stands beside the rest, as Kiriman does on a restock.
//
// The page exists because a warehouse holds OTHER TEAMS' goods: a selling team raises a restock for its own product and
// accepting it (#137) puts that product on this warehouse's shelf — so whose each thing is has its own column.
export function RackDetailPage() {
  const { t } = useTranslation();
  const { rackId: rackIdParam } = useParams();
  const navigate = useNavigate();
  const { current } = useTeam();
  const isMobile = useIsMobile();
  // EVERY WAY OUT GOES WHERE THE PAGE WAS OPENED (a-form-returns-where-it-was-opened) — the list with its search; by a
  // link, the list.
  const backTo = cameFrom(useLocation()) ?? "/inventories/racks";

  const rackId = parseRackId(rackIdParam);
  const teamId = current?.teamId;

  const [rack, setRack] = useState<Rack | null>(null);
  const [summary, setSummary] = useState<RackSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // The writes off this rack (placement_decision.md): Move Goods, Record Sample (a-sample-is-recorded-on-rack-detail) and
  // Report Found. The reads are hand-rolled effects rather than query hooks, so a write bumps `reloadKey` and every read on
  // the page — header, the shelf, the history — asks again.
  const [dialog, setDialog] = useState<"move" | "sample" | "found" | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  // WHAT IS ON IT, PRICED — Produk's read and its pager (useRackShelf).
  const shelf = useRackShelf(teamId, rackId, reloadKey);

  // The names alone, for the dialogs, which show a team inside a product's line.
  const teamNames = useMemo(() => new Map([...shelf.teams].map(([id, team]) => [id, team.name])), [shelf.teams]);

  // ── The layout's own state, before the early returns: hooks may not be conditional. ─────────────────────────────────
  // Info beside the rest where there is room beside the nav — Chakra's `xl`, as a restock's Kiriman.
  const wide = useBreakpointValue({ base: false, xl: true }, { ssr: false }) ?? false;
  const stick = useStickyTitle(rack !== null, isMobile);
  const { active, scrollTo } = useScrollSpy(
    rack !== null,
    stick.bar,
    RACK_SECTION_KEYS,
    rackSectionDomId,
    wide ? RACK_MAIN_SECTIONS : undefined,
  );
  const navSections = useMemo(
    () => RACK_SECTION_KEYS.map((key) => ({ key, label: t(rackSection(key).titleKey), icon: rackSection(key).icon })),
    [t],
  );

  // Which rack is this, and the header's figures. Kept apart from the shelves so that paging one does not re-ask for the
  // header, and a rack that fails to load fails the whole page — there is no useful "contents of a rack we cannot name".
  useEffect(() => {
    if (teamId === undefined || rackId === 0n) {
      setError(rackId === 0n ? t("racks.detail.invalidId") : "");
      setLoading(false);
      return;
    }

    let ignore = false;

    setLoading(true);
    setError("");

    rackClient
      .rackDetail({ teamId, rackId })
      .then((res) => {
        if (ignore) return;

        setRack(res.rack ?? null);
        setSummary(res.summary ?? null);
      })
      .catch((err) => {
        // Another warehouse's rack is NotFound, and so is a deleted one — rpcError says which.
        if (!ignore) {
          setError(rpcError(err));
          setRack(null);
          setSummary(null);
        }
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [teamId, rackId, t, reloadKey]);

  // No current team means there is no warehouse to read a rack against — the whole page is meaningless.
  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("racks.detail.title")}</Heading>
        <Text color="fg.muted" data-testid="rack-detail-no-team">
          {t("racks.selectTeam")}
        </Text>
      </Stack>
    );
  }

  const back = () => navigate(backTo);

  // The first load shows the page's shape (motion-is-small-quick-and-shared).
  if (loading) {
    return <ListSkeleton heading rows={3} testId="rack-detail-loading" />;
  }

  if (error || !rack) {
    return (
      <Stack gap="section">
        <RackTitleRow stuck={false} code={t("racks.detail.title")} name="" backLabel={t("racks.detail.back")} onBack={back} />
        <Text color="error.fg" data-testid="rack-detail-error">
          {error || t("racks.detail.notFound")}
        </Text>
      </Stack>
    );
  }

  // REPORT FOUND (staff-may-report-a-found): units found on this shelf, sent for the Owner's or Admin's approval. Its
  // place here was accepted 2026-11-03 (the-staff-found-screens-are-accepted).
  const reportsFound = canReportFound(current.role);

  // THE ACTS OFF THIS RACK, each with its icon (an-action-button-carries-its-icon) — on a phone, and in the sticky bar,
  // their icons: two stay out of `⋯`, three fold into it (a-phone-header-action-is-an-icon). None while the admin team
  // monitors the warehouse (the-admin-team-monitors-read-only). The bar's copy suffixes its test ids `-sticky`, so a test
  // finds each of the page's once.
  const actions = (compact: boolean, suffix = "") =>
    !canWrite(current) ? null : compact ? (
      <CompactActions
        menuLabel={t("racks.detail.actions")}
        menuTestId={`rack-actions${suffix}`}
        actions={[
          ...(reportsFound
            ? [
                {
                  id: "found",
                  label: t("racks.reportFound.action"),
                  icon: PackageSearch,
                  testId: `rack-action-report-found${suffix}`,
                  onClick: () => setDialog("found"),
                },
              ]
            : []),
          {
            id: "sample",
            label: t("racks.sample.action"),
            icon: Gift,
            testId: `rack-action-sample${suffix}`,
            onClick: () => setDialog("sample"),
          },
          {
            id: "move",
            label: t("racks.move.action"),
            icon: ArrowRightLeft,
            primary: true,
            testId: `rack-action-move${suffix}`,
            onClick: () => setDialog("move"),
          },
        ]}
      />
    ) : (
      <HStack gap="2" flexShrink={0}>
        {reportsFound && (
          <Button variant="outline" data-testid="rack-action-report-found" onClick={() => setDialog("found")}>
            <Icon as={PackageSearch} boxSize="4" />
            {t("racks.reportFound.action")}
          </Button>
        )}
        <Button variant="outline" data-testid="rack-action-sample" onClick={() => setDialog("sample")}>
          <Icon as={Gift} boxSize="4" />
          {t("racks.sample.action")}
        </Button>
        <Button colorPalette="brand" data-testid="rack-action-move" onClick={() => setDialog("move")}>
          <Icon as={ArrowRightLeft} boxSize="4" />
          {t("racks.move.action")}
        </Button>
      </HStack>
    );

  // ── THE TITLE ROW — back, the code with the name under it, the acts held to the right. ONE builder, drawn twice: as the
  // page's title, and as the sticky bar once that title has scrolled behind it (the-title-row-is-the-sticky-bar). ────────
  const titleRow = (stuck: boolean) => (
    <RackTitleRow
      stuck={stuck}
      code={rack.code}
      name={rack.name}
      backLabel={t("racks.detail.back")}
      onBack={back}
      titleRef={stick.title}
      actions={stuck ? <Box data-testid="rack-detail-sticky-actions">{actions(true, "-sticky")}</Box> : actions(isMobile)}
    />
  );

  const counted = summary?.lastCountedAt ? Date.parse(summary.lastCountedAt) : NaN;
  const unknownCost = summary?.unknownCostProducts ?? 0;
  // The shelf's value, when the server gave it — never to a warehouse (a-warehouse-sees-ready-value-but-a-shelf-only-units).
  const totalValue = summary?.totalValue;

  // THE HEADER FIGURES, the order list's card strip (a-list-summary-is-the-order-lists-card-strip) — what is on the shelf
  // and what it is worth, then when it was last counted. Under the title, over the sections: the whole rack's. A
  // warehouse's tile is the units alone: no value line under them.
  const figures = (
    <SummaryStrip testId="rack-summary">
      <SummaryCard
        emphasis
        label={t("racks.detail.countAndValue")}
        value={
          <Span data-testid="rack-summary-count">
            {t("racks.detail.unitsOnShelf", { count: Number(summary?.totalOnHand ?? 0n) })}
          </Span>
        }
        line={
          totalValue === undefined ? undefined : (
            <>
              <Span data-testid="rack-summary-value">{formatRupiah(totalValue)}</Span>
              {/* ⚠ THE VALUE IS A FLOOR, AND THE SCREEN SAYS SO. A product with no recorded cost adds nothing to it, so a
                  shelf of never-restocked goods would otherwise read as a confident small number. */}
              {unknownCost > 0 && (
                <Span color="warning.fg" data-testid="rack-summary-unknown-cost">
                  {" · "}
                  {t("racks.detail.unknownCost", { count: unknownCost })}
                </Span>
              )}
            </>
          )
        }
        testId="rack-summary-stock"
      />
      {/* "Never counted" is a real answer for a new shelf, and it must not render as a date. The date speaks the app's
          language (a-date-speaks-the-apps-language). */}
      <SummaryCard
        label={t("racks.detail.lastCounted")}
        value={
          <Span data-testid="rack-summary-last-counted">
            {Number.isNaN(counted) ? t("racks.detail.neverCounted") : formatUnixDate(BigInt(Math.floor(counted / 1000)))}
          </Span>
        }
        testId="rack-summary-counted"
      />
    </SummaryStrip>
  );

  /** A section card, keyed by its entry in `sections.ts` — its id, icon and title come from there. */
  const section = (key: RackSectionKey, children: ReactNode, testId: string) => {
    const entry = rackSection(key);

    return (
      <Section id={rackSectionDomId(key)} icon={entry.icon} title={t(entry.titleKey)} testId={testId}>
        {children}
      </Section>
    );
  };

  // PRODUK — what is on the shelf, whose it is, how many here, and what it is worth: the Harga tab's two columns are this
  // section's, since a second table of the same rows read twice on one page.
  const products = section("products", <ShelfSection shelf={shelf} />, "rack-products-panel");
  // INFO — the rack's own record: the code painted on it, its name, what it is for.
  const info = section(
    "info",
    <Stack gap="card">
      <Fact label={t("racks.detail.code")}>
        <Text as="span" data-testid="rack-info-code">
          {rack.code}
        </Text>
      </Fact>
      <Fact label={t("racks.detail.name")}>
        <Text as="span" data-testid="rack-info-name">
          {rack.name || t("racks.detail.noName")}
        </Text>
      </Fact>
      <Fact label={t("racks.detail.description")} full>
        <Text as="span" data-testid="rack-info-description">
          {rack.description || t("racks.detail.noDescription")}
        </Text>
      </Fact>
    </Stack>,
    "rack-info-panel",
  );
  // RIWAYAT — what has happened to this shelf; the Riwayat Penempatan tab is its Penempatan chip, the same ledger narrowed
  // to the movements that decided goods LIVE here.
  const history = section(
    "history",
    <RackHistory teamId={teamId} rackId={rackId} reloadKey={reloadKey} testId="rack-history" />,
    "rack-history-panel",
  );

  const title = titleRow(false);

  return (
    // The page arrives — a fade and a short rise (motion-is-small-quick-and-shared).
    <Stack
      gap="section"
      animationStyle="enter"
      data-testid="rack-detail-page"
      style={{ ["--detail-header-h" as string]: `${stick.height}px` }}
    >
      {/* What is not wired yet (pending.ts) — nothing today, so the strip draws nothing. */}
      <NotImplementedSummary list={RACK_DETAIL_PENDING} />

      {/* THE STICKY STRIP — the section chips on a phone (always), and the title bar under them, drawn over the page once
          the title has gone behind it. */}
      <ProductStickyStrip
        prefix="rack-detail"
        stripRef={stick.strip}
        barRef={stick.bar}
        shown={stick.past}
        isMobile={isMobile}
        chips={<SectionNav compact sections={navSections} ariaLabel={t("racks.detail.navLabel")} active={active} onSelect={scrollTo} />}
      >
        {titleRow(true)}
      </ProductStickyStrip>

      {/* THE NAVIGATION, THEN THE SECTIONS. ⚠ `minmax(0, 1fr)` so a wide table scrolls in its own box. */}
      <Grid templateColumns={isMobile ? "minmax(0, 1fr)" : "13rem minmax(0, 1fr)"} gap="section" alignItems="start">
        {!isMobile && (
          <Box position="sticky" top="calc(var(--detail-header-h, 0px) + 1rem)">
            <SectionNav sections={navSections} ariaLabel={t("racks.detail.navLabel")} active={active} onSelect={scrollTo} />
          </Box>
        )}

        {/* THE SHELF IN THE MAIN COLUMN, INFO BESIDE IT where there is room — in the nav's order in one column otherwise. A
            JS branch, so no card exists twice. */}
        {wide ? (
          <Stack gap="section" minW="0" w="full">
            {title}
            {figures}
            <Grid templateColumns="minmax(0, 1fr) 20rem" gap="section" alignItems="start" minW="0">
              <Stack gap="section" minW="0">
                {products}
                {history}
              </Stack>
              <Stack gap="section" minW="0">
                {info}
              </Stack>
            </Grid>
          </Stack>
        ) : (
          <Stack gap="section" minW="0" w="full">
            {title}
            {figures}
            {products}
            {info}
            {history}
          </Stack>
        )}
      </Grid>

      {teamId !== undefined && (
        <>
          <MoveGoodsDialog
            warehouseId={teamId}
            rack={rack}
            teamNames={teamNames}
            open={dialog === "move"}
            onOpenChange={(open) => setDialog(open ? "move" : null)}
            onMoved={reload}
          />
          <RecordSampleDialog
            warehouseId={teamId}
            rack={rack}
            teamNames={teamNames}
            open={dialog === "sample"}
            onOpenChange={(open) => setDialog(open ? "sample" : null)}
            onRecorded={reload}
          />
          {reportsFound && (
            <ReportFoundDialog
              warehouseId={teamId}
              rackId={rack.id}
              rackCode={rack.code}
              open={dialog === "found"}
              onOpenChange={(open) => setDialog(open ? "found" : null)}
            />
          )}
        </>
      )}
    </Stack>
  );
}

// THE SHELF SECTION — the table (or a phone's blocks) and its pager under it.
function ShelfSection({ shelf }: { shelf: RackShelf }) {
  return (
    <Stack gap="card">
      <RackStockTable
        lines={shelf.lines}
        products={shelf.products}
        teams={shelf.teams}
        loading={shelf.loading}
        error={shelf.error}
      />
      <GrowingPager
        page={shelf.page}
        onPageChange={shelf.setPage}
        hasNext={shelf.page * shelf.pageSize < shelf.totalItems}
        resetKey={String(shelf.pageSize)}
        pageSize={shelf.pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={shelf.setPageSize}
      />
    </Stack>
  );
}

interface RackStockTableProps {
  lines: RackStockLine[];
  products: Map<string, Product>;
  teams: Map<string, Team>;
  loading: boolean;
  error: string;
}

// THE SHELF, PRICED — what is on it, whose it is, how many here, the unit price and the value. It was two tabs, Produk and
// Harga, the second this table with the money shown; on one page they read twice, so the money columns are here — for a
// reader the server gives them to. A warehouse reads the shelf in units only
// (a-warehouse-sees-ready-value-but-a-shelf-only-units): its lines carry no price, and the table draws neither column,
// nor the phone block's price line.
function RackStockTable({ lines, products, teams, loading, error }: RackStockTableProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  if (error) {
    return (
      <Text color="error.fg" data-testid="rack-detail-stock-error">
        {error}
      </Text>
    );
  }

  if (loading) {
    return <ListSkeleton rows={3} testId="rack-stock-loading" />;
  }

  if (lines.length === 0) {
    // AN EMPTY SHELF SAYS SO, AND WHAT FILLS IT (an-empty-list-shows-a-hint).
    return (
      <EmptyHint
        size="sm"
        icon={PackageOpen}
        title={t("racks.detail.empty")}
        description={t("racks.detail.emptyHint")}
        testId="rack-detail-empty"
      />
    );
  }

  // A product that did not resolve still gets a ROW and still shows its count: the box is physically on the shelf
  // whether or not the catalogue still lists it, and dropping or blanking it would hide stock someone can walk up and
  // touch. It is labelled as unknown rather than left to ProductListItem's neutral "Product #<id>" fallback. The
  // product is shown WITHOUT its team: the team has its own column (one context per column).
  const productOf = (line: RackStockLine) => {
    const product = products.get(line.productId.toString());
    return {
      product,
      item: product
        ? { ...product, teamId: undefined }
        : { id: line.productId, name: t("racks.detail.productUnknown", { id: line.productId.toString() }) },
    };
  };

  // WHOSE IT IS — the reason this page exists: a warehouse holds other teams' goods. Shown the way a team is shown
  // everywhere (TeamItem). A product the catalogue could not name has no known owner, and says so rather than guessing.
  const teamOf = (product: Product | undefined) =>
    product ? (
      <TeamItem
        team={{
          teamId: product.teamId,
          teamName: teams.get(product.teamId.toString())?.name,
          teamType: teams.get(product.teamId.toString())?.type,
          imageUrl: teams.get(product.teamId.toString())?.imageUrl,
        }}
      />
    ) : (
      <Text color="fg.muted">—</Text>
    );

  // ⚠ UNKNOWN IS NOT FREE. A dash-like word rather than "Rp 0", because a zero would say the goods cost nothing — and
  // the difference is the whole reason the server sends `cost_known` rather than letting a screen infer it.
  const money = (line: RackStockLine, v: number | undefined) =>
    line.costKnown ? formatRupiah(v ?? 0) : t("racks.detail.costUnknown");
  // PRICED only when the server sent the money — `cost_known` is set (true or false) for every line of a reader given
  // it, and unset on every line for a warehouse.
  const priced = lines.some((line) => line.costKnown !== undefined);

  if (isMobile) {
    // A PHONE READS EACH PRODUCT AS A BLOCK (a-phone-reads-each-line-as-a-block) — the product at full width, whose it
    // is, then the count on this rack, then its unit price × count = its value (that last line not for a warehouse).
    return (
      <Stack gap="3" data-testid="rack-detail-stock">
        {lines.map((line) => {
          const { product, item } = productOf(line);

          return (
            <Stack
              key={line.productId.toString()}
              gap="2"
              borderWidth="1px"
              borderRadius="md"
              p="3"
              data-testid={`rack-stock-row-${line.productId}`}
            >
              <ProductListItem product={item} />
              <Flex align="center" gap="2" justify="space-between">
                <Box data-testid={`rack-stock-team-${line.productId}`} minW="0">
                  {teamOf(product)}
                </Box>
                <Text fontSize="sm" flexShrink={0}>
                  {t("racks.detail.onThisRack")}{" "}
                  <Span fontWeight="bold" data-testid={`rack-stock-onhand-${line.productId}`}>
                    {line.onHand.toString()}
                  </Span>
                </Text>
              </Flex>
              {priced && (
                <Text fontSize="sm" color="fg.muted" data-testid={`rack-line-price-${line.productId}`}>
                  <Span data-testid={`rack-unit-cost-${line.productId}`}>{money(line, line.unitCost)}</Span>
                  {` × ${line.onHand.toString()} … `}
                  <Span fontWeight="bold" color="fg" data-testid={`rack-line-value-${line.productId}`}>
                    {money(line, line.value)}
                  </Span>
                </Text>
              )}
            </Stack>
          );
        })}
      </Stack>
    );
  }

  return (
    // The table scrolls inside its own box, never the page.
    <Box overflowX="auto" w="full" maxW="full" minW="0">
      <Table.Root size="sm" data-testid="rack-detail-stock">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>{t("racks.detail.product")}</Table.ColumnHeader>
            <Table.ColumnHeader>{t("racks.detail.team")}</Table.ColumnHeader>
            {/* NOT "On hand" — the app already uses that for the warehouse-wide number
                (inventory.table.onHand), and this is one shelf's share of it. */}
            <Table.ColumnHeader textAlign="end">{t("racks.detail.onThisRack")}</Table.ColumnHeader>
            {priced && <Table.ColumnHeader textAlign="end">{t("racks.detail.unitCost")}</Table.ColumnHeader>}
            {priced && <Table.ColumnHeader textAlign="end">{t("racks.detail.lineValue")}</Table.ColumnHeader>}
          </Table.Row>
        </Table.Header>

        <Table.Body>
          {lines.map((line) => {
            const { product, item } = productOf(line);

            return (
              // A row lights up under the pointer, every cell (a-table-row-lights-up).
              <Table.Row key={line.productId.toString()} css={LIGHTS_UP} data-testid={`rack-stock-row-${line.productId}`}>
                <Table.Cell>
                  <ProductListItem product={item} />
                </Table.Cell>
                <Table.Cell data-testid={`rack-stock-team-${line.productId}`}>{teamOf(product)}</Table.Cell>
                {/* Deliberately its own column rather than ProductListItem's `stock` badge: that badge means READY
                    STOCK across the warehouse, and this is the count on THIS rack. */}
                <Table.Cell textAlign="end" fontWeight="bold" data-testid={`rack-stock-onhand-${line.productId}`}>
                  {line.onHand.toString()}
                </Table.Cell>
                {priced && (
                  <Table.Cell textAlign="end" data-testid={`rack-unit-cost-${line.productId}`}>
                    {money(line, line.unitCost)}
                  </Table.Cell>
                )}
                {priced && (
                  <Table.Cell textAlign="end" fontWeight="bold" data-testid={`rack-line-value-${line.productId}`}>
                    {money(line, line.value)}
                  </Table.Cell>
                )}
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}

interface RackHistoryProps {
  teamId: bigint | undefined;
  rackId: bigint;
  // Bumped by a write on this page (a move, a sample), so the history asks again.
  reloadKey: number;
  testId: string;
}

/** Riwayat's chips: every movement, or only the ones that decided goods live here. */
type HistoryLens = "all" | "placement";

// The names of a page of history rows' products. Never throws: a product the catalogue cannot name keeps its row, as
// "#id" — the same fallback the shelf's own table uses.
async function productNamesFor(teamId: bigint, ids: bigint[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const wanted = [...new Set(ids.filter((id) => id > 0n))];
  if (wanted.length === 0) return names;

  try {
    const res = await productClient.productByIds({
      teamId,
      filter: { ids: wanted },
      dataRequest: productByIdsRowData(),
    });
    for (const product of productsFromByIds(res)) {
      names.set(product.id.toString(), product.name);
    }
  } catch {
    // Deliberately empty — see above.
  }

  return names;
}

// RackHistory is what has happened to THIS SHELF (#197) — a read `StockHistory` cannot serve, since
// it demands a product id and answers "what happened to this product".
//
// ONE LEDGER, TWO LENSES (owner: *"riwayat stok dan penempatanpun kelihatan sama"*, then *"oke"*) — it was two tabs,
// Riwayat Stok and Riwayat Penempatan, the second the first narrowed to put-aways and moves (PLACEMENT_KINDS); on one page
// they read twice, so Penempatan is a chip over the one ledger:
//
//   (Semua) (Hanya penempatan)  ← Diterima and Pindah rak only — what decided goods live here
function RackHistory({ teamId, rackId, reloadKey, testId }: RackHistoryProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [lens, setLens] = useState<HistoryLens>("all");
  const kinds = lens === "placement" ? PLACEMENT_KINDS : undefined;

  const [movements, setMovements] = useState<StockMovement[]>([]);
  // userId → name, and productId → name, for the page of rows: WHO did it (any-warehouse-member-may-move-goods — every
  // row names its person) and to WHAT. One batch each, committed with the rows; a failed lookup falls back to "#id".
  const [actorNames, setActorNames] = useState<Map<string, string>>(new Map());
  const [productNames, setProductNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalItems, setTotalItems] = useState(0);

  // The kinds array is a new literal on every render, so it is joined to a stable string for the
  // dependency list — depending on the array itself would refetch this tab forever.
  const kindKey = (kinds ?? []).join(",");

  useEffect(() => {
    if (teamId === undefined || rackId === 0n) {
      setLoading(false);
      return;
    }

    let ignore = false;

    setLoading(true);
    setError("");

    rackClient
      .rackHistory({
        teamId,
        filter: {
          rackId,
          kinds: kindKey === "" ? [] : kindKey.split(",").map(Number),
        },
        dataRequest: rackHistoryRowData(),
        page: { page, limit: pageSize },
      })
      .then(async (res) => {
        if (ignore) return;

        const rows = rackHistoryFromList(res.items, res.ids);
        const [actors, names] = await Promise.all([
          fetchActors(rows.map((m) => m.actorUserId)),
          productNamesFor(teamId, rows.map((m) => m.productId)),
        ]);
        if (ignore) return;

        const people = new Map<string, string>();
        for (const [id, user] of actors) {
          people.set(id, personName(user));
        }

        setMovements(rows);
        setActorNames(people);
        setProductNames(names);
        setTotalItems(Number(res.pageInfo?.totalItems ?? 0n));
      })
      .catch((err) => {
        if (!ignore) {
          setError(rpcError(err));
          setMovements([]);
          setTotalItems(0);
        }
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [teamId, rackId, page, pageSize, kindKey, reloadKey]);

  // The chips stay put while the ledger under them loads or fails — a lens is chosen, then answered.
  const chips = (
    <FilterChips<HistoryLens>
      value={lens}
      onChange={(next) => {
        setLens(next);
        setPage(1);
      }}
      all="all"
      allLabel={t("racks.detail.historyAll")}
      options={[
        { value: "placement", label: t("racks.detail.historyPlacement"), title: t("racks.detail.historyPlacementTitle") },
      ]}
      ariaLabel={t("racks.detail.historyLens")}
      scroll={isMobile}
      testId={`${testId}-filter`}
    />
  );

  if (error) {
    return (
      <Stack gap="card">
        {chips}
        <Text color="error.fg" data-testid={`${testId}-error`}>
          {error}
        </Text>
      </Stack>
    );
  }

  if (loading) {
    return (
      <Stack gap="card">
        {chips}
        <ListSkeleton rows={3} testId={`${testId}-loading`} />
      </Stack>
    );
  }

  return (
    <Stack gap="card">
      {chips}
      {/* The shared ledger (features/inventory/MovementTable): this shelf's history names the PRODUCT
          that moved, since the rack is already the thing you are looking at. "On shelf after" stays
          this page's wording — it is one shelf's count, not the warehouse's (#135). */}
      <MovementTable
        movements={movements}
        testId={testId}
        columns={["product", "by"]}
        actorNames={actorNames}
        productLabel={(id) => productNames.get(id.toString()) ?? `#${id}`}
        afterLabel={t("racks.detail.after")}
        emptyText={t("racks.detail.noHistory")}
        // THE REWORKED LEDGER (an-empty-list-shows-a-hint, a-table-row-lights-up, a-phone-reads-each-line-as-a-block):
        // an empty history is a hint, the rows light up, and a phone reads each movement as two lines.
        emptyIcon={History}
        emptyDescription={t("racks.detail.noHistoryHint")}
      />

      <GrowingPager
        page={page}
        onPageChange={setPage}
        hasNext={page * pageSize < totalItems}
        resetKey={[kindKey, pageSize].join("|")}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
      />
    </Stack>
  );
}
