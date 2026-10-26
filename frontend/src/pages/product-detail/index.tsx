import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { fromHere } from "../../lib/cameFrom";
import {
  Badge,
  Box,
  Button,
  Carousel,
  Flex,
  Grid,
  Heading,
  HStack,
  Icon,
  IconButton,
  Image,
  Stack,
  Tabs,
  Text,
  useBreakpointValue,
} from "@chakra-ui/react";
import { Archive, ArrowLeft, Pencil, RotateCcw } from "lucide-react";
import { Code, ConnectError } from "@connectrpc/connect";
import { rpcError } from "../../api/clients";
import { CompactActions } from "../../components/chrome/CompactActions";
import { CopyText } from "../../components/chrome/CopyText";
import { Fact, Section } from "../../components/chrome/DetailSection";
import { SectionNav } from "../../components/chrome/SectionNav";
import { ConfirmDialog } from "../../components/feedback/ConfirmDialog";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { toaster } from "../../components/feedback/Toaster";
import { useIsMobile } from "../../layouts/shell";
import { useTeam } from "../../features/team/TeamContext";
import { useTeams } from "../../features/teams/queries";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import {
  useArchiveProduct,
  useProductActivity,
  useProductDetail,
  useRestoreProduct,
  useSetProductLock,
} from "../../features/products/queries";
import { RestoreProductDialog } from "../../features/products/RestoreProductDialog";
import { ProductLockControl } from "../../features/products/ProductLock";
import { pathToRoot } from "../../features/categories/categoryTree";
import { STALE_STOCK_DAYS, daysAgo } from "../../features/products/stockAge";
import type { OwnerStockRow } from "../../features/products/adapt";
import type { Product } from "../../gen/warehouse/product/v1/product_pb";
import { formatUnixDate } from "../../lib/datetime";
import { formatMarkup } from "../../lib/markup";
import { formatRupiah } from "../../lib/money";
import { scrollerOf, useScrollSpy } from "../../lib/useScrollSpy";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { PRODUCT_DETAIL_PENDING } from "./pending";
import { BatchSection } from "./components/BatchSection";
import { DailySection } from "./components/DailySection";
import { DerivedSection } from "./components/DerivedSection";
import { StockHighlight } from "./components/StockHighlight";
import { SuppliersSection } from "./components/SuppliersSection";
import { sampleDaily, sampleDerived, sampleSuppliers } from "./sampleMock";
import { HistorySection } from "./components/HistorySection";
import { PriceSection } from "./components/PriceSection";
import { WarehouseFilter, WarehouseNote, WhenOrNever } from "./components/parts";
import {
  PRODUCT_MAIN_SECTIONS,
  PRODUCT_SECTION_KEYS,
  PRODUCT_SECTIONS,
  WAREHOUSE_TABS,
  productSection,
  productSectionDomId,
} from "./sections";
import type { ProductSectionKey, WarehouseTab } from "./sections";

/** A cost range, said once — one price when every unit cost the same. */
function costRange(min: bigint, max: bigint): string {
  return min === max ? formatRupiah(min) : `${formatRupiah(min)} – ${formatRupiah(max)}`;
}

// THE FOUR STOCK FIGURES — the same ones the product's row on the list shows: what is ready, what is on its way, what it
// cost (the cross price under it), and how old the oldest units are. Said TWICE on the page, from the same read
// (the-warehouse-picker-splits-the-page): in Info as the product's TOTAL across every warehouse, and under the warehouse
// picker as that warehouse's. Unknown is a dash with the reason, never a 0 (#74).
interface StockFigure {
  key: "ready" | "ongoing" | "cost" | "age";
  label: string;
  value: ReactNode;
  line: string;
}

function useStockFigures(stock: OwnerStockRow | undefined, markupBps: number): StockFigure[] {
  const { t } = useTranslation();
  const pending = t("products.stat.pending");
  const withMarkup = (cost: bigint) => cost + (cost * BigInt(markupBps)) / 10_000n;
  const days = stock && stock.oldestBatchUnix > 0n ? daysAgo(stock.oldestBatchUnix) : undefined;
  const stale = days !== undefined && days >= STALE_STOCK_DAYS;

  return [
    {
      key: "ready",
      label: t("products.stat.ready"),
      value: stock ? t("products.stat.pcs", { n: stock.readyQty.toString() }) : "—",
      line: stock ? `${formatRupiah(stock.readyValue)} · ${t("products.stat.readyHint")}` : pending,
    },
    {
      key: "ongoing",
      label: t("products.stat.ongoing"),
      value: stock ? t("products.stat.pcs", { n: stock.ongoingQty.toString() }) : "—",
      line: stock ? `${formatRupiah(stock.ongoingValueEst)} · ${t("products.stat.ongoingHint")}` : pending,
    },
    {
      key: "cost",
      label: t("products.table.priceRange"),
      value: stock?.costKnown ? costRange(stock.costMin, stock.costMax) : "—",
      line: stock?.costKnown
        ? `${t("products.table.cross")} ${costRange(withMarkup(stock.costMin), withMarkup(stock.costMax))}`
        : pending,
    },
    {
      key: "age",
      label: t("products.table.stockAge"),
      value:
        days === undefined ? (
          "—"
        ) : (
          <Text as="span" color={stale ? "warning.fg" : undefined} data-stale={stale || undefined}>
            {t("products.table.days", { count: days })}
          </Text>
        ),
      line:
        days === undefined
          ? stock
            ? t("products.detail.nothingOnAShelf")
            : pending
          : t("products.table.stockAgeTitle", { date: formatUnixDate(stock!.oldestBatchUnix) }),
    },
  ];
}

