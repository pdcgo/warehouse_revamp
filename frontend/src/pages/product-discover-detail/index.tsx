import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Badge,
  Box,
  Button,
  Grid,
  Heading,
  HStack,
  Icon,
  Stack,
  Tabs,
  Text,
  useBreakpointValue,
} from "@chakra-ui/react";
import { ArrowLeft, ArrowUpRight, ShoppingCart } from "lucide-react";
import { rpcError } from "../../api/clients";
import { CompactActions } from "../../components/chrome/CompactActions";
import { Fact, Section } from "../../components/chrome/DetailSection";
import { SectionNav } from "../../components/chrome/SectionNav";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { pathToRoot } from "../../features/categories/categoryTree";
import { useAvailabilityByWarehouse } from "../../features/inventory/queries";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { DailySection } from "../../features/products/DailySection";
import { sampleDaily } from "../../features/products/dailySample";
import { DerivedSection } from "../../features/products/DerivedSection";
import { sampleDerived } from "../../features/products/derivedSample";
import { DiscoverBadges } from "../../features/products/DiscoverBadges";
import {
  discoverPriceOf,
  sampleOngoingAt,
  sampleStock,
  sampleWarehouseCross,
} from "../../features/products/discoverSample";
import { FigureRows, type FigureRow } from "../../features/products/FigureRows";
import { HistorySection, SampleHistorySection } from "../../features/products/HistorySection";
import { sampleHistory } from "../../features/products/historySample";
import { ProductGallery } from "../../features/products/ProductGallery";
import { lockedByMinimumNow } from "../../features/products/ProductLock";
import { orderFormFor } from "../../features/products/presetProduct";
import { StartFormDialog } from "../../features/products/StartFormDialog";
import { fromHere } from "../../lib/cameFrom";

import { ProductStickyStrip, ProductTitleRow } from "../../features/products/ProductTitleRow";
import { useDiscoverProduct, useOwnerStockByWarehouse, useProductActivity } from "../../features/products/queries";
import { StockHighlight } from "../../features/products/StockHighlight";
import { SuppliersSection } from "../../features/products/SuppliersSection";
import { WarehouseFilter, WarehouseNote } from "../../features/products/WarehouseLens";
import { useTeam } from "../../features/team/TeamContext";
import { useTeams, useTeamsByIds } from "../../features/teams/queries";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { useIsMobile } from "../../layouts/shell";
import { formatRupiahRange } from "../../lib/money";
import { useScrollSpy } from "../../lib/useScrollSpy";
import { useStickyTitle } from "../../lib/useStickyTitle";
import { WarehouseStock, type WarehouseShelf } from "./components/WarehouseStock";
import { DISCOVER_DETAIL_PENDING, type DiscoverDetailPendingId } from "./pending";
import {
  DISCOVER_MAIN_SECTIONS,
  DISCOVER_SECTION_KEYS,
  DISCOVER_SECTIONS,
  DISCOVER_WAREHOUSE_TABS,
  type DiscoverSectionKey,
  type DiscoverWarehouseTab,
  discoverSection,
  discoverSectionDomId,
} from "./sections";

