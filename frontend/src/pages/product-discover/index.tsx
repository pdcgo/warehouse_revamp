import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import { Box, Button, Flex, Grid, Heading, Link, SimpleGrid, Spacer, Stack, Text, useBreakpointValue } from "@chakra-ui/react";
import { Package, SearchX } from "lucide-react";

import { rpcError } from "../../api/clients";
import { FilterBar, FilterSearch } from "../../components/chrome/FilterBar";
import { FilterChips } from "../../components/chrome/FilterChips";
import { FilterPanel } from "../../components/chrome/FilterPanel";
import { GrowingPager } from "../../components/chrome/GrowingPager";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { ListSkeleton } from "../../components/feedback/ListSkeleton";
import { RefreshOverlay } from "../../components/feedback/RefreshOverlay";
import { NotImplemented } from "../../features/pending/NotImplemented";
import { NotImplementedSummary } from "../../features/pending/NotImplementedSummary";
import { useDiscoverProducts } from "../../features/products/queries";
import { useTeam } from "../../features/team/TeamContext";
import { useTeamsByIds } from "../../features/teams/queries";
import { useIsMobile } from "../../layouts/shell";
import { useDebounced } from "../../lib/useDebounced";
import { boolCodec, idCodec, oneOfCodec, textCodec, useUrlState } from "../../lib/urlState";
import { type DiscoverFilters, DiscoverFilterGroups, LOCK_FILTERS } from "./components/DiscoverFilterGroups";
import { DiscoverCard } from "./components/DiscoverCard";
import { DISCOVER_SORTS, DiscoverSortSelect } from "./components/DiscoverSortSelect";
import { DIVISION } from "./division";
import { DISCOVER_PENDING } from "./pending";
import { CUSTOM, NO_RANGE, PRICE_BANDS, type RangePick, STOCK_BANDS, bandCodec, rangeOn } from "./ranges";

const PAGE_SIZE_OPTIONS = [10, 20, 50];

/**
 * PRIORITAS · RISET · UMUM — the division a product is put in, chosen per product (pending.ts `division`). No "all": the
 * browse is always one division (owner: *"filter semua tidak perlu, cuma per tipe saja"*).
 */
const DIVISIONS = ["priority", "research", "general"] as const;
type Division = (typeof DIVISIONS)[number];

/** What Discover opens on — every priority product (owner: *"secara default di tampilkan yang prioritas semua"*). */
const DEFAULT_DIVISION: Division = "priority";