/** One row of a figures list — a label, the figure, and what it means beside it. */
interface FigureRow {
  key: string;
  label: string;
  value: ReactNode;
  line?: string;
  testId?: string;
}

/** A list of figures, ONE PER LINE, DOWN — Info's record and the warehouse Overview read the same way. */
function FigureRows({ rows, prefix }: { rows: FigureRow[]; prefix: string }) {
  return (
    <Stack gap="0" data-testid={prefix}>
      {rows.map((f) => (
        <Grid
          key={f.key}
          templateColumns="8rem minmax(0, 1fr)"
          gap="card"
          alignItems="baseline"
          py="2"
          borderBottomWidth="1px"
          borderColor="border.muted"
          data-testid={`${prefix}-${f.key}`}
        >
          <Text fontSize="xs" fontWeight="bold" color="fg.label">
            {f.label}
          </Text>
          <HStack gap="2" minW="0" align="baseline" wrap="wrap">
            <Box fontWeight="bold" data-testid={f.testId}>
              {f.value || "—"}
            </Box>
            {f.line && (
              <Text fontSize="xs" color="fg.muted" minW="0">
                {f.line}
              </Text>
            )}
          </HStack>
        </Grid>
      ))}
    </Stack>
  );
}

/**
 * THE OVERVIEW — the chosen warehouse's four figures as SMALL DETAILS, the list Info draws (owner: *"di overview tidak
 * perlu ada aman, dan pcs siap yang besar, cuma detail kecil aja di sana"*, `the-overview-is-small-details`): Siap,
 * Dikirim, Rentang HPP, Umur stok. The one large figure and its chip are Info's alone — the page has one thing that stands
 * out, not two. Inside the warehouse card's first tab, so no box of its own (never a card inside a card).
 */
function OverviewFigures({ stock, markupBps }: { stock?: OwnerStockRow; markupBps: number }) {
  const figures = useStockFigures(stock, markupBps);

  return (
    <Box data-testid="pd-overview">
      <FigureRows rows={figures} prefix="pd-overview-row" />
    </Box>
  );
}

/**
 * In Info: the product's totals, as plain figures — a card inside the Info card would be a card in a card. ONE PER LINE,
 * DOWN (owner: *"data stat ready, ongoing jangan jadi 4, 1 1 ke bawah"*): the label, then the figure and what it is
 * worth beside it, so the four read as a list down the record rather than a strip across it.
 */
function TotalFigures({
  stock,
  markupBps,
  category,
  lastOrderUnix,
}: {
  stock?: OwnerStockRow;
  markupBps: number;
  /** The category's path — the list's first row, read like the figures under it (owner: *"kategori samakan seperti siap, dikirim"*). */
  category: ReactNode;
  /** When it last sold — undefined while the read is in flight, 0 for never. */
  lastOrderUnix?: bigint;
}) {
  const { t } = useTranslation();
  const figures = useStockFigures(stock, markupBps);
  const rows: FigureRow[] = [
    { key: "category", label: t("products.field.category"), value: category, testId: "product-detail-category" },
    // Siap and Dikirim are the HIGHLIGHT above this list (the-stock-headline-stands-out), so the list carries the rest.
    ...figures.filter((f) => f.key !== "ready" && f.key !== "ongoing"),
    // WHEN IT LAST MOVED, at the foot of the same list (owner: *"aktivitas masukkan ke info produk"*) — is it still
    // selling, and has stock come in behind the sales. Across every warehouse, as the rest of Info.
    {
      key: "lastOrder",
      label: t("products.stat.lastOrder"),
      value: <WhenOrNever unix={lastOrderUnix} />,
      testId: "product-detail-last-order",
    },
    {
      key: "lastRestock",
      label: t("products.stat.lastRestock"),
      value: <WhenOrNever unix={stock?.lastRestockUnix} />,
      testId: "product-detail-last-restock",
    },
  ];

  return <FigureRows rows={rows} prefix="pd-total" />;
}

function parseProductId(raw: string | undefined): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