function parseProductId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// DiscoverProductDetailPage is ANOTHER team's product, read by a selling team deciding whether to sell
// it (/products/discover/:id, reached from a discover card). Its own page, not the owner's detail
// (/products/:id), because it answers a different person: the owner manages the record and its cost
// story; this reader can change nothing and asks four things of it —
//
//   WHAT is it, and WHOSE   the record, with the owning team named — on a cross-team page that is the
//                           fact worth knowing about a product.
//   ON WHAT TERMS           the cross price and the lock — the sharing rules a product carries
//                           (docs/business/product, Cross/Shared Products Rule). Not the markup's percentage: what a
//                           borrower pays is the price (the-discover-detail-shows-no-markup). The lock is the badge
//                           beside the name, a minimum in force reading Terkunci (the-lock-is-the-title-badge).
//   WHERE, HOW MANY, AT     what each warehouse holds ready, and its price there, since an order ships from exactly one
//   WHAT PRICE              and each warehouse's units came in at their own costs.
//   BOUGHT FROM WHOM        the suppliers and the stores it was bought at — shown even when the product is locked or
//                           archived, because a team may restock from another team's supplier itself.
//
// THE OWNER'S PAGE'S SHAPE (owner: *"detail discover dibuat mirip yang detail produk biasa"*,
// `the-discover-detail-is-the-product-page`): the title row — back as an icon, the name with the card's badges, the SKU
// under it — sticking in small once it scrolls away, a navigation beside ONE PAGE OF SECTIONS, Info with the picture,
// the large ready figure and the record as one list down, and Produk Turunan beside it:
//
//   Info               the pictures, how much is ready (every shelf, summed), the team, the category, the cross price
//   Produk Turunan ⚠   the owner's page's, beside it — no Penjualan Tim Lain: the lock is the title's badge
//   Harga per Gudang   every warehouse's ready stock and cross price — where the owner's page has Batch, never lensed
//   Per Gudang         the owner's page's warehouse card WITHOUT Harga Modal (owner: *"per gudang itu masukkan ke detail
//                      discover ini dengan tanpa harga modal"*, the-discover-detail-has-the-warehouse-zone): the picker,
//                      then Overview (the lens's ready, on its way, stock age), Pemasok ⚠, Keluar Masuk Harian ⚠, Riwayat Stok
//
// Read-only, and it never calls ProductDetail: that RPC answers only the owning team.
export function DiscoverProductDetailPage() {
  const { productId } = useParams();
  const navigate = useNavigate();
  // This page, handed to the order form it opens — so the form's Back and Create return here.
  const location = useLocation();
  const { current } = useTeam();
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const id = parseProductId(productId);
  const teamId = current?.teamId;

  const query = useDiscoverProduct({ teamId, productId: id });
  const product = query.data?.product ?? null;
  const categories = query.data?.categories ?? [];
  const own = product !== null && product.teamId === teamId;

  // Three reads beside the record, each failing on its own: a missing owner name or warehouse figure
  // must never blank the product.
  const owners = useTeamsByIds({ ids: product ? [product.teamId] : [] });
  const warehouses = useTeams({ teamType: TeamType.WAREHOUSE, page: 1, pageSize: 100, reference: true });
  const warehouseList = warehouses.data?.teams ?? [];
  const warehouseLabel = (wid: bigint) => warehouseList.find((w) => w.id === wid)?.name ?? `#${wid}`;

  // THE WAREHOUSE LENS over the Per Gudang card, 0n = every warehouse — the owner's page's (the-warehouse-picker-splits-
  // the-page): Info above it is the product across every warehouse and does not move with it. And WHICH TAB is open —
  // Overview first; only that tab is mounted, so only its rows are read (the-warehouse-zone-is-tabs).
  const [warehouseId, setWarehouseId] = useState<bigint>(0n);
  const [warehouseTab, setWarehouseTab] = useState<DiscoverWarehouseTab>("overview");
  // BUAT PESANAN asks the warehouse — with each one's stock — and the quantity first
  // (the-order-and-restock-start-on-the-page).
  const [startingOrder, setStartingOrder] = useState(false);

  // Only worth asking while the product is on offer — an archived or locked one has nothing to take.
  const offered = product !== null && !product.deleted && !product.crossLocked;
  const availability = useAvailabilityByWarehouse({
    teamId,
    productId: offered ? id : 0n,
    warehouseIds: warehouseList.map((w) => w.id),
  });

  // THE TEAM'S OWN PRODUCT reads its real cost and what is on its way, as its Discover card does — the owner's figures,
  // which no other team may read — across every warehouse for Info, and in each warehouse's lens for Per Gudang's
  // prices. Not asked for anybody else's (0n disables both).
  const ownActivity = useProductActivity({ teamId, productId: own ? id : 0n });
  // …and in the lens, for the Overview — the same entry as the line above while the lens is every warehouse.
  const ownLens = useProductActivity({ teamId, productId: own ? id : 0n, warehouseId });
  const ownByWarehouse = useOwnerStockByWarehouse({
    teamId,
    productId: own && offered ? id : 0n,
    warehouseIds: warehouseList.map((w) => w.id),
  });

  // ── The layout's own state, before the early returns: hooks may not be conditional. ─────────────────────────────
  // The side column only where there is room for it beside the nav — Chakra's `xl`, as on the owner's page; `ssr: false`
  // reads the screen on the first render, so a wide screen never paints one column and then jumps.
  const wide = useBreakpointValue({ base: false, xl: true }, { ssr: false }) ?? false;
  const stick = useStickyTitle(product !== null, isMobile);
  const { active, scrollTo } = useScrollSpy(
    product !== null,
    stick.bar,
    DISCOVER_SECTION_KEYS,
    discoverSectionDomId,
    wide ? DISCOVER_MAIN_SECTIONS : undefined,
  );
  const navSections = DISCOVER_SECTIONS.map((s) => ({ key: s.key, label: t(s.navKey), icon: s.icon }));

  const loading = query.isPending && id !== 0n;
  const error = id === 0n ? t("discoverDetail.invalidId") : query.isError ? rpcError(query.error) : "";

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("discover.title")}</Heading>
        <Text color="fg.muted" data-testid="discover-detail-no-team">
          {t("discoverDetail.selectTeam")}
        </Text>
      </Stack>
    );
  }

  // The page's shape while the product loads, not a spinner on an empty page (motion-is-small-quick-and-shared).
  if (loading) {
    return <ListSkeleton heading rows={3} testId="discover-detail-loading" />;
  }

  if (error || !product) {
    return (
      <Stack gap="section">
        <Button
          size="xs"
          variant="ghost"
          alignSelf="flex-start"
          data-testid="discover-detail-back"
          onClick={() => navigate("/products/discover")}
        >
          <Icon as={ArrowLeft} boxSize="4" />
          {t("discoverDetail.backTo")}
        </Button>
        <Text color="error.fg" data-testid="discover-detail-error">
          {error || t("discoverDetail.notFound")}
        </Text>
      </Stack>
    );
  }

  const categoryLabel =
    product.categoryId > 0n
      ? pathToRoot(categories, product.categoryId)
          .map((c) => c.name)
          .join(" › ")
      : "";

  const owner = owners.data?.[product.teamId.toString()];
  const cover = product.defaultImageUrl || product.defaultImageThumbnailUrl;
  const ownStock = ownActivity.data?.stock;
  const price = discoverPriceOf(product.id, product.crossMarkupBps, own, ownStock);

  // EVERY SHELF, and READY as their sum — the large figure is the Per Gudang table added up, so the two can never
  // disagree. Unknown while any warehouse has not answered: a part of the shelves is not the total (#74).
  const readyAt = (w: bigint) => availability.data?.get(w.toString());
  const ready =
    availability.data && warehouseList.length > 0 && warehouseList.every((w) => readyAt(w.id) !== undefined)
      ? warehouseList.reduce((sum, w) => sum + readyAt(w.id)!, 0n)
      : undefined;

  // EACH WAREHOUSE'S PRICE (each-warehouse-says-ready-and-its-price) — its units came in at their own costs. The team's
  // own product reads them, in each warehouse's lens; another team's is the card's invented range, shared out among the
  // warehouses holding it (⚠). Nothing on a shelf, nothing priced.
  const sampleCross = sampleWarehouseCross(
    product.id,
    product.crossMarkupBps,
    warehouseList.filter((w) => (readyAt(w.id) ?? 0n) > 0n).map((w) => w.id),
  );
  const shelves: WarehouseShelf[] = warehouseList.map((w) => {
    const held = (readyAt(w.id) ?? 0n) > 0n;
    const ownPrice = own ? discoverPriceOf(product.id, product.crossMarkupBps, true, ownByWarehouse.data?.get(w.id.toString())) : undefined;

    return {
      id: w.id,
      name: w.name,
      ready: readyAt(w.id),
      cross: !held ? undefined : own ? ownPrice?.cross : sampleCross.get(w.id.toString()),
      cost: held ? ownPrice?.cost : undefined,
    };
  });

  // THE LENS — what is ready in the warehouse picked over the Per Gudang card (all of them while none is).
  const lensReady = warehouseId === 0n ? ready : readyAt(warehouseId);

  // What is on its way — the owner's real figure on its own product, the card's invented one on anybody else's (⚠).
  const ongoing = own ? ownStock?.ongoingQty : sampleStock(product.id).ongoing;
  const mark = (part: DiscoverDetailPendingId) => <NotImplemented list={DISCOVER_DETAIL_PENDING} id={part} />;

  /** A section card, keyed by its entry in `sections.ts` — its id, icon and title come from there. */
  const section = (key: DiscoverSectionKey, children: ReactNode, marks?: ReactNode) => {
    const entry = discoverSection(key);

    return (
      <Section
        id={discoverSectionDomId(key)}
        icon={entry.icon}
        title={t(entry.titleKey)}
        marks={marks}
        testId={`dd-section-${key}`}
      >
        {children}
      </Section>
    );
  };

  // ── BUAT PESANAN — what holds it back, when something does: an archived product, or, for another team, the owner's lock
  // or a minimum in force (the badge beside the name says which). The team's own orders are never stopped by its lock.
  // NOTHING READY IN ANY WAREHOUSE holds it back too, the team's own product included (an-empty-product-cannot-start-an-
  // order): the take draws at creation, so the form would only refuse it.
  const orderBlockedBy = product.deleted
    ? t("discoverDetail.archived")
    : own
      ? ready === 0n
        ? t("products.start.noStock")
        : undefined
      : product.crossLocked
        ? t("discoverDetail.locked")
        : ready === 0n
          ? t("products.start.noStock")
          : lockedByMinimumNow(product, ready) === true
            ? t("products.lock.lockedNowHint", { total: ready!.toString(), min: product.reservedStock })
            : undefined;
  const openOrder = () => setStartingOrder(true);

  // ── THE TITLE ROW — the owner's page's (ProductTitleRow): back as an icon, the name with the card's badges (the
  // division, the lock) and Arsip, the SKU under it; on the right, the way to the team's own page when it is theirs.
  // Drawn twice, as on the owner's page: the title, and the sticky bar once it has scrolled behind. ──────────────────
  const headerRow = (stuck: boolean) => {
    const tid = (base: string) => (stuck ? base.replace("discover-detail-", "discover-detail-sticky-") : base);

    return (
      <ProductTitleRow
        stuck={stuck}
        prefix="discover-detail"
        backLabel={t("discoverDetail.backTo")}
        onBack={() => navigate("/products/discover")}
        name={product.name}
        titleRef={stick.title}
        sku={product.sku}
        badges={
          <HStack gap="1.5" flexShrink={0}>
            {/* THE LOCK IS THIS BADGE (the-lock-is-the-title-badge) — no Penjualan Tim Lain card repeats it; given the
                shelves summed, a minimum in force reads Terkunci · Min N pcs. */}
            <DiscoverBadges
              product={product}
              divisionMark={stuck ? undefined : mark("division")}
              totalReady={ready}
              testIdPrefix={stuck ? "discover-detail-sticky" : "discover-detail"}
            />
            {product.deleted && (
              <Badge colorPalette="gray" data-testid={tid("discover-detail-archived-badge")}>
                {t("products.tab.archived")}
              </Badge>
            )}
          </HStack>
        }
        // BUAT PESANAN — the order form with this product on it, and the picked warehouse (owner: *"discover cuma order
        // saja"*, a-product-page-opens-the-order-and-restock-forms). Held back, with the reason on it, while another
        // team may not order it. And on the team's OWN product, the way to its fuller page — the cost story, the
        // batches, the controls — where the owner's page keeps Ubah.
        actions={
          isMobile ? (
            <CompactActions
              menuLabel={t("products.table.actions")}
              actions={[
                {
                  id: "order",
                  label: t("products.newOrder"),
                  icon: ShoppingCart,
                  testId: tid("discover-detail-order"),
                  disabled: orderBlockedBy !== undefined,
                  onClick: orderBlockedBy === undefined ? openOrder : undefined,
                },
                own && {
                  id: "open-own",
                  label: t("discoverDetail.openOwn"),
                  icon: ArrowUpRight,
                  testId: tid("discover-detail-open-own"),
                  onClick: () => navigate(`/products/${product.id}`),
                },
              ]}
            />
          ) : (
            <HStack gap="2" flexShrink={0}>
              <Box title={orderBlockedBy}>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={orderBlockedBy !== undefined}
                  data-testid={tid("discover-detail-order")}
                  onClick={openOrder}
                >
                  <Icon as={ShoppingCart} boxSize="4" />
                  {t("products.newOrder")}
                </Button>
              </Box>
              {own && (
                <Button
                  size="xs"
                  variant="outline"
                  data-testid={tid("discover-detail-open-own")}
                  onClick={() => navigate(`/products/${product.id}`)}
                >
                  <Icon as={ArrowUpRight} boxSize="4" />
                  {t("discoverDetail.openOwn")}
                </Button>
              )}
            </HStack>
          )
        }
      />
    );
  };
  const title = headerRow(false);

  // ── WHY NOTHING IS ON OFFER — an archived or locked product says so where the ready figure would stand: it is the one
  // thing worth saying about it, and the figure would be a dash. A locked product is on Discover with its badge
  // (a-locked-product-shows-on-discover); an archived one only by an old link. ──────────────────────────────────────────
  const notOffered = product.deleted ? (
    <Alert.Root status="warning" data-testid="discover-detail-archived">
      <Alert.Indicator />
      <Alert.Title>{t("discoverDetail.archived")}</Alert.Title>
    </Alert.Root>
  ) : product.crossLocked ? (
    <Alert.Root status="warning" data-testid="discover-detail-locked">
      <Alert.Indicator />
      <Alert.Title>{t("discoverDetail.locked")}</Alert.Title>
    </Alert.Root>
  ) : null;

  // ── INFO — the pictures beside the record: how much is ready, LARGE (the-stock-headline-stands-out), then the team,
  // the category and the price as one list down, then the description — the owner's page's Info, read by a borrower. ──
  const rows: FigureRow[] = [
    // THE TEAM, BY NAME ALONE (owner: *"pemilik jelas selling dan tidak perlu gambar, cuma namanya saja, atau tulis tim
    // saja biar lebih jelas"*) — whoever owns a product on Discover is a selling team, so its avatar and type badge said
    // nothing; *Tim* says what the name is.
    {
      key: "team",
      label: t("discoverDetail.team"),
      value: owner?.name ?? `#${product.teamId}`,
      testId: "discover-detail-owner",
    },
    { key: "category", label: t("products.field.category"), value: categoryLabel, testId: "discover-detail-category" },
    // THE CROSS PRICE — what this reader pays, red and bold as on the card (a-discover-price-is-red-and-unlabelled);
    // here it has a label, so it needs no tooltip.
    {
      key: "cross",
      label: t("discoverDetail.crossPrice"),
      value: price.cross ? (
        <Text as="span" color="price.fg">
          {formatRupiahRange(price.cross.min, price.cross.max)}
        </Text>
      ) : (
        "—"
      ),
      mark: price.sample ? mark("crossPrice") : undefined,
      testId: "discover-detail-cross",
    },
    // …and what it cost, under it — the team's own products only, as on the card.
    ...(own
      ? [
          {
            key: "cost",
            label: t("discoverDetail.cost"),
            value: price.cost ? formatRupiahRange(price.cost.min, price.cost.max) : "—",
            testId: "discover-detail-cost",
          },
        ]
      : []),
  ];

  const infoSection = section(
    "info",
    <Grid templateColumns={{ base: "1fr", md: "minmax(0, 1fr) minmax(0, 3fr)" }} gap="section" alignItems="start">
      {/* THE PICTURES — the owner's page's gallery (owner: *"gambar produk ada"*). A by-ids row carries the cover and no
          image list, so the cover is the one picture shown (⚠ gallery); none at all means the product has none, since
          the cover is its first image. */}
      <Stack gap="1.5">
        <ProductGallery
          images={cover ? [{ url: product.defaultImageUrl, thumbnailUrl: product.defaultImageThumbnailUrl }] : []}
          name={product.name}
          prefix="discover-detail"
        />
        {cover && (
          <HStack gap="1" fontSize="xs" color="fg.muted">
            <Text>{t("discoverDetail.coverOnly")}</Text>
            {mark("gallery")}
          </HStack>
        )}
      </Stack>

      <Stack gap="section" minW="0">
        {notOffered ?? (
          <StockHighlight
            testId="discover-detail-highlight"
            ready={ready}
            line={
              ongoing === undefined ? (
                t("products.stat.pending")
              ) : (
                <HStack gap="1">
                  <Text as="span">{t("products.detail.highlight.ongoing", { n: ongoing.toString() })}</Text>
                  {!own && mark("ongoing")}
                </HStack>
              )
            }
          />
        )}

        <FigureRows rows={rows} prefix="discover-detail-info" />

        <Fact label={t("products.field.description")} full>
          {product.description}
        </Fact>
      </Stack>
    </Grid>,
  );

  // ── PRODUK TURUNAN — the owner's page's section, its sample rows and all (owner: *"produk turunan juga
  // ditampilkan"*). ──────────────────────────────────────────────────────────────────────────────────────────────────
  const derivedSection = section(
    "derived",
    <DerivedSection derived={sampleDerived(product.id, product.name, product.sku, product.defaultImageThumbnailUrl || cover)} />,
    mark("derived"),
  );

  // ── HARGA PER GUDANG — every warehouse's ready stock and its cross price there (each-warehouse-says-ready-and-its-
  // price), as a section ABOVE the warehouse card, where the owner's page has Batch (owner: *"harganya tidak masuk section
  // per gudang ini, tapi di atasnya"*) — so it is every warehouse at once and the picker never narrows it. It stands in
  // for Harga Modal. Nothing to take from a product that is not on offer, which it says rather than vanishing. ────────
  const notOfferedLine = (
    <Text color="fg.muted" fontSize="sm" data-testid="discover-detail-stock-not-offered">
      {t("discoverDetail.notOffered")}
    </Text>
  );
  const priceSection = section(
    "price",
    offered ? (
      <WarehouseStock
        shelves={shelves}
        loading={warehouses.isPending || availability.isPending || (own && ownByWarehouse.isPending)}
        error={warehouses.isError || availability.isError ? rpcError(warehouses.error ?? availability.error) : undefined}
      />
    ) : (
      notOfferedLine
    ),
    own ? undefined : mark("crossPrice"),
  );

  // ── PER GUDANG — the owner's page's warehouse card WITHOUT Harga Modal (owner: *"per gudang itu masukkan ke detail
  // discover ini dengan tanpa harga modal"*, the-discover-detail-has-the-warehouse-zone): the picker in its header — the
  // full width under the title on a phone — and under it the tabs, only the open one mounted.
  //
  //   Overview        the lens's small figures — Siap, Dikirim, Umur stok — the owner's page's less Rentang HPP
  //   Pemasok ⚠       the owner's page's tab, with the store it was bought at — and no cost (the-supplier-tab-names-the-store)
  //   Harian ⚠        the owner's page's sample
  //   Riwayat Stok    the owner's ledger — real on the team's own product; another team's cannot be read (⚠ missing)
  //
  // Harga Modal's replacement is NOT a tab here: it is Harga per Gudang, the section above the card.
  // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const picker = <WarehouseFilter value={warehouseId} onChange={setWarehouseId} testId="dd-warehouse-filter" />;
  const warehouseEntry = discoverSection("warehouse");
  const tabMark = (key: DiscoverWarehouseTab) =>
    key === "suppliers" ? mark("suppliers") : key === "daily" ? mark("daily") : key === "history" && !own ? mark("history") : null;

  // THE OVERVIEW'S FIGURES, in the lens — the owner's page's Overview (the-overview-is-small-details) with the CROSS PRICE
  // RANGE where Rentang HPP stood, and no stock age (owner: *"di overview tidak perlu umur [stok], malah butuh rentang
  // harga cross"*, the-overview-says-the-cross-range): Siap, Dikirim, Harga cross. The team's own product reads them all
  // (OwnerStockByIds in the lens); another team's has its ready stock real (the shelves) and the rest invented, marked —
  // the same samples Info and Harga per Gudang say, so the three never disagree.
  const lensStock = ownLens.data?.stock;
  const lensOngoing = own ? lensStock?.ongoingQty : sampleOngoingAt(product.id, warehouseId, warehouseList.map((w) => w.id));
  const lensCross =
    warehouseId === 0n
      ? price.cross
      : own
        ? discoverPriceOf(product.id, product.crossMarkupBps, true, lensStock).cross
        : sampleCross.get(warehouseId.toString());
  const pcs = (n: bigint | undefined) => (n === undefined ? "—" : t("products.stat.pcs", { n: n.toString() }));
  const overviewRows: FigureRow[] = [
    { key: "ready", label: t("products.stat.ready"), value: pcs(lensReady), testId: "dd-overview-ready" },
    {
      key: "ongoing",
      label: t("products.stat.ongoing"),
      value: pcs(lensOngoing),
      mark: own ? undefined : mark("ongoing"),
      testId: "dd-overview-ongoing",
    },
    // THE CROSS PRICE RANGE — red, as everywhere a borrower reads what it pays (a-discover-price-is-red-and-unlabelled).
    // A dash where the lens holds none: nothing on the shelf, nothing priced.
    {
      key: "cross",
      label: t("discoverDetail.crossPrice"),
      value: lensCross ? (
        <Text as="span" color="price.fg">
          {formatRupiahRange(lensCross.min, lensCross.max)}
        </Text>
      ) : (
        "—"
      ),
      mark: own ? undefined : mark("crossPrice"),
      testId: "dd-overview-cross",
    },
  ];
  const warehouseSection = (
    <Section
      id={discoverSectionDomId("warehouse")}
      icon={warehouseEntry.icon}
      title={t(warehouseEntry.titleKey)}
      action={isMobile ? undefined : picker}
      testId="dd-section-warehouse"
    >
      {isMobile && picker}
      <WarehouseNote warehouseId={warehouseId} warehouseName={warehouseLabel(warehouseId)} />

      <Tabs.Root
        value={warehouseTab}
        onValueChange={(e) => setWarehouseTab(e.value as DiscoverWarehouseTab)}
        lazyMount
        unmountOnExit
        data-testid="dd-warehouse-tabs"
      >
        <Tabs.List flexWrap="nowrap" overflowX="auto" overflowY="hidden">
          {DISCOVER_WAREHOUSE_TABS.map((key) => (
            <Tabs.Trigger key={key} value={key} flexShrink={0} whiteSpace="nowrap" data-testid={`dd-tab-${key}`}>
              {t(`products.detail.tab.${key}`)}
              {tabMark(key)}
            </Tabs.Trigger>
          ))}
          <Tabs.Indicator />
        </Tabs.List>

        {/* OVERVIEW — the lens's figures, small, one per line. Nothing to take from a product that is not on offer, which
            the tab says rather than vanishing. */}
        <Tabs.Content value="overview" data-testid="dd-panel-overview">
          {offered ? <FigureRows rows={overviewRows} prefix="dd-overview-row" /> : notOfferedLine}
        </Tabs.Content>

        {/* PEMASOK — shown even when the product is locked or archived: a team may restock from another team's supplier
            itself (a-team-restocks-from-another-teams-supplier). No cost: it is the owner's. */}
        <Tabs.Content value="suppliers" data-testid="dd-panel-suppliers">
          <SuppliersSection teamId={teamId} productId={product.id} showCost={false} />
        </Tabs.Content>

        <Tabs.Content value="daily" data-testid="dd-panel-daily">
          <DailySection days={sampleDaily(product.id, Number(lensReady ?? 0n))} />
        </Tabs.Content>

        {/* RIWAYAT STOK — every team may read it (owner: *"riwayat stok boleh dibaca semua orang"*,
            stock-history-is-everyones), but the owner's ledger answers only the owning team: real on the team's own
            product, the sample on another team's — each warehouse's story ending at its real shelf (⚠ history). No
            Batch column on this page (the-discover-history-names-no-batch). */}
        <Tabs.Content value="history" data-testid="dd-panel-history">
          {own ? (
            <HistorySection
              teamId={teamId}
              productId={product.id}
              warehouseId={warehouseId}
              warehouseLabel={warehouseLabel}
              batch={false}
            />
          ) : (
            <SampleHistorySection
              movements={sampleHistory(
                product.id,
                warehouseList.map((w) => ({ warehouseId: w.id, ready: readyAt(w.id) ?? 0n })),
              )}
              warehouseId={warehouseId}
              warehouseLabel={warehouseLabel}
              batch={false}
            />
          )}
        </Tabs.Content>
      </Tabs.Root>
    </Section>
  );

  return (
    // The page arrives — a fade and a short rise (motion-is-small-quick-and-shared).
    <Stack
      gap="section"
      animationStyle="enter"
      data-testid="discover-detail-page"
      style={{ ["--detail-header-h" as string]: `${stick.height}px` }}
    >
      <NotImplementedSummary list={DISCOVER_DETAIL_PENDING} />

      <StartFormDialog
        kind="order"
        open={startingOrder}
        onOpenChange={setStartingOrder}
        teamId={teamId}
        product={product}
        initialWarehouseId={warehouseId}
        onContinue={(warehouse, quantity) =>
          navigate(orderFormFor(product.id, warehouse, quantity), { state: fromHere(location) })
        }
      />

      <ProductStickyStrip
        prefix="discover-detail"
        stripRef={stick.strip}
        barRef={stick.bar}
        shown={stick.past}
        isMobile={isMobile}
        chips={<SectionNav compact sections={navSections} ariaLabel={t("products.detail.nav.label")} active={active} onSelect={scrollTo} />}
      >
        {headerRow(true)}
      </ProductStickyStrip>

      {/* THE NAVIGATION, THEN THE SECTIONS — the owner's page's shape. ⚠ `minmax(0, 1fr)` so a wide table scrolls in its
          own box instead of pushing the column, and `alignItems="start"` so the nav's cell can stick. */}
      <Grid templateColumns={isMobile ? "minmax(0, 1fr)" : "13rem minmax(0, 1fr)"} gap="section" alignItems="start">
        {!isMobile && (
          <Box position="sticky" top="calc(var(--detail-header-h, 0px) + 1rem)">
            <SectionNav sections={navSections} ariaLabel={t("products.detail.nav.label")} active={active} onSelect={scrollTo} />
          </Box>
        )}

        {/* Produk Turunan BESIDE Info on a wide screen, as on the owner's page; one column in the nav's order below that.
            A JS branch, so no card exists twice. */}
        {wide ? (
          <Stack gap="section" minW="0">
            {title}
            <Grid templateColumns="minmax(0, 1fr) 20rem" gap="section" alignItems="start" minW="0">
              <Stack gap="section" minW="0">
                {infoSection}
                {priceSection}
                {warehouseSection}
              </Stack>
              <Stack gap="section" minW="0">
                {derivedSection}
              </Stack>
            </Grid>
          </Stack>
        ) : (
          <Stack gap="section" minW="0" w="full">
            {title}
            {infoSection}
            {derivedSection}
            {priceSection}
            {warehouseSection}
          </Stack>
        )}
      </Grid>
    </Stack>
  );
}