// DiscoverProductsPage lists products across ALL teams (#106) so a selling team can find another team's product to sell.
// Read-only; the current team is only the authorizing scope, not a filter — cross-team discovery is open
// (owner-confirmed). A card opens the DISCOVER detail (/products/discover/:id), never the owner's /products/:id, which
// answers only the owning team.
//
// MANY FILTERS, IN A PANEL BESIDE THE GRID (owner: *"filternya akan banyak"*, `discover-filters-in-a-side-panel`):
//
//   Temukan Produk
//   ┌ ⚲ Filter ────────┐  [⌕ Cari SKU atau nama   ]            128 produk   [Terbaru ⌄]
//   │ Gudang ⚠         │  (Semua) (Prioritas) (Riset) (Umum) ⚠
//   │ Tim pemilik      │  ┌─────┐ ┌─────┐ ┌─────┐
//   │ ☐ Sembunyikan …  │  │cover│ │cover│ │cover│
//   │ Kategori ⚠       │  │name │ │name │ │name │
//   │ Stok ⚠           │  │Cross│ │Cross│ │Cross│
//   │ Harga cross ⚠    │  └─────┘ └─────┘ └─────┘
//   └──────────────────┘
//
// Below `lg` there is no room for the column: the search stays in the row and the same groups open from a Filter button
// into the bottom sheet, the sort with them (FilterBar `sheetBelow="lg"`). The division is CHIPS over the grid on both,
// never in the sheet: it is what the grid is showing by default, so it must be in sight, not behind a button.
//
// A card says the CROSS price — what a borrower pays; the team's own products add the cost (discover-shows-the-cross-
// price). It renders a GRID of ProductCard (#121) rather than a table: this is a browse, and a product is recognised by
// its picture.
export function DiscoverProductsPage() {
  const { current } = useTeam();
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  // The column needs `lg`; read before the first paint, so a desktop never draws the sheet layout for a frame.
  const panel = useBreakpointValue({ base: false, lg: true }, { ssr: false }) ?? false;

  // THE FILTERS LIVE IN THE URL (a-lists-filters-live-in-the-url) — Back from a product opens the same narrowed browse.
  const [q, setQ] = useUrlState("q", "", textCodec);
  const [warehouseId, setWarehouseId] = useUrlState("warehouse", 0n, idCodec);
  const [ownerTeamId, setOwnerTeamId] = useUrlState("team", 0n, idCodec);
  const [hideMine, setHideMine] = useUrlState("hideMine", false, boolCodec);
  const [categoryId, setCategoryId] = useUrlState("category", 0n, idCodec);
  // A range is its band, or "custom" and the two ends typed (discover-ranges-are-picked).
  const [stockBand, setStockBand] = useUrlState("stock", "", bandCodec(STOCK_BANDS));
  const [stockMin, setStockMin] = useUrlState("stockMin", "", textCodec);
  const [stockMax, setStockMax] = useUrlState("stockMax", "", textCodec);
  const [crossBand, setCrossBand] = useUrlState("cross", "", bandCodec(PRICE_BANDS));
  const [crossMin, setCrossMin] = useUrlState("crossMin", "", textCodec);
  const [crossMax, setCrossMax] = useUrlState("crossMax", "", textCodec);
  // The typed ends count only while the range is a custom one.
  const stock: RangePick =
    stockBand === CUSTOM ? { band: CUSTOM, min: stockMin, max: stockMax } : { ...NO_RANGE, band: stockBand };
  const cross: RangePick =
    crossBand === CUSTOM ? { band: CUSTOM, min: crossMin, max: crossMax } : { ...NO_RANGE, band: crossBand };
  // Terbuka or Terkunci (discover-filters-by-lock) — "" for both.
  const [lock, setLock] = useUrlState("lock", "", oneOfCodec(LOCK_FILTERS));
  const [division, setDivision] = useUrlState<Division>("division", DEFAULT_DIVISION, oneOfCodec(DIVISIONS));
  const [sort, setSort] = useUrlState("sort", "newest", oneOfCodec(DISCOVER_SORTS));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Typed, then settled — a word is one request, not one per key.
  const term = useDebounced(q.trim());
  const teamId = current?.teamId;

  const query = useDiscoverProducts({ teamId, q: term, page, pageSize, ownerTeamId, excludeOwnTeam: hideMine, sort });
  const products = query.data?.products ?? [];
  const totalItems = query.data?.totalItems ?? 0;
  const error = query.isError ? rpcError(query.error) : "";

  // The owning team's NAME for each card — the page's ids in one batch (TeamByIds), cached as reference data. The cards
  // render at once with ProductCard's "Team #<id>" and upgrade when the names land.
  const teams = useTeamsByIds({ ids: products.map((p) => p.teamId) });
  const teamName = (id: bigint) => teams.data?.[id.toString()]?.name;

  const filters: DiscoverFilters = { warehouseId, ownerTeamId, hideMine, categoryId, stock, cross, lock };

  // The dropped picks count too, so Hapus Filter is there to take them back — though the cards do not move for them.
  const filtering =
    q.trim() !== "" ||
    warehouseId !== 0n ||
    ownerTeamId !== 0n ||
    hideMine ||
    categoryId !== 0n ||
    rangeOn(stock) ||
    rangeOn(cross) ||
    lock !== "" ||
    division !== DEFAULT_DIVISION;
  // The phone's Filter count — what is IN the sheet; the search and the chips are on screen.
  const inSheet =
    (warehouseId !== 0n ? 1 : 0) +
    (ownerTeamId !== 0n ? 1 : 0) +
    (hideMine ? 1 : 0) +
    (categoryId !== 0n ? 1 : 0) +
    (rangeOn(stock) ? 1 : 0) +
    (rangeOn(cross) ? 1 : 0) +
    (lock !== "" ? 1 : 0);
  // What the cards on screen were asked with — what "nothing matches" is about.
  const narrowed = term !== "" || ownerTeamId !== 0n || hideMine;

  // A range into the URL — its band, and its typed ends only while it is a custom one.
  function setRange(
    pick: RangePick,
    setBand: (v: string) => void,
    setMin: (v: string) => void,
    setMax: (v: string) => void,
  ) {
    setBand(pick.band);
    setMin(pick.band === CUSTOM ? pick.min : "");
    setMax(pick.band === CUSTOM ? pick.max : "");
  }

  // A filter change is a new question, so it starts again at page one.
  function refilter(change: () => void) {
    change();
    setPage(1);
  }

  function changeFilters(next: Partial<DiscoverFilters>) {
    refilter(() => {
      if (next.warehouseId !== undefined) setWarehouseId(next.warehouseId);
      if (next.ownerTeamId !== undefined) setOwnerTeamId(next.ownerTeamId);
      if (next.hideMine !== undefined) setHideMine(next.hideMine);
      if (next.categoryId !== undefined) setCategoryId(next.categoryId);
      if (next.stock !== undefined) setRange(next.stock, setStockBand, setStockMin, setStockMax);
      if (next.cross !== undefined) setRange(next.cross, setCrossBand, setCrossMin, setCrossMax);
      if (next.lock !== undefined) setLock(next.lock);
    });
  }

  // Every filter back to its start — the panel's, the sheet's and a no-match hint's Hapus Filter, one function. The
  // division goes back to Prioritas, which is where Discover starts; the sort is an order, not a filter, and stays.
  const clearFilters = () =>
    refilter(() => {
      setQ("");
      setWarehouseId(0n);
      setOwnerTeamId(0n);
      setHideMine(false);
      setCategoryId(0n);
      setRange(NO_RANGE, setStockBand, setStockMin, setStockMax);
      setRange(NO_RANGE, setCrossBand, setCrossMin, setCrossMax);
      setLock("");
      setDivision(DEFAULT_DIVISION);
    });

  if (!current) {
    return (
      <Stack gap="section">
        <Heading size="md">{t("discover.title")}</Heading>
        <Text color="fg.muted" data-testid="discover-no-team">
          {t("discover.selectTeam")}
        </Text>
      </Stack>
    );
  }

  const search = (
    <FilterSearch
      value={q}
      onChange={(value) => refilter(() => setQ(value))}
      placeholder={t("discover.searchPlaceholder")}
      testId="discover-search"
    />
  );

  const sortSelect = <DiscoverSortSelect value={sort} onChange={(next) => refilter(() => setSort(next))} />;

  const count = (
    <Text fontSize="sm" color="fg.muted" flexShrink={0} data-testid="discover-count">
      {t("discover.count", { count: totalItems })}
    </Text>
  );

  function grid() {
    if (products.length === 0 && !error) {
      // AN EMPTY LIST SAYS WHAT NEXT (an-empty-list-shows-a-hint).
      return narrowed ? (
        <EmptyHint
          icon={SearchX}
          title={t("discover.noneMatch")}
          description={t("emptyHint.noMatch")}
          action={
            <Button variant="outline" colorPalette="gray" onClick={clearFilters}>
              {t("common.clearFilters")}
            </Button>
          }
          testId="discover-none-match"
        />
      ) : (
        <EmptyHint icon={Package} title={t("discover.empty")} description={t("discover.emptyHint")} testId="discover-empty" />
      );
    }

    return (
      // BESIDE THE PANEL THE CARDS FILL BY WIDTH — as many 12.5rem cards as the row holds, whatever the sidebar and the
      // panel leave of the canvas. Below `lg`, TWO A ROW even on a phone: one full-width square cover per screen made a
      // browse one product at a time.
      // ⚠ One prop or the other, never both: an explicit `templateColumns={undefined}` overrides the template
      // SimpleGrid derives from `columns`, and the grid falls back to one column.
      <SimpleGrid
        {...(panel ? { templateColumns: "repeat(auto-fill, minmax(12.5rem, 1fr))" } : { columns: { base: 2, md: 3 } })}
        gap={{ base: "3", md: "card" }}
        data-testid="discover-grid"
      >
        {products.map((product) => {
          const own = product.teamId === teamId;
          // The owner's own figures — cost, ready, on its way — only for a product the team standing here owns.
          const ownStock = own ? query.data?.ownStock.get(product.id.toString()) : undefined;

          return (
            // The card carries its own testid keyed by id; this cell keys the SAME card by SKU, which is what a test
            // naming a product actually knows. It is also the grid cell, so `h="full"` on the Card has a box to fill.
            <Box key={product.id.toString()} data-testid={`discover-card-${product.sku}`}>
              {/* The whole card is the link to the discover detail — a real anchor, so it opens in a new tab like any
                  link. `h="full"` passes the stretched cell on to the card. */}
              <Link
                asChild
                display="block"
                h="full"
                borderRadius="l3"
                focusRing="outside"
                _hover={{ textDecoration: "none", "& > *": { borderColor: "border.emphasized" } }}
              >
                <RouterLink to={`/products/discover/${product.id}`} data-testid={`discover-open-${product.sku}`}>
                  <DiscoverCard product={product} teamName={teamName(product.teamId)} own={own} ownStock={ownStock} />
                </RouterLink>
              </Link>
            </Box>
          );
        })}
      </SimpleGrid>
    );
  }

  const browse = (
    <Stack gap="card" minW="0">
      {panel ? (
        // THE SEARCH OVER THE GRID — with how many there are and how they are ordered, on the same line.
        <Flex align="center" gap="card" wrap="wrap">
          {search}
          <Spacer />
          {count}
          <Box w="12rem">{sortSelect}</Box>
        </Flex>
      ) : (
        <FilterBar
          testId="discover-filter"
          sheetBelow="lg"
          active={filtering}
          count={inSheet}
          onClear={clearFilters}
        >
          {search}
          <DiscoverFilterGroups value={filters} onChange={changeFilters} sort={sortSelect} />
        </FilterBar>
      )}

      {/* PRIORITAS · RISET · UMUM — the division, as chips over the grid, Prioritas chosen when Discover opens (owner:
          *"secara default di tampilkan yang prioritas semua"*) and NO "Semua" chip — one division is always chosen
          (*"filter semua tidak perlu, cuma per tipe saja"*). ⚠ Not in the business context and stored nowhere, so the
          pick narrows nothing yet (pending.ts `division`). One row that scrolls sideways on a phone. */}
      <FilterChips
        value={division}
        onChange={(next) => refilter(() => setDivision(next))}
        // Each with the icon its card badge carries (division.ts).
        options={DIVISIONS.map((d) => ({ value: d, label: t(`discover.division.${d}`), icon: DIVISION[d].icon }))}
        ariaLabel={t("discover.division.label")}
        scroll={isMobile}
        trailing={<NotImplemented list={DISCOVER_PENDING} id="division" />}
        testId="discover-division"
      />

      {!panel && count}

      {error && (
        <Text color="error.fg" data-testid="discover-error">
          {error}
        </Text>
      )}

      {/* THE FIRST LOAD SHOWS THE GRID'S SHAPE; a refetch keeps the cards up behind the overlay (HARD RULE 10). */}
      {query.isPending ? (
        <ListSkeleton testId="discover-loading" />
      ) : (
        <RefreshOverlay busy={query.isFetching && !query.isPending}>{grid()}</RefreshOverlay>
      )}

      {/* every-list-pages-with-the-growing-pager — the pages opened so far, one click back to any of them. */}
      <GrowingPager
        page={page}
        onPageChange={setPage}
        hasNext={query.isPlaceholderData ? undefined : page * pageSize < totalItems}
        resetKey={[term, ownerTeamId, hideMine, sort, pageSize].join("|")}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
        testId="discover-pager"
      />
    </Stack>
  );

  return (
    // The page arrives — a fade and a short rise (`motion-is-small-quick-and-shared`).
    <Stack gap="section" animationStyle="enter" data-testid="discover-page">
      <Stack gap="1">
        <Heading size="md">{t("discover.title")}</Heading>
        <Text fontSize="sm" color="fg.muted">
          {t("discover.subtitle")}
        </Text>
      </Stack>

      {/* What is not real yet — the filters nothing can answer, the division, another team's cross price. */}
      <NotImplementedSummary list={DISCOVER_PENDING} />

      {panel ? (
        <Grid templateColumns="16rem minmax(0, 1fr)" gap="section" alignItems="start">
          <FilterPanel active={filtering} onClear={clearFilters} testId="discover-filter-panel">
            <DiscoverFilterGroups value={filters} onChange={changeFilters} />
          </FilterPanel>
          {browse}
        </Grid>
      ) : (
        browse
      )}
    </Stack>
  );
}