// ProductDetailPage is the read-only detail route for a product (#83) — a PAGE, not a dialog, reached by clicking a
// product row. It is the SELLING team's view: the team that owns the catalogue entry, as opposed to the warehouse that
// happens to hold the goods (which reads /inventories/products/:id instead).
//
// THE ORDER DETAIL'S SHAPE (owner: *"untuk detail kurang lebih aku ingin mirip dengan order detail"*,
// `the-product-page-is-one-page-of-sections`): back and the actions at the top, only the NAME sticking, a navigation
// on the left beside ONE PAGE OF SECTIONS — never tabs — in TWO ZONES split by the warehouse picker
// (`the-warehouse-picker-splits-the-page`):
//
//   every warehouse     INFO (the name, pictures, record, the four TOTAL figures), BATCH, PEMASOK ⚠ — and beside them
//                       PENJUALAN TIM LAIN (markup, lock), AKTIVITAS, PRODUK TURUNAN ⚠
//   ── the picker ──    the chosen warehouse's four figures
//   that warehouse      HARGA MODAL (the cost layers), RIWAYAT HARIAN ⚠, RIWAYAT STOK
export function ProductDetailPage() {
  const { productId } = useParams();
  const navigate = useNavigate();
  // This page, handed to the form it opens — so the form's Back and Save return here (the-form-returns-where-it-was-opened).
  const location = useLocation();
  const { current } = useTeam();
  const { t } = useTranslation();
  const isMobile = useIsMobile();

  const id = parseProductId(productId);
  const teamId = current?.teamId;

  // The WAREHOUSE LENS, over the overview and the Harga Modal and Riwayat Stok sections. 0n = everywhere.
  //
  // ONE piece of state behind ONE control: stock is held per warehouse, so "which building am I asking about" is one
  // question the whole money-and-movement half of this page is answering. Info is deliberately outside it: a SKU, a
  // category and a picture are not facts about a building.
  const [warehouseId, setWarehouseId] = useState<bigint>(0n);
  const warehouses = useTeams({ teamType: TeamType.WAREHOUSE, page: 1, pageSize: 100, reference: true });
  const warehouseName = warehouses.data?.teams.find((w) => w.id === warehouseId)?.name;

  // The Batch and Stock history rows each NAME a warehouse, and they span several once the lens is
  // open — so both need the same id→name lookup the note above uses. Resolved from the picker's own
  // feed rather than by a second read: the list is already loaded to populate the dropdown.
  const warehouseLabel = (id: bigint) =>
    warehouses.data?.teams.find((w) => w.id === id)?.name ?? `#${id}`;

  const query = useProductDetail({ teamId, productId: id });
  // Its own entry, so an inventory or selling hiccup costs the stock figures and not the product's
  // name — see the hook.
  const activityQuery = useProductActivity({ teamId, productId: id, warehouseId });
  // The product across every warehouse — Info's figures, the lock's badge, Aktivitas. The same entry as the lens's
  // while the lens is "every warehouse", so it is one read until a warehouse is chosen.
  const totalsQuery = useProductActivity({ teamId, productId: id, warehouseId: 0n });
  const archiveProduct = useArchiveProduct();
  const restoreProduct = useRestoreProduct();
  const setLock = useSetProductLock();

  // The one restore failure the user has to act on: archiving frees the SKU, so another product may
  // hold it by now. Null while there is no conflict to resolve.
  const [conflict, setConflict] = useState<{ product: Product; reason: string } | null>(null);
  const [archiving, setArchiving] = useState(false);

  const product = query.data?.product ?? null;
  const categories = query.data?.categories ?? [];
  const loading = query.isPending && id !== 0n;

  // A malformed id never reaches the server, so its message comes from here.
  const error = id === 0n ? "Invalid product id." : query.isError ? rpcError(query.error) : "";

  // ARCHIVE. Nothing is deleted — the row keeps its id, its stock outlives it, and its past orders
  // still name it — which is why every word the user reads says Archive.
  async function archive(target: Product) {
    if (teamId === undefined) {
      return;
    }

    try {
      await archiveProduct.mutateAsync({ teamId, productId: target.id });
      toaster.create({ type: "success", title: t("products.toast.archived", { sku: target.sku }) });
    } catch (err) {
      toaster.create({
        type: "error",
        title: t("products.toast.archiveFailed"),
        description: rpcError(err),
      });
    }
  }

  // `sku` empty = restore under the SKU it was archived with; that is the call that can come back
  // AlreadyExists, and the only sane answer to that is to let the user pick a free one.
  async function restore(target: Product, sku?: string) {
    if (teamId === undefined) {
      return;
    }

    try {
      await restoreProduct.mutateAsync({ teamId, productId: target.id, sku });
      setConflict(null);
      toaster.create({
        type: "success",
        title: t("products.toast.restored", { sku: sku || target.sku }),
      });
    } catch (err) {
      if (ConnectError.from(err).code === Code.AlreadyExists) {
        setConflict({ product: target, reason: rpcError(err) });

        return;
      }

      toaster.create({
        type: "error",
        title: t("products.toast.restoreFailed"),
        description: rpcError(err),
      });
    }
  }

  // Locking is edited in place, so it has no dialog and no save button — the switch falls back to the
  // server's answer on the refetch, and a failure is only noticeable as a toast.
  // THE LOCK, from its popover (`one-lock-three-ways`). Resolves whether it took, so the popover stays open on a
  // failure; the page follows the server's answer on the refetch.
  async function saveLock(target: Product, fields: { crossLocked: boolean; reservedStock?: number }): Promise<boolean> {
    if (teamId === undefined) {
      return false;
    }

    try {
      await setLock.mutateAsync({ teamId, productId: target.id, ...fields });
      toaster.create({ type: "success", title: t("products.lock.saved") });
      return true;
    } catch (err) {
      toaster.create({
        type: "error",
        title: t("products.toast.lockFailed"),
        description: rpcError(err),
      });
      return false;
    }
  }

  // ── The layout's own state, before the early returns: hooks may not be conditional. ─────────────────────────────
  // The side column only where there is room for it beside the nav: Chakra's `xl`, as on the order detail.
  // `ssr: false` READS THE SCREEN ON THE FIRST RENDER. By default the hook answers its `base` value first and the real
  // one a frame later, so a wide screen painted the one-column layout — Info the full width, its picture large — and then
  // jumped (owner, on the product page: *"ukuran gambarnya tidak konsisten, besar di awal dan jadi sesuai … tiba-tiba"*).
  const wide = useBreakpointValue({ base: false, xl: true }, { ssr: false }) ?? false;

  // ONLY THE NAME STICKS (owner: *"nama produk sticky, header kembali ke produk dan action tidak perlu sticky"*) — and only
  // once the name in Info has scrolled away, so the page never shows it twice. The bar is drawn OVER the page rather
  // than in its flow, so appearing moves nothing; on a phone it sits under the section chips, which always stick.
  const sticky = useRef<HTMLDivElement>(null);
  const nameBar = useRef<HTMLDivElement>(null);
  const infoName = useRef<HTMLHeadingElement>(null);
  const [pastName, setPastName] = useState(false);
  // WHICH WAREHOUSE TAB IS OPEN — Overview first. Only that tab is mounted, so only its rows are read
  // (the-warehouse-zone-is-tabs): the cost layers and the movements wait until somebody opens them.
  const [warehouseTab, setWarehouseTab] = useState<WarehouseTab>("overview");
  const [stickyHeight, setStickyHeight] = useState(0);
  const { active, scrollTo } = useScrollSpy(
    product !== null,
    nameBar,
    PRODUCT_SECTION_KEYS,
    productSectionDomId,
    wide ? PRODUCT_MAIN_SECTIONS : undefined,
  );
  const navSections = PRODUCT_SECTIONS.map((s) => ({ key: s.key, label: t(s.navKey), icon: s.icon }));

  // What a jump has to clear: the chips (a phone) plus the name bar — published as `--detail-header-h`.
  useEffect(() => {
    const bar = nameBar.current;
    const strip = sticky.current;

    if (!bar || !strip) {
      return;
    }

    const measure = () => setStickyHeight(strip.getBoundingClientRect().height + bar.getBoundingClientRect().height);
    const observer = new ResizeObserver(measure);

    measure();
    observer.observe(bar);
    observer.observe(strip);

    return () => observer.disconnect();
  }, [product !== null, isMobile]);

  // WHETHER THE NAME IN INFO HAS GONE BEHIND THE BAR — the moment the bar takes over saying it. Measured on every
  // scroll against WHERE THE BAR IS DRAWN, not with an IntersectionObserver: the observer's margin had to follow the
  // bar's own height, so the bar appearing re-armed it and it flipped back and forth (owner: *"judul stickynya ngebug di
  // bolak balik"*), and the page's entrance moves the name without the observer hearing it. Captured on `window`, so
  // whichever ancestor scrolls — `<main>` in the app, the window in Storybook — is heard, as useScrollSpy does.
  useEffect(() => {
    if (product === null) {
      return;
    }

    let frame = 0;

    const decide = () => {
      const name = infoName.current;
      const bar = nameBar.current;

      if (!name || !bar) {
        return;
      }

      // WHERE THE BAR STANDS ONCE IT STICKS — the top of whatever scrolls (`<main>` in the app, the document in
      // Storybook), plus the strip above it on a phone, plus the bar's own height. NOT where the bar is drawn right now:
      // at the top of the page the bar sits just above the title, and measured there the title read as already behind
      // it, so the bar showed from the start (owner: *"stickymu bermasalah, muncul terus"*).
      const scroller = scrollerOf(name);
      const top = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
      const strip = isMobile ? (sticky.current?.getBoundingClientRect().height ?? 0) : 0;
      setPastName(name.getBoundingClientRect().bottom <= top + strip + bar.getBoundingClientRect().height);
    };

    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(decide);
    };

    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
    decide();

    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [product !== null, isMobile]);

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("products.heading")}</Heading>
        <Text color="fg.muted" data-testid="product-detail-no-team">
          {t("products.detail.noTeam")}
        </Text>
      </Stack>
    );
  }

  // The page's shape while the product loads, not a spinner on an empty page (motion-is-small-quick-and-shared).
  if (loading) {
    return <ListSkeleton heading rows={3} testId="product-detail-loading" />;
  }

  if (error || !product) {
    return (
      <Stack gap="section">
        <Button
          size="xs"
          variant="ghost"
          alignSelf="flex-start"
          data-testid="product-detail-back"
          onClick={() => navigate("/products")}
        >
          <Icon as={ArrowLeft} boxSize="4" />
          {t("products.backToProducts")}
        </Button>
        <Text color="error.fg" data-testid="product-detail-error">
          {error || t("products.detail.notFound")}
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

  // An archived product is reachable by URL, so the page has to say so — and offer the way back.
  // Editing is not the way back: ProductUpdate only touches live rows, so Edit is withdrawn here and
  // Restore takes its place.
  const archived = product.deleted;
  const totalStock = totalsQuery.data?.stock;
  const lensStock = activityQuery.data?.stock;
  const openEdit = () => navigate(`/products/${product.id}/edit`, { state: fromHere(location) });

  /** A section card, keyed by its entry in `sections.ts` — its id, icon and title come from there. */
  const section = (key: ProductSectionKey, children: ReactNode, marks?: ReactNode) => {
    const entry = productSection(key);

    return (
      <Section
        id={productSectionDomId(key)}
        icon={entry.icon}
        title={t(entry.titleKey)}
        marks={marks}
        testId={`pd-section-${key}`}
      >
        {children}
      </Section>
    );
  };

  // ── PRODUK TURUNAN, filled with SAMPLE rows so its shape can be judged — with its ⚠ (sample). ──────────────────────
  const derivedSection = section(
    "derived",
    <DerivedSection
      derived={sampleDerived(product.id, product.name, product.sku, product.defaultImageThumbnailUrl || product.defaultImageUrl)}
    />,
    <NotImplemented list={PRODUCT_DETAIL_PENDING} id="derived" />,
  );

  // ── INFO — the product across every warehouse: its name, the pictures, the record, and the four TOTAL figures. Not
  // read through the warehouse picker, which sits below the product-wide sections (the-warehouse-picker-splits-the-page).
  // The gallery a quarter of the row, so the picture identifies the product without becoming a poster. ─────────────────
  const infoSection = section(
    "info",
    <Grid templateColumns={{ base: "1fr", md: "minmax(0, 1fr) minmax(0, 3fr)" }} gap="section" alignItems="start">
      <Box>
        {product.images.length === 0 ? (
          <Text color="fg.muted" fontSize="sm" data-testid="product-detail-no-images">
            {t("products.detail.noImages")}
          </Text>
        ) : product.images.length === 1 ? (
          /* ONE image is not a carousel — arrows and a single indicator would promise a second picture. */
          <Box data-testid="product-detail-images">
            <Image
              src={product.images[0].url || product.images[0].thumbnailUrl}
              alt={`${product.name} image 1`}
              aspectRatio={1}
              objectFit="cover"
              w="full"
              borderWidth="1px"
              borderRadius="md"
              data-testid="product-detail-image-0"
            />
          </Box>
        ) : (
          /* SEVERAL images — one at full width at a time, with THUMBNAILS as the indicators: a thumbnail says which
             picture you are about to get, which is the whole reason to look at a second one. Position 0 is the cover. */
          <Carousel.Root slideCount={product.images.length} slidesPerPage={1} loop allowMouseDrag data-testid="product-detail-images">
            <Carousel.ItemGroup>
              {product.images.map((img, i) => (
                <Carousel.Item key={`${img.url}-${i}`} index={i}>
                  <Image
                    src={img.url || img.thumbnailUrl}
                    alt={`${product.name} image ${i + 1}`}
                    aspectRatio={1}
                    objectFit="cover"
                    w="full"
                    borderWidth="1px"
                    borderRadius="md"
                    data-testid={`product-detail-image-${i}`}
                  />
                </Carousel.Item>
              ))}
            </Carousel.ItemGroup>
            <Carousel.IndicatorGroup display="flex" gap="2" mt="2" flexWrap="wrap" justifyContent="flex-start">
              {product.images.map((img, i) => (
                <Carousel.Indicator
                  key={`${img.url}-thumb-${i}`}
                  index={i}
                  unstyled
                  aria-label={t("products.detail.showImage", { n: i + 1 })}
                  cursor="pointer"
                  boxSize="10"
                  p="0"
                  borderRadius="md"
                  overflow="hidden"
                  borderWidth="2px"
                  borderColor="transparent"
                  opacity="0.55"
                  transition="opacity 0.15s, border-color 0.15s"
                  _hover={{ opacity: 1 }}
                  css={{ "&[data-current]": { opacity: 1, borderColor: "colorPalette.solid" } }}
                  colorPalette="brand"
                >
                  <Image src={img.thumbnailUrl || img.url} alt="" w="full" h="full" objectFit="cover" />
                </Carousel.Indicator>
              ))}
            </Carousel.IndicatorGroup>
          </Carousel.Root>
        )}
      </Box>

      <Stack gap="section" minW="0">
        {/* THE ONE THING THAT STANDS OUT — how much is ready, and whether the stock is healthy
            (the-stock-headline-stands-out). */}
        <StockHighlight stock={totalStock} />

        {/* THE RECORD AS ONE LIST, DOWN — the category first, read like the figures under it, then Siap, Dikirim, Rentang
            HPP and Umur stok as the product's TOTALS (owner: *"kategori samakan seperti siap, dikirim gitu"*). */}
        <TotalFigures
          stock={totalStock}
          markupBps={product.crossMarkupBps}
          category={categoryLabel}
          lastOrderUnix={totalsQuery.data?.activity?.lastOrderUnix}
        />

        <Fact label={t("products.field.description")} full>
          {product.description}
        </Fact>
      </Stack>
    </Grid>,
  );

  // ── THE HEADER ROW — back, the product's name with its SKU under it, and the actions held to the right (owner:
  // *"kembali dan actionnya juga, jadi default icon di sebelah judul, yang actionnya di nempel di kanan, di stickynya juga
  // ada"*). ONE builder, drawn twice: as the page's title right above the Info card, and as the sticky bar once that title
  // has scrolled behind it — so the bar is the same row in small, and nothing can be done from one that the other lacks.
  // The sticky copy's test ids carry `-sticky`, so the page's own stay unique. ────────────────────────────────────────
  const headerRow = (stuck: boolean) => {
    const id = (base: string) => (stuck ? base.replace("product-detail-", "product-detail-sticky-") : base);

    return (
      <Flex align="center" gap={stuck ? "2" : "card"} minW="0">
        {/* BACK, as an icon beside the name. An archived product goes back to the archive it was opened from
            (the-archive-is-a-page-of-its-own). */}
        <IconButton
          size="sm"
          variant="ghost"
          flexShrink={0}
          aria-label={t("products.backToProducts")}
          title={t("products.backToProducts")}
          data-testid={id("product-detail-back")}
          onClick={() => navigate(archived ? "/products/archived" : "/products")}
        >
          <Icon as={ArrowLeft} boxSize="4" />
        </IconButton>

        <Stack gap={stuck ? "0" : "1"} minW="0" flex="1">
          <HStack gap="2" minW="0">
            <Heading
              ref={stuck ? undefined : infoName}
              size={stuck ? "md" : "lg"}
              truncate={stuck}
              minW="0"
              data-testid={stuck ? undefined : "product-detail-name"}
            >
              {product.name}
            </Heading>
            {archived && (
              <Badge colorPalette="gray" flexShrink={0} data-testid={id("product-detail-archived")}>
                {t("products.tab.archived")}
              </Badge>
            )}
          </HStack>
          {/* The SKU to copy, UNDER the name (owner: *"skunya di bawah nama produk"*, *"sku di sticky taruh bawahnya"*). */}
          <Box fontSize="sm" color="fg.muted" data-testid={stuck ? "product-detail-sticky-sku" : undefined}>
            <CopyText value={product.sku} testId={stuck ? undefined : "product-detail-sku"} />
          </Box>
        </Stack>

        {/* THE ACTIONS, held to the right. On a phone they fold into ⋯ (a-phone-header-action-is-an-icon). */}
        {isMobile ? (
          <CompactActions
            menuLabel={t("products.table.actions")}
            actions={
              archived
                ? [{ id: "restore", label: t("products.restore"), icon: RotateCcw, testId: id("product-detail-restore"), onClick: () => restore(product) }]
                : [
                    { id: "edit", label: t("products.edit"), icon: Pencil, testId: id("product-detail-edit"), onClick: openEdit },
                    { id: "archive", label: t("products.archive"), icon: Archive, danger: true, testId: id("product-detail-archive"), onClick: () => setArchiving(true) },
                  ]
            }
          />
        ) : archived ? (
          /* UNARCHIVE. No confirmation: putting a product back is the reversible direction, and the only thing that can
             go wrong — the SKU being taken — is caught by the server and answered with a dialog. */
          <Button size="xs" variant="outline" flexShrink={0} loading={restoreProduct.isPending} data-testid={id("product-detail-restore")} onClick={() => restore(product)}>
            <Icon as={RotateCcw} boxSize="4" />
            {t("products.restore")}
          </Button>
        ) : (
          <HStack gap="2" flexShrink={0}>
            <Button size="xs" variant="outline" data-testid={id("product-detail-edit")} onClick={openEdit}>
              <Icon as={Pencil} boxSize="4" />
              {t("products.edit")}
            </Button>
            {/* ARCHIVE confirms: it takes the product out of the pickers, new orders and restocks. */}
            <Button size="xs" variant="outline" colorPalette="error" data-testid={id("product-detail-archive")} onClick={() => setArchiving(true)}>
              <Icon as={Archive} boxSize="4" />
              {t("products.archive")}
            </Button>
          </HStack>
        )}
      </Flex>
    );
  };
  const title = headerRow(false);

  // ── WHERE IT CAME FROM — the deliveries across every warehouse (each row names its own), so above the picker. ─────
  const batchSection = section(
    "batch",
    <BatchSection teamId={teamId} productId={product.id} warehouseLabel={warehouseLabel} />,
  );

  // ── WHO ELSE MAY SELL IT — the markup and the lock. A minimum in force is badged on the TOTAL stock
  // (one-lock-three-ways); an archived product only reads it. ──────────────────────────────────────────────────────────
  const crossSection = section(
    "cross",
    <Stack gap="card">
      <Fact label={t("products.field.crossMarkup")}>
        <Badge colorPalette={product.crossMarkupBps > 0 ? "brand" : "gray"} data-testid="product-detail-markup">
          {formatMarkup(product.crossMarkupBps)}
        </Badge>
      </Fact>
      <Fact label={t("products.lock.title")}>
        <Box data-testid="product-detail-lock">
          <ProductLockControl
            product={product}
            totalReady={totalStock?.readyQty}
            editable={!archived}
            onSave={(fields) => saveLock(product, fields)}
            testId="product-detail-lock-control"
          />
        </Box>
      </Fact>
    </Stack>,
  );

  // ── THE WAREHOUSE ZONE — ONE card: the warehouse picker in its header, and under it TABS for what that warehouse
  // holds, OVERVIEW FIRST (owner: *"yang pergudang jadikan per tab biar ga load semuanya, yang statistik itu ganti design
  // jadi overview dan tab pertama"*, `the-warehouse-zone-is-tabs`; Pemasok then its own tab, *"pemasok beda tab sama
  // overview"*, `the-suppliers-are-a-tab-of-their-own`). Only the open tab is
  // mounted, so only its rows are read. Everything above this card is the product across every warehouse
  // (the-warehouse-picker-splits-the-page). On a phone the picker drops under the title, the full width. ───────────────
  const picker = <WarehouseFilter value={warehouseId} onChange={setWarehouseId} testId="pd-warehouse-filter" />;
  const warehouseEntry = productSection("warehouse");
  const warehouseSection = (
    <Section
      id={productSectionDomId("warehouse")}
      icon={warehouseEntry.icon}
      title={t(warehouseEntry.titleKey)}
      action={isMobile ? undefined : picker}
      testId="pd-section-warehouse"
    >
      {isMobile && picker}
      <WarehouseNote warehouseId={warehouseId} warehouseName={warehouseName} />

      <Tabs.Root
        value={warehouseTab}
        onValueChange={(e) => setWarehouseTab(e.value as WarehouseTab)}
        lazyMount
        unmountOnExit
        data-testid="pd-warehouse-tabs"
      >
        <Tabs.List flexWrap="nowrap" overflowX="auto" overflowY="hidden">
          {WAREHOUSE_TABS.map((key) => (
            <Tabs.Trigger key={key} value={key} flexShrink={0} whiteSpace="nowrap" data-testid={`pd-tab-${key}`}>
              {t(`products.detail.tab.${key}`)}
              {(key === "suppliers" || key === "daily") && <NotImplemented list={PRODUCT_DETAIL_PENDING} id={key} />}
            </Tabs.Trigger>
          ))}
          <Tabs.Indicator />
        </Tabs.List>

        {/* OVERVIEW — the warehouse's four figures, alone. */}
        <Tabs.Content value="overview" data-testid="pd-panel-overview">
          <OverviewFigures stock={lensStock} markupBps={product.crossMarkupBps} />
        </Tabs.Content>

        {/* PEMASOK — who supplies it, a tab of its own (owner: *"pemasok beda tab sama overview"*); the tab names it, so
            the panel carries no heading, and its ⚠ rides on the tab, as Keluar Masuk Harian's does. */}
        <Tabs.Content value="suppliers" data-testid="pd-panel-suppliers">
          <SuppliersSection suppliers={sampleSuppliers(product.id)} />
        </Tabs.Content>

        <Tabs.Content value="price" data-testid="pd-panel-price">
          <PriceSection teamId={teamId} product={product} warehouseId={warehouseId} />
        </Tabs.Content>

        <Tabs.Content value="daily" data-testid="pd-panel-daily">
          <DailySection days={sampleDaily(product.id, Number(lensStock?.readyQty ?? 0n))} />
        </Tabs.Content>

        <Tabs.Content value="history" data-testid="pd-panel-history">
          <HistorySection teamId={teamId} productId={product.id} warehouseId={warehouseId} warehouseLabel={warehouseLabel} />
        </Tabs.Content>
      </Tabs.Root>
    </Section>
  );

  return (
    // The page arrives — a fade and a short rise (motion-is-small-quick-and-shared).
    <Stack
      gap="section"
      animationStyle="enter"
      data-testid="product-detail-page"
      style={{ ["--detail-header-h" as string]: `${stickyHeight}px` }}
    >
      <NotImplementedSummary list={PRODUCT_DETAIL_PENDING} />

      {/* THE STICKY STRIP — the section chips on a phone (always), and the header bar under them, drawn over the page once
          the title has gone behind it. On a desktop the strip itself has no height: the bar overlays, nothing moves. */}
      <Box ref={sticky} position="sticky" top="0" zIndex={10} h={isMobile ? undefined : "0"} data-testid="product-detail-header">
        {isMobile && (
          <Box bg="bg" py="2" borderBottomWidth="1px" borderColor="border">
            <SectionNav compact sections={navSections} ariaLabel={t("products.detail.nav.label")} active={active} onSelect={scrollTo} />
          </Box>
        )}
        <Box
          ref={nameBar}
          position="absolute"
          top={isMobile ? "100%" : "0"}
          left="0"
          right="0"
          bg="bg"
          py="2"
          borderBottomWidth="1px"
          borderColor="border"
          opacity={pastName ? 1 : 0}
          visibility={pastName ? "visible" : "hidden"}
          transition="opacity 120ms"
          aria-hidden={!pastName}
          data-testid="product-detail-name-bar"
          data-shown={pastName || undefined}
        >
          {/* THE SAME ROW, IN SMALL — back, the name with the SKU under it, the actions on the right (owner: *"di stickynya
              juga ada"*). */}
          {headerRow(true)}
        </Box>
      </Box>

      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={t("products.archiveDialog.title")}
        message={t("products.archiveDialog.message", { sku: product.sku })}
        confirmLabel={t("products.archiveDialog.confirmLabel")}
        onConfirm={() => archive(product)}
      />

      <RestoreProductDialog
        product={conflict?.product ?? null}
        reason={conflict?.reason ?? ""}
        onClose={() => setConflict(null)}
        onRestore={(sku) => restore(product, sku)}
      />

      {/* THE NAVIGATION, THEN THE SECTIONS — the order detail's shape. ⚠ \`minmax(0, 1fr)\` so a wide table scrolls in its
          own box instead of pushing the column, and \`alignItems="start"\` so the nav's cell can stick. */}
      <Grid templateColumns={isMobile ? "minmax(0, 1fr)" : "13rem minmax(0, 1fr)"} gap="section" alignItems="start">
        {!isMobile && (
          <Box position="sticky" top="calc(var(--detail-header-h, 0px) + 1rem)">
            <SectionNav sections={navSections} ariaLabel={t("products.detail.nav.label")} active={active} onSelect={scrollTo} />
          </Box>
        )}

        {/* TWO ZONES (the-warehouse-picker-splits-the-page). ABOVE, the product across every warehouse: the title, Info
            and Batch, with the short reference cards BESIDE Info on a wide screen (owner: *"info produk tidak penuh jadi
            penjualan tim lain ke bawah jadi disebelahnya"*). BELOW, the warehouse card and its tabs
            (the-warehouse-zone-is-tabs). A JS branch, so no card exists twice. */}
        {wide ? (
          <Stack gap="section" minW="0">
            {title}
            <Grid templateColumns="minmax(0, 1fr) 20rem" gap="section" alignItems="start" minW="0">
              {/* The warehouse card is as wide as Info and Batch (owner: *"per gudang selebar batch dan info"*) — the
                  main column, the side cards beside it. */}
              <Stack gap="section" minW="0">
                {infoSection}
                {batchSection}
                {warehouseSection}
              </Stack>
              <Stack gap="section" minW="0">
                {crossSection}
                {derivedSection}
              </Stack>
            </Grid>
          </Stack>
        ) : (
          <Stack gap="section" minW="0" w="full">
            {title}
            {infoSection}
            {batchSection}
            {crossSection}
            {derivedSection}
            {warehouseSection}
          </Stack>
        )}
      </Grid>
    </Stack>
  );
}
